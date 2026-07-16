// YT Music Mini Player — opens a Document Picture-in-Picture window with
// album art, track info, seek bar, playback controls, and volume controls.
// Classic video PiP is not used: YT Music songs are audio-only streams
// (no video track), which requestPictureInPicture() rejects.
(() => {
  if (!('documentPictureInPicture' in window)) return;

  // Every page selector lives here so YT Music DOM drift is a one-place fix.
  const SEL = {
    bar: 'ytmusic-player-bar',
    controls: 'ytmusic-player-bar .right-controls-buttons',
    title: 'ytmusic-player-bar .title',
    byline: 'ytmusic-player-bar .byline',
    art: 'ytmusic-player-bar img.image',
    prev: 'ytmusic-player-bar .previous-button',
    next: 'ytmusic-player-bar .next-button',
    playPause: 'ytmusic-player-bar #play-pause-button',
    video: 'video',
  };

  // Material Symbols icon path data (24px viewBox).
  const PATHS = {
    pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
    prev: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    muted: 'M19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-8.2-5.2L12 6V4L9.91 6.09l.89.71zM3.27 2 2 3.27 6.73 8H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L20.73 21 22 19.73 3.27 2zM12 16.27 7.73 12H5v-2h3.73L12 13.27v3z',
  };

  const PIP_CSS = `
    * { box-sizing: border-box; }
    body {
      margin: 0; height: 100vh; position: relative;
      background: #030303; color: #fff;
      font-family: Roboto, Arial, sans-serif;
      user-select: none; overflow: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .art { position: absolute; inset: 0; }
    .art img { width: 100%; height: 100%; object-fit: cover; }
    .art img:not([src]) { display: none; }
    .overlay {
      position: absolute; left: 0; right: 0; bottom: 0;
      padding-top: 32px;
      background: linear-gradient(to top, rgba(0, 0, 0, 0.88), rgba(0, 0, 0, 0.55) 55%, transparent);
    }
    .meta { padding: 0 10px; text-align: center; }
    #title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #artist { margin-top: 1px; font-size: 11px; color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .seek { display: flex; align-items: center; gap: 6px; padding: 2px 10px 0; }
    .seek span { font-size: 10px; color: #ccc; font-variant-numeric: tabular-nums; min-width: 26px; }
    #cur { text-align: right; }
    #bar { flex: 1; height: 3px; accent-color: #f00; cursor: pointer; }
    .controls { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 2px 0 6px; }
    .controls button {
      width: 28px; height: 28px; border: none; border-radius: 50%;
      background: transparent; color: #fff; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .controls button:hover { background: rgba(255, 255, 255, 0.1); }
    .controls button svg { width: 18px; height: 18px; fill: currentColor; }
    #pp { width: 34px; height: 34px; background: rgba(255, 255, 255, 0.14); }
    #pp svg { width: 20px; height: 20px; }
    .volume-control { display: flex; align-items: center; gap: 2px; min-width: 0; }
    #volume { width: 56px; height: 3px; accent-color: #fff; cursor: pointer; }
  `;

  let pipButton = null;
  let pipWindow = null;
  let boundVideo = null;
  let metaObserver = null;
  let ui = null;
  let seeking = false;
  let lastMeta = '';
  let lastAudibleVolume = 1;

  const $ = (sel) => document.querySelector(sel);
  const getVideo = () => $(SEL.video);

  function fmt(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  // DOM builders — no innerHTML anywhere: the PiP document inherits
  // YouTube's CSP/Trusted Types, and the page enforces them too.
  function el(doc, tag, props = {}, ...children) {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  }

  function icon(doc, pathData) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = doc.createElementNS(NS, 'path');
    path.setAttribute('d', pathData);
    svg.append(path);
    return svg;
  }

  // ---------- Player-bar button injection ----------

  function buildButton() {
    const btn = el(document, 'button', { id: 'ytm-pip-button', type: 'button', title: 'Mini player' });
    btn.setAttribute('aria-label', 'Mini player');
    btn.setAttribute('aria-pressed', pipWindow ? 'true' : 'false');
    btn.append(icon(document, PATHS.pip));
    btn.addEventListener('click', toggle);
    return btn;
  }

  function ensureButton() {
    if (pipButton && pipButton.isConnected) return;
    if (document.getElementById('ytm-pip-button')) return;
    const host = $(SEL.controls) ?? $(SEL.bar);
    if (!host) return;
    pipButton = buildButton();
    host.prepend(pipButton);
  }

  ensureButton();
  // Persistent: self-heals SPA navigations and player-bar re-renders.
  // childList+subtree only — attribute churn from the progress bar would
  // otherwise fire this constantly.
  new MutationObserver(ensureButton).observe(document.body, { childList: true, subtree: true });

  // ---------- Open / close ----------

  async function toggle() {
    if (pipWindow) {
      pipWindow.close(); // pagehide handler does the cleanup
      return;
    }
    try {
      // 16:9 to match YT thumbnails; user-resizable, Chrome remembers the last size.
      pipWindow = await documentPictureInPicture.requestWindow({ width: 256, height: 144 });
    } catch (err) {
      pipWindow = null;
      console.info('[ytm-pip] could not open mini player:', err.message);
      return;
    }
    buildUi(pipWindow);
    bindVideo();
    startMetaObserver();
    renderMeta();
    renderAll();
    pipButton?.setAttribute('aria-pressed', 'true');
    // Fires on our close(), the window's native ✕, and tab reload/close.
    pipWindow.addEventListener('pagehide', onPipClosed, { once: true });
  }

  function onPipClosed() {
    unbindVideo();
    metaObserver?.disconnect();
    metaObserver = null;
    pipWindow = null;
    ui = null;
    seeking = false;
    lastMeta = '';
    pipButton?.setAttribute('aria-pressed', 'false');
  }

  // ---------- PiP window UI ----------

  function controlButton(doc, pathData, label, onClick) {
    const btn = el(doc, 'button', { type: 'button', title: label });
    btn.setAttribute('aria-label', label);
    btn.append(icon(doc, pathData));
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildUi(win) {
    const doc = win.document;
    doc.title = 'YouTube Music';
    doc.head.append(el(doc, 'style', { textContent: PIP_CSS }));

    const art = el(doc, 'img', { id: 'art', alt: '' });
    art.addEventListener('error', () => {
      // High-res upgrade failed — fall back to the original thumbnail.
      const original = art.dataset.original;
      if (original && art.src !== original) art.src = original;
      else art.removeAttribute('src');
    });

    const title = el(doc, 'div', { id: 'title' });
    const artist = el(doc, 'div', { id: 'artist' });
    const cur = el(doc, 'span', { id: 'cur', textContent: '0:00' });
    const dur = el(doc, 'span', { id: 'dur', textContent: '0:00' });
    const bar = el(doc, 'input', { id: 'bar', type: 'range', min: 0, max: 0, step: 1, value: 0 });

    // Drag guard: while scrubbing, timeupdate must not move the thumb.
    bar.addEventListener('input', () => {
      seeking = true;
      cur.textContent = fmt(+bar.value);
    });
    bar.addEventListener('change', () => {
      const video = getVideo();
      if (video) video.currentTime = +bar.value;
      seeking = false;
    });

    const prev = controlButton(doc, PATHS.prev, 'Previous', () => $(SEL.prev)?.click());
    const next = controlButton(doc, PATHS.next, 'Next', () => $(SEL.next)?.click());
    const pp = controlButton(doc, PATHS.play, 'Play', togglePlayPause);
    pp.id = 'pp';
    const ppPath = pp.querySelector('path');
    const mute = controlButton(doc, PATHS.volume, 'Mute', toggleMute);
    mute.id = 'mute';
    mute.setAttribute('aria-pressed', 'false');
    const mutePath = mute.querySelector('path');
    const volume = el(doc, 'input', {
      id: 'volume', type: 'range', min: 0, max: 100, step: 1, value: 100, title: 'Volume: 100%',
    });
    volume.setAttribute('aria-label', 'Volume');
    volume.setAttribute('aria-valuetext', '100%');
    volume.addEventListener('input', () => {
      const video = getVideo();
      if (!video) return;
      const nextVolume = +volume.value / 100;
      if (nextVolume > 0) lastAudibleVolume = nextVolume;
      video.volume = nextVolume;
      video.muted = false;
    });

    doc.body.append(
      el(doc, 'div', { className: 'art' }, art),
      el(doc, 'div', { className: 'overlay' },
        el(doc, 'div', { className: 'meta' }, title, artist),
        el(doc, 'div', { className: 'seek' }, cur, bar, dur),
        el(doc, 'div', { className: 'controls' },
          prev,
          pp,
          next,
          el(doc, 'div', { className: 'volume-control' }, mute, volume),
        ),
      ),
    );

    ui = { art, title, artist, cur, dur, bar, pp, ppPath, mute, mutePath, volume };
  }

  // Prefer clicking the page's button so YT Music's own state machine
  // stays authoritative (ads, edge states); fall back to the element.
  function togglePlayPause() {
    const pageButton = $(SEL.playPause);
    if (pageButton) {
      pageButton.click();
      return;
    }
    const video = getVideo();
    if (video) video.paused ? video.play().catch(() => {}) : video.pause();
  }

  function toggleMute() {
    const video = getVideo();
    if (!video) return;
    if (video.muted || video.volume === 0) {
      if (video.volume === 0) video.volume = lastAudibleVolume;
      video.muted = false;
      return;
    }
    lastAudibleVolume = video.volume;
    video.muted = true;
  }

  // ---------- Sync channel 1: playback state from <video> events ----------

  function renderTime() {
    if (!ui || !boundVideo || seeking) return;
    ui.bar.value = Math.floor(boundVideo.currentTime || 0);
    ui.cur.textContent = fmt(boundVideo.currentTime);
  }

  function renderDuration() {
    if (!ui || !boundVideo) return;
    const d = boundVideo.duration;
    ui.bar.max = Number.isFinite(d) ? Math.floor(d) : 0;
    ui.dur.textContent = fmt(d);
    seeking = false; // never strand the drag guard across a track change
  }

  function renderPlayState() {
    if (!ui || !boundVideo) return;
    const paused = boundVideo.paused;
    ui.ppPath.setAttribute('d', paused ? PATHS.play : PATHS.pause);
    ui.pp.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    ui.pp.title = paused ? 'Play' : 'Pause';
  }

  function renderVolume() {
    if (!ui || !boundVideo) return;
    const percent = Math.round(boundVideo.volume * 100);
    if (percent > 0) lastAudibleVolume = boundVideo.volume;
    const silent = boundVideo.muted || percent === 0;
    const label = silent ? 'Unmute' : 'Mute';
    ui.volume.value = percent;
    ui.volume.title = `Volume: ${percent}%`;
    ui.volume.setAttribute('aria-valuetext', `${percent}%${boundVideo.muted ? ', muted' : ''}`);
    ui.mutePath.setAttribute('d', silent ? PATHS.muted : PATHS.volume);
    ui.mute.setAttribute('aria-label', label);
    ui.mute.setAttribute('aria-pressed', silent ? 'true' : 'false');
    ui.mute.title = label;
  }

  function renderAll() {
    renderDuration();
    renderTime();
    renderPlayState();
    renderVolume();
  }

  function bindVideo() {
    boundVideo = getVideo();
    if (!boundVideo) return;
    boundVideo.addEventListener('timeupdate', renderTime);
    boundVideo.addEventListener('durationchange', renderDuration);
    boundVideo.addEventListener('loadedmetadata', renderDuration);
    boundVideo.addEventListener('play', renderPlayState);
    boundVideo.addEventListener('pause', renderPlayState);
    boundVideo.addEventListener('volumechange', renderVolume);
  }

  function unbindVideo() {
    if (!boundVideo) return;
    boundVideo.removeEventListener('timeupdate', renderTime);
    boundVideo.removeEventListener('durationchange', renderDuration);
    boundVideo.removeEventListener('loadedmetadata', renderDuration);
    boundVideo.removeEventListener('play', renderPlayState);
    boundVideo.removeEventListener('pause', renderPlayState);
    boundVideo.removeEventListener('volumechange', renderVolume);
    boundVideo = null;
  }

  // YT Music reuses one <video> for the tab's lifetime; this is a cheap
  // safety net in case it's ever replaced.
  function rebindVideoIfNeeded() {
    if (getVideo() === boundVideo) return;
    unbindVideo();
    bindVideo();
    renderAll();
  }

  // ---------- Sync channel 2: track metadata from the player bar ----------

  function readMeta() {
    const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    return {
      title: clean($(SEL.title)?.textContent),
      byline: clean($(SEL.byline)?.textContent),
      art: $(SEL.art)?.src ?? '',
    };
  }

  function setArt(src) {
    if (!src) {
      ui.art.removeAttribute('src');
      return;
    }
    ui.art.dataset.original = src;
    let hiRes = src;
    try {
      if (new URL(src).hostname.endsWith('.googleusercontent.com')) {
        hiRes = src.replace(/=w\d+-h\d+.*$/, '=w544-h544-l90-rj');
      }
    } catch {
      // not a parseable URL — use as-is
    }
    ui.art.src = hiRes;
  }

  function renderMeta() {
    if (!ui) return;
    const meta = readMeta();
    const key = `${meta.title}|${meta.byline}|${meta.art}`;
    if (key === lastMeta) return; // YTM mutations are chatty; only touch DOM on change
    lastMeta = key;
    ui.title.textContent = meta.title || 'YouTube Music';
    ui.artist.textContent = meta.byline;
    setArt(meta.art);
  }

  function startMetaObserver() {
    const bar = $(SEL.bar) ?? document.body;
    metaObserver = new MutationObserver(() => {
      rebindVideoIfNeeded();
      renderMeta();
    });
    metaObserver.observe(bar, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'title'],
    });
  }
})();
