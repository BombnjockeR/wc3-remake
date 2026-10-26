"""Minimal MPQ (v0/v1) reader with decryption support, tolerant of map-protector tricks."""
import struct, zlib, bz2, mmap

def _crypt_table():
    t = [0] * 0x500
    seed = 0x00100001
    for i in range(0x100):
        idx = i
        for _ in range(5):
            seed = (seed * 125 + 3) % 0x2AAAAB
            a = (seed & 0xFFFF) << 16
            seed = (seed * 125 + 3) % 0x2AAAAB
            b = seed & 0xFFFF
            t[idx] = a | b
            idx += 0x100
    return t

CT = _crypt_table()
M = 0xFFFFFFFF

def hash_string(s, ht):
    s = s.upper().replace('/', '\\')
    seed1, seed2 = 0x7FED7FED, 0xEEEEEEEE
    for ch in s.encode('latin-1'):
        v = CT[(ht << 8) + ch]
        seed1 = (v ^ ((seed1 + seed2) & M)) & M
        seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) & M
    return seed1

def decrypt(data, key):
    n = len(data) // 4
    words = list(struct.unpack('<%dI' % n, data[:n * 4]))
    seed = 0xEEEEEEEE
    out = []
    for w in words:
        seed = (seed + CT[0x400 + (key & 0xFF)]) & M
        ch = w ^ ((key + seed) & M)
        out.append(ch)
        key = ((((~key) << 0x15) + 0x11111111) | (key >> 0x0B)) & M
        seed = (ch + seed + (seed << 5) + 3) & M
    return struct.pack('<%dI' % n, *out) + data[n * 4:]

def explode(data):
    import pkware_explode
    return pkware_explode.explode(data)

class MPQ:
    def __init__(self, path):
        self.f = open(path, 'rb'); self.d = mmap.mmap(self.f.fileno(), 0, access=mmap.ACCESS_READ)
        d = self.d
        off = d.find(b'MPQ\x1a')
        while off >= 0 and off % 0x200 != 0:
            off = d.find(b'MPQ\x1a', off + 1)
        self.base = off
        h = d[off:off + 32]
        (_, _hs, _arch, _fv, ss, hto, bto, hte, bte) = struct.unpack('<4sIIHHIIII', h)
        ss &= 0xF  # protectors put junk in high bits
        self.sector = 512 << ss
        self.hte, self.bte = hte, bte
        ht = d[off + hto: off + hto + hte * 16]
        ht = ht + b'\0' * (hte * 16 - len(ht))
        ht = decrypt(ht, hash_string('(hash table)', 3))
        self.hashes = [struct.unpack_from('<IIHHI', ht, i * 16) for i in range(hte)]
        bt = d[off + bto: off + bto + bte * 16]
        bt = bt + b'\0' * (bte * 16 - len(bt))
        bt = decrypt(bt, hash_string('(block table)', 3))
        self.blocks = [struct.unpack_from('<IIII', bt, i * 16) for i in range(bte)]

    def find(self, name):
        a = hash_string(name, 1); b = hash_string(name, 2)
        start = hash_string(name, 0) % self.hte
        for i in range(self.hte):
            e = self.hashes[(start + i) % self.hte]
            if e[4] == 0xFFFFFFFF:
                return None
            if e[0] == a and e[1] == b and e[4] < self.bte:
                return e[4]
        return None

    def file_key(self, name, blk):
        base = name.replace('/', '\\').split('\\')[-1]
        key = hash_string(base, 3)
        pos, csize, fsize, flags = self.blocks[blk]
        if flags & 0x20000:
            key = ((key + pos) ^ fsize) & M
        return key

    @staticmethod
    def decompress(buf, outsize):
        if len(buf) >= outsize:
            return buf[:outsize]
        mask = buf[0]
        data = buf[1:]
        if mask & 0x10:
            data = bz2.decompress(data)
        if mask & 0x08:
            data = explode(data)
        if mask & 0x02:
            data = zlib.decompress(data)
        if mask & ~(0x10 | 0x08 | 0x02):
            raise NotImplementedError('compression mask %x' % mask)
        return data

    def read_block(self, blk, key):
        pos, csize, fsize, flags = self.blocks[blk]
        d = self.d
        start = self.base + pos
        raw = d[start:start + csize]
        if flags & 0x01000000:  # single unit
            if flags & 0x10000:
                raw = decrypt(raw, key)
            if flags & 0x200:
                return self.decompress(raw, fsize)
            if flags & 0x100:
                return explode(raw)[:fsize] if csize < fsize else raw
            return raw
        nsec = (fsize + self.sector - 1) // self.sector
        if flags & (0x200 | 0x100):
            tbl = raw[:(nsec + 1) * 4]
            if flags & 0x10000:
                tbl = decrypt(tbl, (key - 1) & M)
            offs = struct.unpack('<%dI' % (nsec + 1), tbl)
        else:
            offs = [min(i * self.sector, csize) for i in range(nsec)] + [csize]
        out = bytearray()
        for i in range(nsec):
            s = raw[offs[i]:offs[i + 1]]
            if flags & 0x10000:
                s = decrypt(s, (key + i) & M)
            want = min(self.sector, fsize - i * self.sector)
            if flags & 0x200:
                s = self.decompress(s, want)
            elif flags & 0x100 and len(s) < want:
                s = explode(s)
            out += s[:want]
        return bytes(out)

    def read(self, name):
        blk = self.find(name)
        if blk is None:
            return None
        return self.read_block(blk, self.file_key(name, blk))

def detect_key_by_sector_table(enc, sector):
    """Recover the key of an encrypted sector offset table (returns file key)."""
    w0, w1 = struct.unpack_from('<II', enc, 0)
    # first offset equals table size; try plausible table sizes
    for nsec_plus1 in range(2, 4096):
        dec0 = nsec_plus1 * 4
        k12 = ((w0 ^ dec0) - 0xEEEEEEEE) & M
        for i in range(0x100):
            k1 = (k12 - CT[0x400 + i]) & M
            k2 = (0xEEEEEEEE + CT[0x400 + (k1 & 0xFF)]) & M
            if (w0 ^ ((k1 + k2) & M)) != dec0:
                continue
            k1b = ((((~k1) << 0x15) + 0x11111111) | (k1 >> 0x0B)) & M
            k2b = (dec0 + k2 + (k2 << 5) + 3) & M
            k2b = (k2b + CT[0x400 + (k1b & 0xFF)]) & M
            dec1 = w1 ^ ((k1b + k2b) & M)
            if dec0 < dec1 <= dec0 + sector + 16:
                return (k1 + 1) & M, nsec_plus1 - 1
    return None, None
