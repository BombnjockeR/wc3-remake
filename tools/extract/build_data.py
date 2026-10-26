"""Turn the decoded Pyro TD map into a compact game-data JSON used by the web engine."""
import json, re, sys
sys.path.insert(0, '/home/claude/tools')
J = '/home/claude/extract/json'
U = json.load(open(f'{J}/units.json'))
A = json.load(open(f'{J}/abilitys.json'))
Q = json.load(open(f'{J}/upgrades.json'))
S = json.load(open(f'{J}/strings.json'))
MAP = json.load(open('/home/claude/build/map.json'))


def clean(s):
    if s is None:
        return ''
    s = str(s)
    s = re.sub(r'\|c[0-9a-fA-F]{8}|\|r', '', s)
    s = s.replace('|n', '\n')
    return s.strip().strip('"')


def num(v, default=0.0):
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    v = str(v).strip()
    if v in ('', '-', '_'):
        return default
    try:
        return float(v)
    except ValueError:
        return default


def lst(v):
    if not v or str(v).strip() in ('_', '-'):
        return []
    return [x.strip() for x in str(v).split(',') if x.strip() and x.strip() != '_']


# ---------------------------------------------------------------- units
WANT_UNITS = set()
builder = U['u000']
for b in lst(builder['builds']):
    WANT_UNITS.add(b)
changed = True
while changed:
    changed = False
    for k in list(WANT_UNITS):
        for t in lst(U[k].get('upgrade')):
            if t not in WANT_UNITS:
                WANT_UNITS.add(t); changed = True
# fighters, castles, races, summons, wards and dummies the rules reference
WANT_UNITS |= {'hfoo', 'h00I', 'h00N', 'h01E', 'h01G', 'h02W', 'h03Z', 'h001', 'h003', 'h011', 'h010', 'h013', 'h012',
               'h015', 'h014', 'h017', 'h016', 'o000', 'o004', 'o005', 'o006', 'o007', 'o008', 'o009', 'o00A', 'u000',
               'h01Z', 'h035', 'u002', 'u003'}


def btnpos(x):
    base = x.get('buttonpos'); bx = by = 0
    if isinstance(base, str) and ',' in base:
        parts = base.split(','); bx = int(num(parts[0])); by = int(num(parts[1])) if len(parts) > 1 else 0
    elif base is not None:
        bx = int(num(base))
    if x.get('buttonpos#0') is not None: bx = int(num(x.get('buttonpos#0')))
    if x.get('buttonpos#1') is not None: by = int(num(x.get('buttonpos#1')))
    return [bx, by]


def unit_rec(k):
    x = U[k]
    rec = {
        'id': k,
        'name': clean(x.get('name')),
        'suffix': clean(x.get('editorsuffix')),
        'hp': num(x.get('hp'), 1),
        'armor': num(x.get('def')),
        'armorType': str(x.get('deftype') or 'none'),
        'dmg': num(x.get('dmgplus1')),
        'dice': num(x.get('dice1'), 1),
        'sides': num(x.get('sides1'), 1),
        'cd': num(x.get('cool1'), 1),
        'range': num(x.get('rangen1'), 100),
        'acquire': num(x.get('acquire'), 500),
        'weapon': str(x.get('weaptp1') or '_'),
        'atk': str(x.get('atktype1') or 'normal'),
        'targs': lst(x.get('targs1')),
        'speed': num(x.get('spd')),
        'collision': num(x.get('collision'), 16),
        'cost': num(x.get('goldcost')),
        'build': num(x.get('bldtm'), 2),
        'upgradesTo': lst(x.get('upgrade')),
        'abil': lst(x.get('abillist')),
        'tip': clean(x.get('ubertip')),
        'points': num(x.get('points')),
        'regen': num(x.get('regenhp')),
        'regenType': str(x.get('regentype') or 'none'),
        'techs': lst(x.get('upgrades')),
        'dmgUp': num(x.get('dmgup1')),
        'structure': bool(int(num(x.get('isbldg')))) or 'structure' in str(x.get('targtype') or ''),
        'scale': num(x.get('modelscale'), 1),
        'missile': num(x.get('missilespeed'), 0),
        'dmgPt': num(x.get('dmgpt1'), 0.3),
        'splash': [num(x.get('farea1')), num(x.get('harea1')), num(x.get('qarea1')),
                   num(x.get('hfact1')), num(x.get('qfact1'))],
        'targCount': num(x.get('targcount1'), 1),
        'requires': lst(x.get('requires')),
        'art': str(x.get('art') or ''),
        'model': str(x.get('file') or ''),
        'btn': btnpos(x),
        'hotkey': str(x.get('hotkey') or ''),
        'tipTitle': clean(x.get('tip')),
        'missileArt': str(x.get('missileart') or ''),
        'missileArc': num(x.get('missilearc')),
        'selScale': num(x.get('scale'), 1),
        'moveType': str(x.get('movetp') or '_'),
        'flyHeight': num(x.get('moveheight')),
        'tint': [num(x.get('red'), 255), num(x.get('green'), 255), num(x.get('blue'), 255)],
        'uberSplat': str(x.get('ubersplat') or '_'),
        'specialArt': str(x.get('specialart') or ''),
        'weaponsOn': int(num(x.get('weapson'), 1)),
        'walkSpeed': num(x.get('walk'), 200),
        'launchZ': num(x.get('launchz'), 60), 'impactZ': num(x.get('impactz'), 60),
        'unitShadow': str(x.get('unitshadow') or '_'), 'buildingShadow': str(x.get('buildingshadow') or '_'),
        'animProps': str(x.get('animprops') or ''),
    }
    if k in ('u000', 'u002', 'u003'):
        rec['builds'] = lst(x.get('builds'))
    return rec


