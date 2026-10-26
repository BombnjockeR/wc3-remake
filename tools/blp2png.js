// Convert every .blp under <src> to .png under <dst> (same relative path + ".png").
// needs: npm i mdx-m3-viewer pngjs   (run from a folder where they are installed, or set NODE_PATH)
global.ImageData = class { constructor(a, b, c) { if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } else { this.data = a; this.width = b; this.height = c; } } };
const fs = require('fs'), path = require('path');
const { BlpImage } = require('mdx-m3-viewer/dist/cjs/parsers/blp/image');
const { PNG } = require('pngjs');
const [src, dst] = process.argv.slice(2);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const failed = [];
for (const f of walk(src)) {
  if (!/\.blp$/i.test(f)) continue;
  const out = path.join(dst, path.relative(src, f) + '.png');
  try {
    const b = new BlpImage(); b.load(fs.readFileSync(f)); const img = b.getMipmap(0);
    const png = new PNG({ width: img.width, height: img.height }); png.data = Buffer.from(img.data.buffer);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, PNG.sync.write(png));
  } catch (e) { failed.push(path.relative(src, f)); }
}
fs.writeFileSync(path.join(dst, '_failed.txt'), failed.join('\n'));
console.log('blp2png done,', failed.length, 'failed');
