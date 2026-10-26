/* Warcraft III terrain from war3map.w3e: corner heights + cliff layers, ground tiles blended the way WC3 does
 * (lowest texture full, higher textures with corner masks from a 4x4 atlas). Until the real tile textures
 * (TerrainArt\...) are provided, placeholder atlases in the same layout are generated.
 */
(function () {
  'use strict';
  const D = window.PYRO_DATA; const A = window.PyroAssets;
  const T = D.geo.terrain;
  // Sunken Ruins tileset ("Z") ground tiles -> TerrainArt files (used when your game files are added)
  const TILE_FILES = {
    Zdrt: 'TerrainArt\\Ruins\\Ruins_Dirt.blp', Zdtr: 'TerrainArt\\Ruins\\Ruins_DirtRough.blp', Zdrg: 'TerrainArt\\Ruins\\Ruins_DirtGrass.blp',
    Zbks: 'TerrainArt\\Ruins\\Ruins_SmallBricks.blp', Zsan: 'TerrainArt\\Ruins\\Ruins_Sand.blp', Zbkl: 'TerrainArt\\Ruins\\Ruins_LargeBricks.blp',
    Ztil: 'TerrainArt\\Ruins\\Ruins_RoundTiles.blp', Zgrs: 'TerrainArt\\Ruins\\Ruins_Grass.blp', Zvin: 'TerrainArt\\Ruins\\Ruins_GrassDark.blp',
    cOc1: 'TerrainArt\\Outland\\Outland_Cliffs.blp',
  };
  const CLIFF_GROUND = { 0: 'Zdrt', 1: 'Zbkl' }; // CZdi (dirt cliff) / CZlb (brick cliff) ground tiles
  // real file names from the game's Terrain.slk / CliffTypes.slk / Doodads.slk (written by tools/import_wc3.py)
  const GF = window.PYRO_GAMEFILES || {};
  Object.assign(TILE_FILES, GF.tiles || {});
  (T.cliffTiles || []).forEach((cid, i) => { const c = (GF.cliffs || {})[cid]; if (c && c.ground && T.ground.includes(c.ground)) CLIFF_GROUND[i] = c.ground; });
  const COLORS = {
    Zdrt: [120, 94, 62], Zdtr: [104, 86, 60], Zdrg: [92, 104, 58], Zbks: [138, 132, 118], Zsan: [178, 158, 112], Zbkl: [124, 118, 104],
    Ztil: [156, 150, 134], Zgrs: [70, 112, 46], Zvin: [56, 92, 40], cOc1: [96, 82, 66], cliff: [92, 84, 74],
  };

  // ---------------------------------------------------------------- placeholder atlas (same layout as WC3 512x256 tiles)
  function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function paintTile(g, x0, y0, col, kind, r) {
    g.fillStyle = `rgb(${col.join(',')})`; g.fillRect(x0, y0, 64, 64);
    for (let i = 0; i < 70; i++) { // speckle noise
      const s = 0.82 + r() * 0.36; g.fillStyle = `rgba(${col.map(c => Math.min(255, c * s) | 0).join(',')},0.8)`;
      g.fillRect(x0 + r() * 64, y0 + r() * 64, 2 + r() * 5, 2 + r() * 5);
    }
    if (kind === 'bricks' || kind === 'tiles') {
      g.strokeStyle = 'rgba(40,36,30,0.55)'; g.lineWidth = 2; const n = kind === 'tiles' ? 2 : 4; const st = 64 / n;
      for (let yy = 0; yy < n; yy++) for (let xx = 0; xx < n; xx++) {
        const off = kind === 'bricks' && yy % 2 ? st / 2 : 0;
        g.strokeRect(x0 + xx * st + off + 1, y0 + yy * st + 1, st - 2, st - 2);
      }
    }
    if (kind === 'grass') { g.strokeStyle = 'rgba(30,60,20,0.5)'; for (let i = 0; i < 40; i++) { const x = x0 + r() * 64, y = y0 + r() * 64; g.beginPath(); g.moveTo(x, y); g.lineTo(x + r() * 3 - 1.5, y - 4 - r() * 4); g.stroke(); } }
  }
  function placeholderAtlas(id) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
    const col = COLORS[id] || [110, 110, 110];
    const kind = /bks|bkl/.test(id) ? 'bricks' : id === 'Ztil' ? 'tiles' : /grs|vin|drg/.test(id) ? 'grass' : 'dirt';
    const r = rnd(id.split('').reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
    // right half: 16 full variations
    for (let v = 0; v < 16; v++) paintTile(g, 256 + (v % 4) * 64, Math.floor(v / 4) * 64, col, kind, r);
    // left half: corner masks (bit 1 = bottom-right, 2 = bottom-left, 4 = top-right, 8 = top-left); 0 and 15 are full tiles
    const tmp = document.createElement('canvas'); tmp.width = tmp.height = 64; const tg = tmp.getContext('2d');
    for (let v = 0; v < 16; v++) {
      const x0 = (v % 4) * 64, y0 = Math.floor(v / 4) * 64;
      tg.clearRect(0, 0, 64, 64); tg.globalCompositeOperation = 'source-over'; paintTile(tg, 0, 0, col, kind, r);
      if (v !== 0 && v !== 15) {
        const m = document.createElement('canvas'); m.width = m.height = 64; const mg = m.getContext('2d');
        const corners = [[1, 64, 64], [2, 0, 64], [4, 64, 0], [8, 0, 0]];
        for (const [bit, cx, cy] of corners) if (v & bit) {
          const grd = mg.createRadialGradient(cx, cy, 20, cx, cy, 46); grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          mg.fillStyle = grd; mg.fillRect(0, 0, 64, 64);
        }
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-over';
      }
      g.drawImage(tmp, x0, y0);
    }
    return c;
  }
  function tileTexture(id) {
    const file = TILE_FILES[id]; let canvas = null, real = false;
    const img = file && A.image ? A.image(file) : null;
    if (img && !img.data) { canvas = img; real = true; }
    else if (img) { canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').putImageData(img, 0, 0); real = true; }
    else canvas = placeholderAtlas(id);
    const tex = canvas.getContext ? new THREE.CanvasTexture(canvas) : new THREE.Texture(canvas); tex.needsUpdate = true;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 8;
    return { tex, extended: canvas.width > canvas.height, real };
  }

  // number of extra variations per cliff shape (CliffsXXXX0..n.mdx / CityCliffsXXXX0..n.mdx)
  const CLIFF_VARS = { AAAB: 1, AAAC: 1, AABA: 1, AABB: 2, AACA: 1, AACC: 1, ABAA: 1, ABAB: 1, ABBA: 2, ABBB: 1, ACAA: 1, ACAC: 1, ACCA: 1, ACCC: 1,
    BAAA: 1, BAAB: 1, BABA: 1, BABB: 1, BBAA: 1, BBAB: 1, BBBA: 1, CAAA: 1, CAAC: 1, CACA: 1, CACC: 1, CCAA: 1, CCAC: 1, CCCA: 1 };
  const CITY_CLIFF_VARS = { AAAB: 2, AAAC: 1, AABA: 1, AABB: 3, AACA: 1, AACC: 3, ABAA: 1, ABAB: 2, ABBA: 3, ACAA: 1, ACAC: 2, ACCA: 3, ACCC: 1,
    BAAA: 1, BAAB: 3, BABA: 2, BBAA: 3, BBAB: 1, BBBA: 1, CAAA: 1, CAAC: 3, CACA: 2, CACC: 1, CCAA: 3, CCAC: 1, CCCA: 1 };

  // ---------------------------------------------------------------- terrain data
  const W = T.w, H = T.h;
  const idx = (x, y) => y * W + x;
  const cornerZ = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) cornerZ[i] = (T.height[i] + T.layer[i] - 2) * 128;
  function isCliff(x, y) {
    if (x < 1 || x > W - 3 || y < 1 || y > H - 3) return false;
    const l = T.layer[idx(x, y)];
    return l !== T.layer[idx(x + 1, y)] || l !== T.layer[idx(x, y + 1)] || l !== T.layer[idx(x + 1, y + 1)];
  }
  function isRamp(x, y) { return !!(T.flags[idx(x, y)] & 1); }
  function cornerTexture(x, y) {
    for (let dy = -1; dy < 1; dy++) for (let dx = -1; dx < 1; dx++) {
      if (isCliff(x + dx, y + dy) && !isRamp(x + dx, y + dy)) {
        const ct = T.cliffTex[idx(x + dx, y + dy)]; const gid = CLIFF_GROUND[ct === 15 ? 1 : ct] || 'Zdrt';
        const gi = T.ground.indexOf(gid); return gi >= 0 ? gi : 0;
      }
    }
    return T.tex[idx(x, y)];
  }
  function heightAt(x, y) {
    const fx = (x - T.minX) / 128, fy = (y - T.minY) / 128;
    const ix = Math.max(0, Math.min(W - 2, Math.floor(fx))), iy = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - ix)), ty = Math.max(0, Math.min(1, fy - iy));
    const a = cornerZ[idx(ix, iy)], b = cornerZ[idx(ix + 1, iy)], c = cornerZ[idx(ix, iy + 1)], d = cornerZ[idx(ix + 1, iy + 1)];
    if (isCliff(ix, iy) && !isRamp(ix, iy)) { // on a cliff tile use the nearest corner level (no sliding down walls)
      return [[a, tx + ty], [b, 1 - tx + ty], [c, tx + 1 - ty], [d, 2 - tx - ty]].sort((p, q) => p[1] - q[1])[0][0];
    }
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  // ---------------------------------------------------------------- mesh
  function build(scene) {
    const group = new THREE.Group(); group.name = 'terrain';
    const tiles = T.ground.map(id => ({ id, ...tileTexture(id) }));
    const groundVar = (ti, v) => {
      if (tiles[ti].extended) return v < 16 ? 16 + v : v === 16 ? 15 : 0;
      return v === 0 ? 0 : 15;
    };
    // per texture: base quads and overlay quads
    const buckets = tiles.map(() => ({ base: [], over: [] }));
    const cliffQuads = [];
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      if (isCliff(x, y) && !isRamp(x, y)) { cliffQuads.push([x, y]); continue; }
      const bl = cornerTexture(x, y), br = cornerTexture(x + 1, y), tl = cornerTexture(x, y + 1), tr = cornerTexture(x + 1, y + 1);
      const texs = [...new Set([bl, br, tl, tr])].sort((a, b) => a - b);
      buckets[texs[0]].base.push([x, y, groundVar(texs[0], T.groundVar[idx(x, y)])]);
      for (const t of texs.slice(1)) {
        let bits = 0; if (br === t) bits |= 1; if (bl === t) bits |= 2; if (tr === t) bits |= 4; if (tl === t) bits |= 8;
        buckets[t].over.push([x, y, bits]);
      }
    }
    const normalAt = (x, y) => {
      const z = (xx, yy) => cornerZ[idx(Math.max(0, Math.min(W - 1, xx)), Math.max(0, Math.min(H - 1, yy)))];
      return new THREE.Vector3(z(x - 1, y) - z(x + 1, y), z(x, y - 1) - z(x, y + 1), 256).normalize();
    };
    function quadGeometry(list, extended) {
      const pos = [], nor = [], uv = [], ind = [];
      const cols = extended ? 8 : 4;
      list.forEach(([x, y, v], i) => {
        const cx = v < 16 ? v % 4 : 4 + (v - 16) % 4, cy = v < 16 ? Math.floor(v / 4) : Math.floor((v - 16) / 4);
        const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
        for (const [px, py] of corners) {
          const X = x + px, Y = y + py;
          pos.push(T.minX + X * 128, T.minY + Y * 128, cornerZ[idx(X, Y)]);
          const n = normalAt(X, Y); nor.push(n.x, n.y, n.z);
          const eps = 0.5 / 64; // avoid bleeding between atlas cells
          uv.push((cx + Math.min(1 - eps, Math.max(eps, px))) / cols, 1 - (cy + 1 - Math.min(1 - eps, Math.max(eps, py))) / 4);
        }
        const o = i * 4; ind.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(ind); return g;
    }
    buckets.forEach((b, ti) => {
      const t = tiles[ti];
      if (b.base.length) {
        const m = new THREE.Mesh(quadGeometry(b.base, t.extended), new THREE.MeshLambertMaterial({ map: t.tex }));
        m.renderOrder = -100; m.userData.ground = true; group.add(m);
      }
      if (b.over.length) {
        const m = new THREE.Mesh(quadGeometry(b.over, t.extended), new THREE.MeshLambertMaterial({ map: t.tex, transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 - ti }));
        m.renderOrder = -90 + ti; m.userData.ground = true; group.add(m);
      }
    });
    // cliffs: Warcraft's cliff models (Doodads\Terrain\<dir>\<dir><BL><TL><TR><BR><variation>.mdx), bent to the ground heights
    const cliffGroups = new Map(); // texture -> {pos, nor, uv, ind}
    const fallback = [];
    for (const [x, y] of cliffQuads) {
      const L = (xx, yy) => T.layer[idx(xx, yy)];
      const bl = L(x, y), br = L(x + 1, y), tl = L(x, y + 1), tr = L(x + 1, y + 1); const base = Math.min(bl, br, tl, tr);
      const name = String.fromCharCode(65 + bl - base, 65 + tl - base, 65 + tr - base, 65 + br - base);
      if (name === 'AAAA') continue;
      let ct = T.cliffTex[idx(x, y)]; if (ct === 15) ct = 1;
      const info = (GF.cliffs || {})[T.cliffTiles[ct]]; if (!info) { fallback.push([x, y]); continue; }
      const dir = info.dir; const v = Math.min(T.cliffVar[idx(x, y)] || 0, (dir === 'Cliffs' ? CLIFF_VARS : CITY_CLIFF_VARS)[name] || 0);
      const md = A.hasModel(`Doodads\\Terrain\\${dir}\\${dir}${name}${v}.mdx`) ? window.PyroMDX.load(`Doodads\\Terrain\\${dir}\\${dir}${name}${v}.mdx`)
        : A.hasModel(`Doodads\\Terrain\\${dir}\\${dir}${name}0.mdx`) ? window.PyroMDX.load(`Doodads\\Terrain\\${dir}\\${dir}${name}0.mdx`) : null;
      if (!md || !md.m.geosets.length) { fallback.push([x, y]); continue; }
      const gs = md.m.geosets[0];
      let G = cliffGroups.get(info.tex); if (!G) cliffGroups.set(info.tex, G = { pos: [], nor: [], uv: [], ind: [] });
      const ox = T.minX + (x + 1) * 128, oy = T.minY + y * 128, oz = (base - 2) * 128;
      const hBL = T.height[idx(x, y)], hBR = T.height[idx(x + 1, y)], hTL = T.height[idx(x, y + 1)], hTR = T.height[idx(x + 1, y + 1)];
      const off = G.pos.length / 3; const V = gs.vertices, N = gs.normals, UV = gs.uvSets[0];
      for (let i = 0; i < V.length; i += 3) {
        const px = V[i], py = V[i + 1], pz = V[i + 2];
        const fx = Math.max(0, Math.min(1, -px / 128)), fy = Math.max(0, Math.min(1, py / 128));
        const bottom = hBR + (hBL - hBR) * fx, top = hTR + (hTL - hTR) * fx; const h = bottom + (top - bottom) * fy;
        G.pos.push(ox + px, oy + py, oz + pz + h * 128); G.nor.push(N[i], N[i + 1], N[i + 2]);
      }
      for (let i = 0; i < UV.length; i++) G.uv.push(UV[i]);
      for (const f of gs.faces) G.ind.push(off + f);
    }
    for (const [tex, G] of cliffGroups) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(G.uv, 2)); g.setIndex(G.ind);
      const map = A.texture(tex, 0);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : 0x8a8070 })); m.renderOrder = -100; m.userData.ground = true; group.add(m);
    }
    if (fallback.length) { // no cliff model available: steep textured quads
      const pos = [], uv = [], ind = [];
      fallback.forEach(([x, y], i) => {
        for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const X = x + px, Y = y + py; const z = cornerZ[idx(X, Y)];
          pos.push(T.minX + X * 128, T.minY + Y * 128, z); uv.push(X * 0.5, Y * 0.5 + z / 256);
        }
        const o = i * 4; ind.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(ind); g.computeVertexNormals();
      const tex = new THREE.CanvasTexture(placeholderAtlas('cliff')); tex.repeat.set(0.5, 1); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, color: 0xb0a898 }));
      m.renderOrder = -100; m.userData.ground = true; group.add(m);
    }
    group.add(buildDoodads());
    scene.add(group);
    return group;
  }

  // ---------------------------------------------------------------- doodads: real models (static ones instanced, animated ones as full instances)
  function staticParts(md, texOverride) { // a model in its bind pose, as plain meshes (for instancing)
    const parts = [];
    for (const gs of md.geosets) {
      if (gs.lod > 0) continue; const mat = md.m.materials[gs.materialId]; if (!mat || !mat.layers.length) continue;
      const ga = md.geosetAnims[gs.index]; if (ga && ga.alpha === 0 && !(ga.animations || []).length) continue;
      const layer = mat.layers[0]; const tex = md.m.textures[layer.textureId]; const f = layer.filterMode;
      let map = null;
      if (tex && tex.replaceableId && texOverride) map = A.texture(texOverride, 0);
      else if (tex && tex.path) map = A.texture(tex.path, tex.wrapMode);
      if (!map && (f >= 1 || (tex && tex.replaceableId))) continue; // shadows / effect planes without their texture
      const twoSided = !!(layer.flags & 16) || !!(mat.flags & 2);
      const P = { map, color: map ? 0xffffff : 0x777766, side: twoSided ? THREE.DoubleSide : THREE.FrontSide };
      if (f === 1) P.alphaTest = 0.6; else if (f >= 2) { P.transparent = true; P.depthWrite = false; }
      if (f === 3 || f === 4) { P.blending = THREE.AdditiveBlending; }
      parts.push({ geo: gs.geo, mat: (layer.flags & 1) ? new THREE.MeshBasicMaterial(P) : new THREE.MeshLambertMaterial(P) });
    }
    return parts.length ? parts : null;
  }
  const animatedDoodads = [];
  function placeReal(g, id, list) { // list: [{x,y,z,scale,angle,variation}]
    const rec = (GF.doodads || {})[id]; if (!rec || !rec.file) return false;
    const byVar = new Map();
    for (const d of list) { const v = rec.numVar > 1 ? Math.min(d.variation || 0, rec.numVar - 1) : -1; if (!byVar.has(v)) byVar.set(v, []); byVar.get(v).push(d); }
    let any = false;
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3(); const Z = new THREE.Vector3(0, 0, 1);
    for (const [v, items] of byVar) {
      const path = rec.file + (v >= 0 ? v : '') + '.mdx';
      const md = A.hasModel(path) ? window.PyroMDX.load(path) : null; if (!md) continue; any = true;
      const angle = (d) => rec.fixedRot >= 0 ? rec.fixedRot * Math.PI / 180 : (d.angle || 0);
      const animated = (md.m.particleEmitters2 || []).length || (md.m.ribbonEmitters || []).length;
      if (animated) {
        for (const d of items) {
          const inst = new window.PyroMDX.Instance(md, { fxRoot: g }); inst.play('stand', { loop: true });
          inst.group.position.set(d.x, d.y, d.z != null ? d.z : heightAt(d.x, d.y)); inst.group.rotation.z = angle(d); inst.group.scale.setScalar(d.scale || 1);
          inst.group.updateMatrixWorld(); g.add(inst.group); animatedDoodads.push(inst);
        }
        continue;
      }
      const parts = staticParts(md, rec.tex); if (!parts) continue;
      for (const part of parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, items.length);
        items.forEach((d, i) => { q.setFromAxisAngle(Z, angle(d)); const sc = d.scale || 1; m.compose(p.set(d.x, d.y, d.z != null ? d.z : heightAt(d.x, d.y)), q, s.set(sc, sc, sc)); im.setMatrixAt(i, m); });
        im.frustumCulled = false; g.add(im);
      }
    }
    return any;
  }
  function updateDoodads(dtMs, camera) { // animated doodads near the camera (braziers, fires)
    for (const inst of animatedDoodads) {
      const dx = inst.group.position.x - camera.position.x, dy = inst.group.position.y - camera.position.y;
      if (dx * dx + dy * dy > 4500 * 4500) continue;
      inst.update(dtMs, camera);
    }
  }
  function buildDoodads() {
    const g = new THREE.Group();
    const r = rnd(42);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(); const p = new THREE.Vector3();
    // trees (LTlt): [x, y, scale, angle, variation]
    const trees = D.geo.trees.map(t => ({ x: t[0], y: t[1], scale: t[2] || 1, angle: t[3] || 0, variation: t[4] || 0 }));
    if (!placeReal(g, 'LTlt', trees)) {
      const trunkGeo = new THREE.CylinderGeometry(9, 13, 70, 6); trunkGeo.rotateX(Math.PI / 2); trunkGeo.translate(0, 0, 35);
      const leaf1 = new THREE.ConeGeometry(70, 130, 7); leaf1.rotateX(Math.PI / 2); leaf1.translate(0, 0, 120);
      const leaf2 = new THREE.ConeGeometry(52, 110, 7); leaf2.rotateX(Math.PI / 2); leaf2.translate(0, 0, 190);
      const leafGeo = mergeGeos([leaf1, leaf2]);
      const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3d22 }), trees.length);
      const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x2f5a22, flatShading: true }), trees.length);
      trees.forEach((t, i) => {
        const sc = 0.85 + r() * 0.35; q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), r() * 6.28);
        m.compose(p.set(t.x, t.y, heightAt(t.x, t.y)), q, s.set(sc, sc, sc)); trunk.setMatrixAt(i, m); leaves.setMatrixAt(i, m);
      });
      g.add(trunk, leaves);
    }
    // other doodads: [id, x, y, scale, z, angle, variation]
    const byId = new Map();
    for (const d of D.geo.doodads) { if (!byId.has(d[0])) byId.set(d[0], []); byId.get(d[0]).push({ x: d[1], y: d[2], scale: d[3] || 1, z: d[4], angle: d[5] || 0, variation: d[6] || 0 }); }
    const rest = [];
    for (const [id, list] of byId) if (!placeReal(g, id, list)) rest.push(...list);
    if (rest.length) {
      const rock = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(30, 0), new THREE.MeshLambertMaterial({ color: 0x8a8070, flatShading: true }), rest.length);
      rest.forEach((d, i) => {
        const sc = d.scale * (0.8 + r() * 0.6); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), d.angle);
        m.compose(p.set(d.x, d.y, heightAt(d.x, d.y) + 10), q, s.set(sc * 1.3, sc, sc * 0.8)); rock.setMatrixAt(i, m);
      });
      g.add(rock);
    }
    return g;
  }
  function mergeGeos(list) {
    const pos = [], nor = [], ind = []; let off = 0;
    for (const geo of list) {
      const g = geo.index ? geo : geo; const p = g.attributes.position, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
      const ix = g.index ? Array.from(g.index.array) : [...Array(p.count).keys()];
      ix.forEach(v => ind.push(v + off)); off += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setIndex(ind);
    return out;
  }

  window.PyroTerrain = { build, heightAt, isCliff, TILE_FILES, updateDoodads };
})();