units = {k: unit_rec(k) for k in sorted(WANT_UNITS) if k in U}

# ---------------------------------------------------------------- abilities
FIELDS = ['dataa', 'datab', 'datac', 'datad', 'datae', 'dataf', 'area', 'dur', 'herodur', 'cool', 'rng']


def fill(vals):
    """Fill missing level values like the editor: interpolate gaps, extrapolate the tail."""
    out = list(vals)
    idx = [i for i, v in enumerate(out) if v is not None]
    if not idx:
        return [0.0] * len(out)
    for i in range(len(out)):
        if out[i] is not None:
            continue
        prev = [j for j in idx if j < i]
        nxt = [j for j in idx if j > i]
        if prev and nxt:
            a, b = prev[-1], nxt[0]
            out[i] = out[a] + (out[b] - out[a]) * (i - a) / (b - a)
        elif prev:
            if len(prev) >= 2:
                a, b = prev[-2], prev[-1]
                out[i] = out[b] + (out[b] - out[a]) * (i - b) / (b - a)
            else:
                out[i] = out[prev[-1]]
        else:
            out[i] = out[nxt[0]]
    return out


def abil_rec(k):
    x = A[k]
    lv = int(num(x.get('levels'), 1)) or 1
    rec = {'id': k, 'base': x['_base'], 'name': clean(x.get('name')), 'levels': lv,
           'buff': clean(x.get('buffid1')), 'tips': [], 'unit': []}
    for f in FIELDS:
        vals = []
        for i in range(1, lv + 1):
            v = x.get(f'{f}{i}')
            if v is None:
                vals.append(None)
            else:
                vals.append(num(v))
        rec[f] = [round(v, 4) for v in fill(vals)]
    for i in range(1, lv + 1):
        t = x.get(f'ubertip@{i}') or (x.get('ubertip') if i == 1 else None)
        rec['tips'].append(clean(t))
        rec['unit'].append(clean(x.get(f'unitid{i}')))
    rec['targs'] = lst(x.get('targs1'))
    rec['icon'] = str(x.get('art') or '')
    rec['btn'] = btnpos(x)
    rec['hotkey'] = str(x.get('hotkey') or '')
    rec['tipTitles'] = [clean(x.get(f'tip@{i}') or (x.get('tip') if i == 1 else '')) for i in range(1, lv + 1)]
    rec['researchArt'] = str(x.get('researchart') or '')
    rec['casterArt'] = str(x.get('casterart') or ''); rec['targetArt'] = str(x.get('targetart') or ''); rec['effectArt'] = str(x.get('effectart') or '')
    rec['missileArt'] = str(x.get('missileart') or '')
    rec['missileArc'] = num(x.get('missilearc'))
    rec['specialArt'] = str(x.get('specialart') or '')
    rec['casterAttach'] = str(x.get('casterattach') or ''); rec['targetAttach'] = str(x.get('targetattach') or '')
    rec['anim'] = str(x.get('animnames') or '')
    return rec


