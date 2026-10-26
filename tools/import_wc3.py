"""Import the Warcraft III game files this map needs (models, textures, icons, terrain tiles, trees/doodads)
into asset packs the browser game loads (assets/wc3-N.js + assets/wc3-files.js).

usage:
  python3 tools/import_wc3.py <source> [<source> ...]

<source> can be
  * a folder with extracted game files, e.g. a CascView export of Warcraft III Reforged
    (the folder that contains "war3.w3mod"), or any folder laid out like the game archives
    (Units\\..., ReplaceableTextures\\..., TerrainArt\\...);
  * a classic MPQ archive: War3.mpq, War3x.mpq, War3xLocal.mpq, War3Patch.mpq
    (list them in that order: later sources override earlier ones).

Only the files the map actually uses are copied (plus the textures those models reference),
so the result stays small. Reforged HD files are skipped: the classic (SD) files are used.
Your own files only: this tool never downloads anything.
"""
import json, os, re, struct, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, 'extract'))
from mpq import MPQ  # noqa: E402

norm = lambda p: str(p or '').replace('/', '\\').strip().lower()


# ---------------------------------------------------------------- sources
class FolderSource:
    def __init__(self, path):
        self.files = {}
        for dp, dn, fn in os.walk(path):
            dn[:] = [d for d in dn if d.lower() not in ('_hd.w3mod', '_teen.w3mod', '_balance')]
            for f in fn:
                rel = norm(os.path.relpath(os.path.join(dp, f), path))
                # Reforged layout: war3.w3mod\..., war3.w3mod\_locales\enus.w3mod\...
                rel = re.sub(r'^.*?war3\.w3mod\\(_locales\\[a-z]{4}\.w3mod\\)?', '', rel)
                if '_hd.w3mod' in rel:
                    continue
                self.files.setdefault(rel, os.path.join(dp, f))

    def read(self, name):
        p = self.files.get(norm(name))
        return open(p, 'rb').read() if p else None


class MpqSource:
    def __init__(self, path):
        self.m = MPQ(path)

    def read(self, name):
        try:
            return self.m.read(str(name).replace('/', '\\'))
        except Exception:
            return None


sources = []
for a in sys.argv[1:]:
    if os.path.isdir(a):
        sources.append(FolderSource(a))
    elif a.lower().endswith('.mpq') and os.path.isfile(a):
        sources.append(MpqSource(a))
    else:
        sys.exit('not a folder or .mpq file: ' + a)
if not sources:
    sys.exit(__doc__)


def read(name):
    for s in reversed(sources):  # later sources override earlier ones
        d = s.read(name)
        if d is not None:
            return d
    return None


def read_any(path, exts):
    base = re.sub(r'\.(mdl|mdx|blp|tga|dds)$', '', norm(path))
    for e in exts:
        d = read(base + e)
        if d is not None:
            return base + e, d
    return None, None


# ---------------------------------------------------------------- SLK (game tables)
def slk_rows(text):
    rows, x, y = {}, 0, 0
    for line in text.splitlines():
        if not line.startswith('C;'):
            continue
        val = None
        for p in line.split(';')[1:]:
            if not p:
                continue
            if p[0] == 'X': x = int(p[1:])
            elif p[0] == 'Y': y = int(p[1:])
            elif p[0] == 'K':
                v = p[1:]
                val = v[1:-1] if v.startswith('"') and v.endswith('"') else v
        if val is not None:
            rows.setdefault(y, {})[x] = val
    if 1 not in rows:
        return {}
    head = {x: str(n).lower() for x, n in rows.pop(1).items()}
    out = {}
    for y, r in rows.items():
        rec = {head[x]: v for x, v in r.items() if x in head}
        k = rec.get(head[min(head)])
        if k:
            out[k] = rec
    return out


def slk(name):
    d = read(name)
    return slk_rows(d.decode('latin-1')) if d else {}


