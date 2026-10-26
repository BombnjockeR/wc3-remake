"""Merge Warcraft 3 base object data (SLK/TXT) with a map's object modification files."""
import struct, os, re, json, sys

BASE = '/home/claude/w3x2lni/data/enUS-1.27.1/mpq/Units'

def read_slk(path):
    rows = {}
    cols = {}
    x = y = 0
    for line in open(path, encoding='latin-1'):
        line = line.rstrip('\r\n')
        if not line.startswith('C;'):
            continue
        parts = line.split(';')
        val = None
        for p in parts[1:]:
            if p[0] == 'X': x = int(p[1:])
            elif p[0] == 'Y': y = int(p[1:])
            elif p[0] == 'K':
                v = p[1:]
                if v.startswith('"'): v = v[1:-1] if v.endswith('"') else v[1:]
                else:
                    try: v = int(v)
                    except ValueError:
                        try: v = float(v)
                        except ValueError: pass
                val = v
        if val is None: continue
        rows.setdefault(y, {})[x] = val
    header = rows.pop(1)
    names = {x: str(n) for x, n in header.items()}
    out = {}
    for y, r in rows.items():
        rec = {names[x].lower(): v for x, v in r.items() if x in names}
        key = list(rec.values())[0] if rec else None
        first = names[min(names)].lower()
        key = rec.get(first)
        if key is None: continue
        out[str(key)] = rec
    return out

def read_txt(path, into):
    cur = None
    for line in open(path, encoding='utf-8', errors='replace'):
        line = line.rstrip('\r\n')
        if line.startswith('//') or not line.strip(): continue
        m = re.match(r'^\[(.+)\]$', line.strip())
        if m:
            cur = into.setdefault(m.group(1), {})
            continue
        if cur is None or '=' not in line: continue
        k, v = line.split('=', 1)
        cur[k.strip().lower()] = v

def read_meta(path):
    meta = {}
    for k, r in read_slk(path).items():
        meta[k] = r
    return meta

class Reader:
    def __init__(self, d): self.d, self.p = d, 0
    def i(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]; self.p += 4; return v
    def f(self):
        v = struct.unpack_from('<f', self.d, self.p)[0]; self.p += 4; return v
    def id(self):
        v = self.d[self.p:self.p + 4].decode('latin-1'); self.p += 4; return v
    def s(self):
        e = self.d.index(b'\0', self.p); v = self.d[self.p:e].decode('utf-8', 'replace'); self.p = e + 1; return v

def read_mods(path, leveled):
    d = open(path, 'rb').read()
    r = Reader(d)
    ver = r.i()
    tables = []
    for _ in range(2):
        n = r.i()
        objs = []
        for _ in range(n):
            orig, new = r.id(), r.id()
            if ver >= 3:
                r.i()  # set count (1.33+); not used here
            nm = r.i()
            mods = []
            for _ in range(nm):
                fid = r.id(); typ = r.i(); lvl = dat = 0
                if leveled:
                    lvl = r.i(); dat = r.i()
                if typ == 0: v = r.i()
                elif typ in (1, 2): v = r.f()
                else: v = r.s()
                r.id()
                mods.append((fid, lvl, dat, v))
            objs.append((orig, new if new != '\0\0\0\0' else orig, mods))
        tables.append(objs)
    return tables

def load_strings(wts_path):
    s = {}
    txt = open(wts_path, encoding='utf-8-sig', errors='replace').read().replace('\r', '')
    for m in re.finditer(r'STRING (\d+)\s*(?://[^\n]*\n)?\{\n(.*?)\n\}', txt, re.S):
        s[int(m.group(1))] = m.group(2)
    return s

def resolve(v, strings):
    if isinstance(v, str):
        return re.sub(r'TRIGSTR_0*(\d+)', lambda m: strings.get(int(m.group(1)), m.group(0)), v)
    return v

def build(kind, mod_path, strings):
    if kind == 'unit':
        meta = read_meta(f'{BASE}/UnitMetaData.slk')
        slks = ['unitdata', 'unitbalance', 'unitui', 'unitweapons', 'unitabilities']
        txts = [f for f in os.listdir(BASE) if re.match(r'.*unit(func|strings)\.txt$', f)]
        leveled = False
    elif kind == 'ability':
        meta = read_meta(f'{BASE}/AbilityMetaData.slk')
        slks = ['abilitydata']
        txts = [f for f in os.listdir(BASE) if re.match(r'.*ability(func|strings)\.txt$', f)]
        leveled = True
    elif kind == 'upgrade':
        meta = read_meta(f'{BASE}/UpgradeMetaData.slk')
        slks = ['upgradedata']
        txts = [f for f in os.listdir(BASE) if re.match(r'.*upgrade(func|strings)\.txt$', f)]
        leveled = True
    elif kind == 'item':
        meta = read_meta(f'{BASE}/UnitMetaData.slk')
        slks = ['itemdata']
        txts = ['itemfunc.txt', 'itemstrings.txt']
        leveled = False
    elif kind == 'buff':
        meta = read_meta(f'{BASE}/AbilitybuffMetaData.slk')
        slks = ['abilitybuffdata']
        txts = [f for f in os.listdir(BASE) if re.match(r'.*ability(func|strings)\.txt$', f)]
        leveled = False
    base = {}
    for s in slks:
        for k, rec in read_slk(f'{BASE}/{s}.slk').items():
            base.setdefault(k, {}).update(rec)
    prof = {}
    for t in txts:
        read_txt(f'{BASE}/{t}', prof)
    for k, rec in prof.items():
        if k in base:
            for fk, fv in rec.items():
                base[k].setdefault(fk, fv)
    objs = {}
    orig_tbl, cust_tbl = read_mods(mod_path, leveled)
    for tbl, custom in ((orig_tbl, False), (cust_tbl, True)):
        for orig, new, mods in tbl:
            rec = dict(base.get(orig, {}))
            rec['_base'] = orig
            rec['_custom'] = custom
            for fid, lvl, dat, v in mods:
                m = meta.get(fid)
                if not m:
                    rec['?' + fid] = v; continue
                field = str(m['field']).lower()
                if kind in ('ability', 'upgrade', 'buff'):
                    rep = m.get('repeat', 0) or 0
                    if field == 'data' and dat:
                        field = 'data' + 'ABCDEFGHI'[dat - 1]
                        field = field.lower()
                    if rep and lvl:
                        key = f'{field}{lvl}'
                        if m.get('slk') == 'Profile':
                            key = f'{field}@{lvl}'
                        field = key
                idx = m.get('index', -1)
                if isinstance(idx, int) and idx > 0 and m.get('slk') == 'Profile':
                    field = f'{field}#{idx}'
                rec[field] = resolve(v, strings)
            for k in list(rec):
                rec[k] = resolve(rec[k], strings)
            objs[new] = rec
    return objs

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    strings = load_strings(f'{src}/war3map.wts')
    os.makedirs(out, exist_ok=True)
    for kind, fn in [('unit', 'war3map.w3u'), ('ability', 'war3map.w3a'), ('upgrade', 'war3map.w3q'),
                     ('item', 'war3map.w3t'), ('buff', 'war3map.w3h')]:
        objs = build(kind, f'{src}/{fn}', strings)
        json.dump(objs, open(f'{out}/{kind}s.json', 'w'), indent=1, ensure_ascii=False)
        print(kind, len(objs))
    json.dump(strings, open(f'{out}/strings.json', 'w'), indent=1, ensure_ascii=False)
