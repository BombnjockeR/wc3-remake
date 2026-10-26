def slk_rows(text):
    rows, x, y = {}, 0, 0
    for line in text.splitlines():
        if not line.startswith('C;'): continue
        val = None
        for p in line.split(';')[1:]:
            if not p: continue
            if p[0] == 'X': x = int(p[1:])
            elif p[0] == 'Y': y = int(p[1:])
            elif p[0] == 'K':
                v = p[1:]; val = v[1:-1] if v.startswith('"') and v.endswith('"') else v
        if val is not None: rows.setdefault(y, {})[x] = val
    head = {x: str(n).lower() for x, n in rows.pop(1).items()}
    out = {}
    for y, r in rows.items():
        rec = {head[x]: v for x, v in r.items() if x in head}
        k = rec.get(head[min(head)])
        if k: out[k] = rec
    return out
def S(p): return slk_rows(open(p, encoding='latin-1').read())
