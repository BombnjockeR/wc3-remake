/* Asset store: game files (models .mdx, textures, fonts, sounds) packed as base64 in assets/*.js "packs".
 * Paths are normalized like Warcraft III does it: lowercase, backslashes, models always .mdx.
 * Textures are stored as WebP/PNG under their original .blp path (tools/build_assets.py); a few may still be raw BLP.
 * Call `await PyroAssets.ready()` once: it decodes every image so the rest of the code can use them synchronously.
 */
(function () {
  'use strict';
  const files = new Map();
  const norm = (p) => String(p || '').replace(/\//g, '\\').toLowerCase().trim();
  function addPack(pack) { for (const k of Object.keys(pack)) files.set(norm(k), pack[k]); }
  (window.PYRO_ASSET_PACKS || []).forEach(addPack);
  window.PYRO_ASSET_PACKS = { push: addPack };

  const decoded = new Map();
  function b64(s) {
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function get(path) {
    const k = norm(path); if (!files.has(k)) return null;
    if (!decoded.has(k)) { const v = files.get(k); decoded.set(k, typeof v === 'string' ? b64(v) : v); files.set(k, true); }
    return decoded.get(k);
  }
  const modelKey = (p) => { p = norm(p); if (!p) return ''; return p.replace(/\.(mdl|mdx)$/, '') + '.mdx'; };
  function texKeys(p) {
    p = norm(p); if (!p) return [];
    const base = p.replace(/\.(blp|tga|dds|png)$/, '');
    return [p, base + '.blp', base + '.tga', base + '.dds', base + '.png'];
  }
  const texKey = (p) => texKeys(p).find(k => files.has(k)) || null;
  const hasModel = (p) => files.has(modelKey(p));
  const hasTexture = (p) => !!texKey(p);
  const isImageKey = (k) => /\.(blp|tga|dds|png)$/.test(k);
  const mime = (b) => b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0x42 && b[1] === 0x4c ? 'blp' : '';

  // ---- images: decoded up front (browser-native WebP), BLP fallback through the mdx-m3-viewer decoder
  const images = new Map(); // key -> HTMLImageElement | ImageData
  let readyPromise = null;
  function ready(onProgress) {
    if (readyPromise) return readyPromise;
    const keys = [...files.keys()].filter(isImageKey);
    let done = 0;
    readyPromise = Promise.all(keys.map(k => new Promise((res) => {
      const bytes = get(k); const m = mime(bytes);
      const finish = () => { done++; if (onProgress && done % 25 === 0) onProgress(done / keys.length); res(); };
      if (m === 'blp') {
        try { const b = new window.MdxParser.BlpImage(); b.load(bytes); images.set(k, b.getMipmap(0)); } catch (e) { console.warn('blp', k, e); }
        return finish();
      }
      if (!m) return finish();
      const url = URL.createObjectURL(new Blob([bytes], { type: m }));
      const img = new Image();
      img.onload = () => { images.set(k, img); urls.set(k, url); finish(); };
      img.onerror = () => { console.warn('image decode failed', k); finish(); };
      img.src = url;
    }))).then(() => { if (onProgress) onProgress(1); });
    return readyPromise;
  }
  function image(path) { const k = texKey(path); return k ? images.get(k) || null : null; }
  const dataCache = new Map();
  function imageData(path) { // -> ImageData | null (pixels; used for terrain atlases)
    const k = texKey(path); if (!k) return null;
    if (dataCache.has(k)) return dataCache.get(k);
    const im = images.get(k); let out = null;
    if (im && im.data) out = im;
    else if (im) { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); out = g.getImageData(0, 0, c.width, c.height); }
    dataCache.set(k, out); return out;
  }
  const texCache = new Map();
  function texture(path, wrapMode) {
    const k = texKey(path); if (!k) return null;
    const key = k + '|' + (wrapMode || 0);
    if (texCache.has(key)) return texCache.get(key);
    const im = images.get(k); let tex = null;
    if (im && im.data) tex = new THREE.DataTexture(new Uint8Array(im.data.buffer), im.width, im.height, THREE.RGBAFormat);
    else if (im) { tex = new THREE.Texture(im); tex.flipY = false; }
    if (tex) {
      tex.wrapS = (wrapMode & 1) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.wrapT = (wrapMode & 2) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
      tex.anisotropy = 4; tex.needsUpdate = true;
    }
    texCache.set(key, tex); return tex;
  }
  const urls = new Map();
  function imageURL(path) { // URL for DOM <img> / CSS (icons, UI art, minimap, loading screen)
    const k = texKey(path); if (!k) return null;
    if (urls.has(k)) return urls.get(k);
    const im = images.get(k); let url = null;
    if (im && im.data) { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').putImageData(im, 0, 0); url = c.toDataURL(); }
    urls.set(k, url); return url;
  }
  function blobURL(path, type) { // fonts / sounds
    const k = norm(path); const b = get(k); if (!b) return null;
    if (urls.has(k)) return urls.get(k);
    const u = URL.createObjectURL(new Blob([b], { type: type || 'application/octet-stream' })); urls.set(k, u); return u;
  }

  window.PyroAssets = { norm, get, modelKey, hasModel, hasTexture, image, imageData, texture, imageURL, blobURL, ready, has: (p) => files.has(norm(p)),
    count: () => files.size, list: () => [...files.keys()] };
})();
