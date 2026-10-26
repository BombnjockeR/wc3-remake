"""Build the browser asset packs from extracted Warcraft III files.

usage: python3 tools/build_assets.py <wc3_files_dir> <wc3_png_dir> <map_files_dir> <map_png_dir> <slk_dir>

  wc3_files_dir  files extracted from the game MPQs (lowercase paths, '/' separators), e.g. by tools/wc3x.py
  wc3_png_dir    the same .blp files decoded to .png by tools/blp2png.js (<path>.blp.png)
  map_files_dir  files imported in the map (war3mapImported\\..., renamed blocks)
  map_png_dir    their .blp decoded to .png
  slk_dir        folder with terrainart/*.slk, doodads/doodads.slk, units/destructabledata.slk, splats/*.slk

Writes assets/wc3-N.js, assets/map-0.js, assets/wc3-files.js and assets/packs.js.
Textures are stored as WebP (much smaller and decoded natively by the browser); their key stays the
original .blp path so models find them.
"""
import base64, io, json, os, re, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
wc3_dir, wc3_png, map_dir, map_png, slk_dir = sys.argv[1:6]
OUT = os.path.join(ROOT, 'assets'); os.makedirs(OUT, exist_ok=True)
sys.path.insert(0, HERE)

SKIP = re.compile(r'^(ui/widgets/glues/|ui/feedback/(?!goldcredit|confirmation|target|resources/|rallypoint|selectioncircle)|ui/glues/(?!loading/loadbar|singleplayer/humancampaign3d)|_manifest|listfile)')
MAP_RENAME = {'unknown/block28.mdx': 'war3mapimported/bloodelfmage_portrait.mdx', 'unknown/block52.mdx': 'war3mapimported/orc warlock_portrait.mdx',
              'unknown/block50.mdx': 'pyro/standin/castle.mdx', 'unknown/block54.mdx': 'war3mapimported/customloadingscreen.mdx'}


def webp(png_path, key):
    im = Image.open(png_path).convert('RGBA')
    lossless = im.size[0] * im.size[1] <= 32 * 32 or key.startswith(('ui/', 'replaceabletextures/teamcolor', 'replaceabletextures/teamglow'))
    buf = io.BytesIO()
    if im.getextrema()[3] == (255, 255):  # no alpha: smaller file
        im = im.convert('RGB')
    im.save(buf, 'WEBP', quality=90, lossless=lossless, method=4)
    return buf.getvalue()


def collect(files_dir, png_dir, rename=None):
    out = {}
    for dp, dn, fn in os.walk(files_dir):
        for f in fn:
            full = os.path.join(dp, f)
            rel = os.path.relpath(full, files_dir).replace('\\', '/').lower()
            rel = (rename or {}).get(rel, rel)
            if SKIP.match(rel):
                continue
            key = rel.replace('/', '\\')
            if rel.endswith('.blp'):
                png = os.path.join(png_dir, os.path.relpath(full, files_dir) + '.png')
                if not os.path.exists(png):
                    continue  # undecodable (a few building shadows)
                out[key] = webp(png, rel)
            elif rel.endswith(('.mdx', '.ttf', '.mp3', '.wav', '.ogg')):
                out[key] = open(full, 'rb').read()
    return out


