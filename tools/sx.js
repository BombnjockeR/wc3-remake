// usage: node sx.js <wc3dir> <names.txt> <outdir>   (extract with StormLib; later archives override)
const { FS, MPQ } = require('@wowserhq/stormjs');
const fs = require('fs'), path = require('path');
(async () => {
  const [dir, list, out] = process.argv.slice(2);
  FS.mkdir('/w'); FS.mount(FS.filesystems.NODEFS, { root: dir }, '/w');
  const order = ['War3Patch.mpq', 'War3xLocal.mpq', 'War3x.mpq', 'war3.mpq'];
  const mpqs = []; for (const n of order) if (fs.existsSync(path.join(dir, n))) mpqs.push(await MPQ.open('/w/' + n, 'r'));
  const names = fs.readFileSync(list, 'utf8').split(/\r?\n/).filter(Boolean);
  let ok = 0; const miss = [];
  for (const n of names) {
    let data = null;
    for (const m of mpqs) { try { if (m.hasFile(n)) { const f = m.openFile(n); data = f.read(); f.close(); break; } } catch (e) {} }
    if (!data) { miss.push(n); continue; }
    const p = path.join(out, n.replace(/\\/g, '/').toLowerCase()); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(data)); ok++;
  }
  fs.writeFileSync(path.join(out, '_sx_missing.txt'), miss.join('\n'));
  console.log(ok, 'extracted', miss.length, 'missing');
})();
