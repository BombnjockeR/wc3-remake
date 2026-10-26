"""Extract files from the classic Warcraft III MPQs (device side helper).
usage:
  python3 wc3x.py list <wc3dir> <out.txt>                 # merged (listfile)
  python3 wc3x.py get <wc3dir> <names.txt> <outdir>       # extract names (+ textures used by .mdx), writes outdir/_manifest.json
"""
import sys, os, json, struct, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mpq import MPQ

ORDER = ['War3Patch.mpq', 'War3xLocal.mpq', 'War3x.mpq', 'war3.mpq']

def open_all(d):
    out = []
    for n in ORDER:
        p = os.path.join(d, n)
        if os.path.exists(p):
            out.append((n, MPQ(p)))
    return out

def read(mpqs, name):
    for n, m in mpqs:
        try:
            r = m.read(name)
        except Exception as e:
            r = None
        if r is not None:
            return r
    return None

def mdx_refs(b):
    tex = []
    if b[:4] != b'MDLX':
        return tex
    o = 4
    while o + 8 <= len(b):
        tag = b[o:o + 4]; size = struct.unpack_from('<I', b, o + 4)[0]
        if tag == b'TEXS':
            for i in range(size // 268):
                e = b[o + 8 + i * 268: o + 8 + (i + 1) * 268]
                p = e[4:264].split(b'\0')[0].decode('latin-1')
                if p: tex.append(p)
        o += 8 + size
    return tex

cmd = sys.argv[1]
mpqs = open_all(sys.argv[2])
if cmd == 'list':
    names = set()
    for n, m in mpqs:
        lf = m.read('(listfile)')
        if lf:
            for l in lf.decode('latin-1').splitlines():
                l = l.strip()
                if l: names.add(l)
    open(sys.argv[3], 'w').write('\n'.join(sorted(names, key=str.lower)))
    print(len(names), 'names')
elif cmd == 'get':
    want = [l.strip() for l in open(sys.argv[3]) if l.strip()]
    outdir = sys.argv[4]; os.makedirs(outdir, exist_ok=True)
    found, missing, seen = [], [], set()
    q = list(want)
    while q:
        n = q.pop(0); k = n.replace('/', '\\').lower()
        if k in seen: continue
        seen.add(k)
        cands = [n]
        base = re.sub(r'\.(mdl|mdx|blp|tga|dds)$', '', n, flags=re.I)
        if re.search(r'\.(mdl|mdx)$', n, re.I): cands = [base + '.mdx']
        elif re.search(r'\.(blp|tga|dds)$', n, re.I): cands = [base + '.blp', base + '.tga']
        data = None
        for c in cands:
            data = read(mpqs, c)
            if data is not None: n = c; break
        if data is None:
            missing.append(n); continue
        rel = n.replace('\\', '/').lower()
        p = os.path.join(outdir, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(data); found.append(rel)
        if rel.endswith('.mdx'):
            for t in mdx_refs(data): q.append(t)
    json.dump({'found': found, 'missing': missing}, open(os.path.join(outdir, '_manifest.json'), 'w'))
    print(len(found), 'found', len(missing), 'missing')
