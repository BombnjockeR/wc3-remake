"""Extract map geometry (terrain, pathing, doodads, regions) to JSON for the web engine."""
import struct, json, re, sys
F = '/home/claude/extract/files'
out = {}
# pathing
d = open(f'{F}/war3map.wpm', 'rb').read()
w, h = struct.unpack_from('<ii', d, 8)
out['path'] = {'w': w, 'h': h, 'minX': -4096, 'minY': -6144, 'cell': 32,
               'data': d[16:16 + w * h].hex()}
# terrain
e = open(f'{F}/war3map.w3e', 'rb').read()
p = 9; p += 4
na, = struct.unpack_from('<i', e, p); p += 4; ground = [e[p + 4 * i:p + 4 * i + 4].decode() for i in range(na)]; p += 4 * na
nb, = struct.unpack_from('<i', e, p); p += 4; p += 4 * nb
W, H = struct.unpack_from('<ii', e, p); p += 8; ox, oy = struct.unpack_from('<ff', e, p); p += 8
tex = []; layer = []; height = []; water = []
for i in range(W * H):
    hh, wf, fl, det, cl = struct.unpack_from('<hhBBB', e, p + 7 * i)
    tex.append(fl & 15); layer.append(cl & 15); height.append(hh); water.append(1 if fl & 0x40 else 0)
out['terrain'] = {'w': W, 'h': H, 'minX': ox, 'minY': oy, 'tile': 128, 'ground': ground,
                  'tex': tex, 'layer': layer}
# doodads
d = open(f'{F}/war3map.doo', 'rb').read()
ver, sub, n = struct.unpack_from('<iii', d, 4); p = 16
dood = []
for i in range(n):
    did = d[p:p + 4].decode('latin-1')
    x, y, z, ang, sx, sy, sz = struct.unpack_from('<7f', d, p + 8); p += 36
    p += 4; flags = d[p]; p += 2; p += 4
    ns, = struct.unpack_from('<i', d, p); p += 4
    for s in range(ns):
        ni, = struct.unpack_from('<i', d, p); p += 4 + ni * 8
    p += 4
    dood.append([did, round(x), round(y), round(sx, 2)])
out['doodads'] = dood
# regions from script
j = open(f'{F}/j.txt').read()
regs = {}
for m in re.finditer(r'set gg_rct_(\w+)=Rect\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)', j):
    regs[m.group(1)] = [float(m.group(i)) for i in range(2, 6)]
out['regions'] = regs
json.dump(out, open('/home/claude/build/map.json', 'w'))
print('regions', len(regs), 'doodads', len(dood))