def write_packs(name, files, limit=15_000_000):
    for f in os.listdir(OUT):
        if re.match(re.escape(name) + r'-\d+\.js$', f):
            os.remove(os.path.join(OUT, f))
    packs, cur, size = [], {}, 0
    for k in sorted(files):
        b = base64.b64encode(files[k]).decode()
        if size + len(b) > limit and cur:
            packs.append(cur); cur, size = {}, 0
        cur[k] = b; size += len(b)
    if cur:
        packs.append(cur)
    for i, pk in enumerate(packs):
        with open(os.path.join(OUT, '%s-%d.js' % (name, i)), 'w') as fh:
            fh.write('(window.PYRO_ASSET_PACKS = window.PYRO_ASSET_PACKS || []).push(' + json.dumps(pk, separators=(',', ':')) + ');\n')
    print(name, len(files), 'files in', len(packs), 'pack(s),', sum(len(v) for v in files.values()) // 1024, 'KB')
    return len(packs)


# ---------------------------------------------------------------- game tables the renderer needs
def slk(path):
    from slkutil import slk_rows
    return slk_rows(open(os.path.join(slk_dir, path), encoding='latin-1').read())


src = open(os.path.join(ROOT, 'src', 'gamedata.js'), encoding='utf-8').read()
D = json.loads(src[src.index('{'): src.rindex('}') + 1])
T = slk('terrainart/terrain.slk'); C = slk('terrainart/clifftypes.slk')
DE = slk('units/destructabledata.slk'); DO = slk('doodads/doodads.slk')
US = slk('splats/ubersplatdata.slk'); LD = slk('splats/lightningdata.slk')
gf = {'tiles': {}, 'cliffs': {}, 'doodads': {}, 'uberSplats': {}, 'lightning': {}}
for g in D['geo']['terrain']['ground']:
    if g in T: gf['tiles'][g] = T[g]['dir'] + '\\' + T[g]['file'] + '.blp'
for c in D['geo']['terrain']['cliffTiles']:
    r = C[c]; gf['cliffs'][c] = {'dir': r['cliffmodeldir'], 'ramp': r['rampmodeldir'], 'tex': r['texdir'] + '\\' + r['texfile'] + '.blp', 'ground': r['groundtile']}
for did in {'LTlt'} | {d[0] for d in D['geo']['doodads']}:
    r = DE.get(did) or DO.get(did)
    if not r: continue
    rec = {'file': r['file'], 'numVar': int(float(r.get('numvar') or 1)), 'fixedRot': float(r.get('fixedrot') or -1)}
    if r.get('texfile') and r['texfile'] not in ('_', ''):
        rec['tex'] = r['texfile'] + ('' if r['texfile'].lower().endswith('.blp') else '.blp'); rec['texId'] = int(float(r.get('texid') or 0))
    gf['doodads'][did] = rec
for u in D['units'].values():
    s = u.get('uberSplat')
    if s and s in US:
        r = US[s]; gf['uberSplats'][s] = {'tex': r['dir'] + '\\' + r['file'] + '.blp', 'scale': float(r['scale']), 'blend': int(r['blendmode'])}
for k, r in LD.items():
    if k == 'INIT': continue
    gf['lightning'][k] = {'tex': r['dir'] + '\\' + r['file'], 'width': float(r['width']), 'seg': float(r['avgseglen']),
                          'color': [int(r['r']), int(r['g']), int(r['b']), int(r['a'])], 'noise': float(r['noisescale']), 'uv': float(r['texcoordscale'])}

wc3 = collect(wc3_dir, wc3_png)
mp = collect(map_dir, map_png, MAP_RENAME)
for k in list(wc3):
    if k in mp: del wc3[k]  # the map's own files win
n1 = write_packs('wc3', wc3)
write_packs('map', mp)
with open(os.path.join(OUT, 'wc3-files.js'), 'w') as fh:
    fh.write('window.PYRO_GAMEFILES = ' + json.dumps(gf, separators=(',', ':')) + ';\n')
names = ['map-0.js'] + ['wc3-%d.js' % i for i in range(n1)] + ['wc3-files.js'] + (['sounds.js'] if os.path.exists(os.path.join(OUT, 'sounds.js')) else [])
with open(os.path.join(OUT, 'packs.js'), 'w') as fh:
    fh.write('// generated by tools/build_assets.py: loads every asset pack (works from file:// too)\n')
    for n in names:
        fh.write("document.write('<script src=\"assets/%s\"><\\/script>');\n" % n)
print('wrote assets/packs.js')
