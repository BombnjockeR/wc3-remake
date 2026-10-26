/* Sound: Warcraft III sound labels (AnimSounds / UnitCombatSounds / UnitAckSounds / UISounds, see assets/sounds.js)
 * played with HTMLAudio (works from file:// and from a web server). Positional volume from the camera target,
 * random file per label, pitch variance, and a simple music playlist.
 */
(function () {
  'use strict';
  const S = () => window.PYRO_SOUNDS || { sounds: {}, anim: {}, music: [] };
  const pools = new Map(); // file -> [Audio]
  let lx = 0, ly = 0, ldist = 3000; let playing = 0; const lastPlay = new Map();
  const opts = { sound: 0.8, music: 0.45, enabled: true };
  try { Object.assign(opts, JSON.parse(localStorage.getItem('pyro.sound') || '{}')); } catch (e) { /* storage unavailable */ }
  const save = () => { try { localStorage.setItem('pyro.sound', JSON.stringify(opts)); } catch (e) { /* ignore */ } };

  function audioFor(file) {
    let pool = pools.get(file); if (!pool) pools.set(file, pool = []);
    let a = pool.find(x => x.paused || x.ended);
    if (!a) { if (pool.length >= 4) return null; a = new Audio(file); a.preload = 'auto'; a.preservesPitch = false; a.mozPreservesPitch = false; a.onended = () => { playing = Math.max(0, playing - 1); }; pool.push(a); }
    return a;
  }
  function play(label, vol, rate) {
    if (!opts.enabled || opts.sound <= 0) return;
    const s = S().sounds[label]; if (!s || !s.files.length) return;
    const now = performance.now(); if (now - (lastPlay.get(label) || 0) < 60) return; lastPlay.set(label, now);
    if (playing > 24) return;
    const a = audioFor(s.files[Math.floor(Math.random() * s.files.length)]); if (!a) return;
    a.volume = Math.max(0, Math.min(1, (s.vol / 127) * vol * opts.sound));
    a.playbackRate = Math.max(0.5, Math.min(2, (rate || 1) * (1 + (Math.random() * 2 - 1) * Math.min(0.2, s.pitchVar || 0))));
    try { a.currentTime = 0; } catch (e) { /* not loaded yet */ }
    playing++; const p = a.play(); if (p && p.catch) p.catch(() => { playing = Math.max(0, playing - 1); });
  }
  function playAt(label, x, y) {
    const s = S().sounds[label]; if (!s) return;
    const d = Math.hypot(x - lx, y - ly) + Math.max(0, ldist - 1650) * 0.35;
    const min = Math.max(300, s.minD || 600), cut = Math.max(min + 200, s.cut || 3000);
    if (d > cut) return;
    const vol = d <= min ? 1 : Math.max(0, 1 - (d - min) / (cut - min));
    play(label, vol * 0.85);
  }
  // ---- music
  let music = null, track = -1;
  function nextTrack() {
    const list = S().music.filter(f => !/victory|defeat/i.test(f)); if (!list.length) return;
    track = (track + 1) % list.length;
    if (!music) { music = new Audio(); music.onended = nextTrack; }
    music.src = list[track]; music.volume = opts.music; if (opts.enabled && opts.music > 0) music.play().catch(() => {});
  }
  function playMusic(kind) { // 'game' | 'victory' | 'defeat' | null
    if (!music) { music = new Audio(); music.onended = nextTrack; }
    if (!kind) { music.pause(); return; }
    if (kind === 'game') { if (music.paused || /victory|defeat/i.test(music.src)) { track = Math.floor(Math.random() * 4) - 1; nextTrack(); } return; }
    const f = S().music.find(x => new RegExp(kind, 'i').test(x)); if (!f) return;
    music.onended = null; music.src = f; music.volume = opts.music; if (opts.enabled) music.play().catch(() => {});
  }
  function setOpts(o) { Object.assign(opts, o); if (music) { music.volume = opts.music; if (!opts.enabled || opts.music <= 0) music.pause(); else if (music.paused && music.src) music.play().catch(() => {}); } save(); }

  window.PyroSound = { play: (label) => play(label, 1), playAt, listener: (x, y, d) => { lx = x; ly = y; ldist = d; }, playMusic, opts, setOpts };
})();