# ---------------------------------------------------------------- MDX texture list
def mdx_textures(b):
    out = []
    if b[:4] != b'MDLX':
        return out
    o = 4
    while o + 8 <= len(b):
        tag = b[o:o + 4]; size = struct.unpack_from('<I', b, o + 4)[0]
        if tag == b'TEXS':
            for i in range(size // 268):
                e = b[o + 8 + i * 268: o + 8 + (i + 1) * 268]
                rid = struct.unpack_from('<I', e, 0)[0]
                path = e[4:264].split(b'\0')[0].decode('latin-1')
                out.append((rid, path))
        o += 8 + size
    return out


# ---------------------------------------------------------------- what the map needs
src = open(os.path.join(ROOT, 'src', 'gamedata.js'), encoding='utf-8').read()
D = json.loads(src[src.index('{'): src.rindex('}') + 1])
models, icons = set(), set()
for u in D['units'].values():
    for k in ('model', 'missileArt', 'specialArt'):
        for p in str(u.get(k) or '').split(','):
            if p.strip(): models.add(p.strip())
    if u.get('model'):
        models.add(re.sub(r'\.(mdl|mdx)$', '', u['model'], flags=re.I) + '_portrait.mdx')
    if u.get('art'): icons.add(u['art'])
for a in D['abilities'].values():
    for k in ('casterArt', 'targetArt', 'effectArt', 'missileArt'):
        for p in str(a.get(k) or '').split(','):
            if p.strip(): models.add(p.strip())
    for k in ('icon', 'researchArt'):
        if a.get(k): icons.add(a[k])
icons |= {'ReplaceableTextures\\CommandButtons\\BTN' + n + '.blp' for n in ('Move', 'Stop', 'HoldPosition', 'HumanBuild', 'Cancel', 'Attack')}
for i in list(icons):
    n = norm(i)
    icons.add(n.replace('commandbuttons\\btn', 'commandbuttonsdisabled\\disbtn').replace('passivebuttons\\pasbtn', 'commandbuttonsdisabled\\dispasbtn'))
# models used by the map's triggers, buffs and the interface
models |= {
    'Abilities\\Spells\\Demon\\DarkPortal\\DarkPortalTarget.mdl', 'Abilities\\Spells\\Items\\AIem\\AIemTarget.mdl',
    'Abilities\\Spells\\Other\\BreathOfFire\\BreathOfFireDamage.mdl', 'Abilities\\Spells\\Human\\HolyBolt\\HolyBoltSpecialArt.mdl',
    'Abilities\\Spells\\Other\\ImmolationRed\\ImmolationRedDamage.mdl',
    'Objects\\Spawnmodels\\Naga\\NagaDeath\\NagaDeath.mdl', 'Objects\\Spawnmodels\\NightElf\\NECancelDeath\\NECancelDeath.mdl',
    'Objects\\Spawnmodels\\Human\\HCancelDeath\\HCancelDeath.mdl', 'Objects\\Spawnmodels\\Undead\\UCancelDeath\\UCancelDeath.mdl',
    'Abilities\\Spells\\Other\\FrostDamage\\FrostDamage.mdl', 'Abilities\\Spells\\Other\\Stun\\StunnedState.mdl',
    'Abilities\\Spells\\Human\\Blizzard\\BlizzardTarget.mdl', 'Abilities\\Spells\\Orc\\Bloodlust\\BloodlustTarget.mdl',
    'Abilities\\Spells\\Orc\\Bloodlust\\BloodlustSpecial.mdl', 'Abilities\\Spells\\Other\\GeneralAuraTarget\\GeneralAuraTarget.mdl',
    'Abilities\\Spells\\Orc\\SpiritLink\\SpiritLinkTarget.mdl', 'Abilities\\Weapons\\Bolt\\BoltImpact.mdl',
    'Abilities\\Spells\\Orc\\FeralSpirit\\feralspirittarget.mdl', 'Abilities\\Spells\\Human\\ThunderClap\\ThunderClapCaster.mdl',
    'Abilities\\Spells\\Orc\\WarStomp\\WarStompCaster.mdl', 'Abilities\\Spells\\Undead\\Impale\\ImpaleHitTarget.mdl',
    'Abilities\\Spells\\Human\\MassTeleport\\MassTeleportTarget.mdl', 'Abilities\\Spells\\Items\\AIil\\AIilTarget.mdl',
    'UI\\Feedback\\Confirmation\\Confirmation.mdl', 'UI\\Feedback\\SelectionCircle\\SelectionCircle.mdl',
    'UI\\Feedback\\SelectionCircleUnit\\SelectionCircleUnit.mdl', 'UI\\Feedback\\SelectionCircleEnemy\\SelectionCircleEnemy.mdl',
    'UI\\Feedback\\RallyPoint\\RallyPoint.mdl', 'UI\\Feedback\\TargetPreSelected\\TargetPreSelected.mdl', 'UI\\Feedback\\Target\\Target.mdl',
    'UI\\Feedback\\GoldCredit\\GoldCredit.mdl', 'UI\\Console\\Human\\HumanUI-TimeIndicator.mdl', 'UI\\Cursor\\HumanCursor.mdl',
    'Environment\\DNC\\DNCLordaeron\\DNCLordaeronUnit\\DNCLordaeronUnit.mdl', 'Environment\\DNC\\DNCLordaeron\\DNCLordaeronTerrain\\DNCLordaeronTerrain.mdl',
    'Environment\\SmallBuildingFire\\SmallBuildingFire0.mdl', 'Environment\\SmallBuildingFire\\SmallBuildingFire1.mdl', 'Environment\\SmallBuildingFire\\SmallBuildingFire2.mdl',
    'Environment\\LargeBuildingFire\\LargeBuildingFire0.mdl', 'Environment\\LargeBuildingFire\\LargeBuildingFire1.mdl', 'Environment\\LargeBuildingFire\\LargeBuildingFire2.mdl',
}
# whole folders (only from extracted-folder sources): interface art, font, cliffs, splats, shadows, selection, lightning textures
PREFIXES = ['ui\\console\\human\\', 'ui\\cursor\\humancursor', 'ui\\feedback\\', 'ui\\widgets\\console\\human\\',
            'ui\\widgets\\escmenu\\human\\', 'ui\\widgets\\tooltips\\human\\', 'ui\\minimap\\', 'fonts\\frizqt__',
            'replaceabletextures\\selection\\', 'replaceabletextures\\shadows\\', 'replaceabletextures\\cliff\\',
            'replaceabletextures\\teamcolor\\', 'replaceabletextures\\teamglow\\', 'textures\\lightning', 'textures\\shadow',
            'splats\\', 'replaceabletextures\\water\\']
textures = set(icons)
for i in range(13):
    textures.add('ReplaceableTextures\\TeamColor\\TeamColor%02d.blp' % i)
    textures.add('ReplaceableTextures\\TeamGlow\\TeamGlow%02d.blp' % i)

gamefiles = {'tiles': {}, 'cliffTex': {}, 'doodads': {}}
terrain_slk = slk('TerrainArt\\Terrain.slk')
for tid in D['geo']['terrain']['ground']:
    r = terrain_slk.get(tid)
    if r:
        p = '%s\\%s.blp' % (r.get('dir', ''), r.get('file', '')); gamefiles['tiles'][tid] = p; textures.add(p)
cliff_slk = slk('TerrainArt\\CliffTypes.slk')
for cid in D['geo']['terrain'].get('cliffTiles', []):
    r = cliff_slk.get(cid)
    if r:
        p = '%s\\%s.blp' % (r.get('texdir', ''), r.get('texfile', '')); gamefiles['cliffTex'][cid] = {'tex': p, 'ground': r.get('groundtile', '')}; textures.add(p)
dest = slk('Units\\DestructableData.slk'); dood = slk('Doodads\\Doodads.slk')
ids = {'LTlt'} | {d[0] for d in D['geo']['doodads']}
for did in sorted(ids):
    r = dest.get(did) or dood.get(did)
    if not r:
        print('no table entry for doodad', did); continue
    nv = int(float(r.get('numvar') or 1)); f = r.get('file', '')
    rec = {'file': f, 'numVar': nv}
    if r.get('texfile') and str(r.get('texfile')) not in ('_', ''):
        rec['tex'] = r['texfile'] if r['texfile'].lower().endswith('.blp') else r['texfile'] + '.blp'
        rec['texId'] = int(float(r.get('texid') or 0)); textures.add(rec['tex'])
    gamefiles['doodads'][did] = rec
    for v in range(nv):
        models.add(f + (str(v) if nv > 1 else '') + '.mdx')

# cliff models for the map's cliff types
for cid in D['geo']['terrain'].get('cliffTiles', []):
    r = cliff_slk.get(cid)
    if r:
        for k in ('cliffmodeldir', 'rampmodeldir'):
            if r.get(k): PREFIXES.append(norm('Doodads\\Terrain\\%s\\' % r[k]))
# uber splats (building ground decals)
splat_slk = slk('Splats\\UberSplatData.slk')
gamefiles['uberSplats'] = {}
for u in D['units'].values():
    sp = splat_slk.get(u.get('uberSplat') or '_')
    if sp:
        p = '%s\\%s.blp' % (sp.get('dir', ''), sp.get('file', '')); textures.add(p)
        gamefiles['uberSplats'][u['uberSplat']] = {'tex': p, 'scale': float(sp.get('scale') or 1), 'blend': int(float(sp.get('blendmode') or 0))}
light_slk = slk('Splats\\LightningData.slk')
gamefiles['lightning'] = {k: {'tex': re.sub(r'(\.blp)?$', '.blp', '%s\\%s' % (r.get('dir', ''), r.get('file', '')), count=1, flags=re.I), 'width': float(r.get('avgwidth') or 30),
                              'color': [float(r.get('r') or 1), float(r.get('g') or 1), float(r.get('b') or 1), float(r.get('a') or 1)],
                              'noise': float(r.get('noisescale') or 0), 'texCoordScale': float(r.get('texcoordscale') or 1)}
                          for k, r in light_slk.items() if k in ('CLPB', 'CLSB', 'SPLK', 'DRAL', 'AFOD', 'LEAS')}
for v in gamefiles['lightning'].values(): textures.add(v['tex'])

# ---------------------------------------------------------------- collect
found, missing = {}, []
for s in sources:
    if isinstance(s, FolderSource):
        for rel in s.files:
            if any(rel.startswith(p) for p in PREFIXES) and not rel.endswith(('.wav', '.mp3', '.txt', '.fdf', '.toc')):
                if rel.endswith(('.mdx', '.mdl')): models.add(rel)
                else: textures.add(rel)
queue = [m for m in models if m]
seen = set()
while queue:
    m = queue.pop()
    key = norm(re.sub(r'\.(mdl|mdx)$', '', m, flags=re.I)) + '.mdx'
    if key in seen: continue
    seen.add(key)
    name, data = read_any(key, ['.mdx'])
    if data is None:
        if not key.endswith('_portrait.mdx'): missing.append(key)
        continue
    found[key] = data
    for rid, tp in mdx_textures(data):
        if tp: textures.add(tp)
for t in sorted(textures):
    if re.search(r'\.(ttf|slk)$', t, re.I):
        data = read(t); name = norm(t)
    else:
        name, data = read_any(t, ['.blp', '.dds', '.tga'])
    if data is None:
        missing.append(norm(t)); continue
    found[name] = data
print('found %d files, %d not found' % (len(found), len(missing)))
if missing:
    with open(os.path.join(ROOT, 'assets', 'wc3-missing.txt'), 'w') as fh:
        fh.write('\n'.join(sorted(set(missing))))
    print('list of files not found: assets/wc3-missing.txt')

# ---------------------------------------------------------------- write packs
import base64  # noqa: E402
out_dir = os.path.join(ROOT, 'assets'); os.makedirs(out_dir, exist_ok=True)
for f in os.listdir(out_dir):
    if re.match(r'wc3-\d+\.js$', f): os.remove(os.path.join(out_dir, f))
packs, cur, size = [], {}, 0
for k in sorted(found):
    b = base64.b64encode(found[k]).decode()
    if size + len(b) > 16_000_000 and cur:
        packs.append(cur); cur, size = {}, 0
    cur[k] = b; size += len(b)
if cur: packs.append(cur)
for i, pk in enumerate(packs):
    with open(os.path.join(out_dir, 'wc3-%d.js' % i), 'w') as fh:
        fh.write('(window.PYRO_ASSET_PACKS = window.PYRO_ASSET_PACKS || []).push(' + json.dumps(pk, separators=(',', ':')) + ');\n')
with open(os.path.join(out_dir, 'wc3-files.js'), 'w') as fh:
    fh.write('window.PYRO_GAMEFILES = ' + json.dumps(gamefiles, indent=1) + ';\n')
print('wrote %d pack(s) + assets/wc3-files.js' % len(packs))

# packs.js loads every pack in assets/ (works from file:// too)
names = sorted(f for f in os.listdir(out_dir) if re.match(r'.+-\d+\.js$', f)) + ['wc3-files.js']
with open(os.path.join(out_dir, 'packs.js'), 'w') as fh:
    fh.write('// generated by tools/import_wc3.py / tools/pack_assets.py\n')
    for n in names:
        if os.path.exists(os.path.join(out_dir, n)):
            fh.write("document.write('<script src=\"assets/%s\"><\\/script>');\n" % n)
print('updated assets/packs.js')