abilities = {k: abil_rec(k) for k, x in A.items() if x['_custom']}

# ---------------------------------------------------------------- upgrades (techs)
techs = {}
for k, x in Q.items():
    effs = []
    for i in range(1, 5):
        e = x.get(f'effect{i}')
        if e and e not in ('_', '-', ''):
            effs.append({'code': e, 'base': num(x.get(f'base{i}')), 'mod': num(x.get(f'mod{i}'))})
    techs[k] = {'id': k, 'name': clean(x.get('name@1') or x.get('name')), 'effects': effs}

# ---------------------------------------------------------------- misc (damage table)
misc = {}
for line in open('/home/claude/extract/files/war3mapMisc.txt'):
    if '=' in line:
        a, b = line.strip().split('=', 1)
        misc[a] = b
ARMOR_ORDER = ['small', 'medium', 'large', 'fort', 'normal', 'hero', 'divine', 'none']
dmgtable = {}
for atk in ['Normal', 'Pierce', 'Siege', 'Magic', 'Hero', 'Spells']:
    vals = [float(v) for v in misc['DamageBonus' + atk].split(',')]
    dmgtable[atk.lower()] = dict(zip(ARMOR_ORDER, vals))
dmgtable['chaos'] = dict(zip(ARMOR_ORDER, [1.0] * 8))
dmgtable['spells'] = dmgtable.pop('spells')
misc_out = {'armorFactor': float(misc['DefenseArmor']), 'frostMove': float(misc['FrostMoveSpeedDecrease']),
            'frostAttack': 0.25, 'dmg': dmgtable, 'minSpeed': float(misc['MinUnitSpeed']),
            'maxSpeed': float(misc['MaxUnitSpeed'])}

# ---------------------------------------------------------------- quests / texts
texts = {
    'title': clean(S.get('53')), 'players': clean(S.get('54')), 'description': clean(S.get('55')),
    'author': clean(S.get('56')), 'commands': clean(S.get('701')), 'discord': clean(S.get('501')),
    'models': clean(S.get('685')), 'patchnotes': clean(S.get('6258')), 'thanks': clean(S.get('5955')),
    'defeatRed': clean(S.get('6251')), 'defeatBlue': clean(S.get('6252')),
    'goldMode': clean(S.get('5900')),
}

# ---------------------------------------------------------------- geometry
def w3i_bounds():
    import struct
    d = open('/home/claude/extract/files/war3map.w3i', 'rb').read()
    fmt = struct.unpack_from('<i', d, 0)[0]
    o = 12 + (16 if fmt >= 27 else 0)
    for _ in range(4):
        o = d.index(b'\0', o) + 1
    cam = struct.unpack_from('<8f', d, o); o += 32
    cl, cr, cb, ct = struct.unpack_from('<4i', d, o); o += 16
    pw, ph = struct.unpack_from('<2i', d, o)
    t = MAP['terrain']
    px0 = t['minX'] + cl * 128; py0 = t['minY'] + cb * 128
    return {'camera': [min(cam[0], cam[2], cam[4], cam[6]), min(cam[1], cam[3], cam[5], cam[7]),
                       max(cam[0], cam[2], cam[4], cam[6]), max(cam[1], cam[3], cam[5], cam[7])],
            'playable': [px0, py0, px0 + pw * 128, py0 + ph * 128]}


geo = {
    'path': MAP['path'],
    'terrain': MAP['terrain'],
    'trees': [[d[1], d[2], d[3], d[5], d[6]] for d in MAP['doodads'] if d[0] == 'LTlt'],
    'doodads': [d for d in MAP['doodads'] if d[0] != 'LTlt'],
    'regions': MAP['regions'],
    'bounds': w3i_bounds(),
}

data = {'units': units, 'abilities': abilities, 'techs': techs, 'misc': misc_out, 'texts': texts, 'geo': geo,
        'version': 'Pyro TD 0.31'}
js = 'window.PYRO_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n'
open('/home/claude/game/src/gamedata.js', 'w').write(js)
print('units', len(units), 'abilities', len(abilities), 'techs', len(techs), 'bytes', len(js))
