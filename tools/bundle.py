"""Inline all scripts (and the asset packs listed in assets/packs.js) into one HTML file you can open by
double-clicking: dist/PyroTD.html."""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()


def script(src):
    code = open(os.path.join(ROOT, src), encoding='utf-8').read()
    return '<script>/* ' + src + ' */\n' + code.replace('</script', '<\\/script') + '\n</script>'


def inline(m):
    src = m.group(1)
    if src == 'assets/packs.js':  # expand the pack loader into the packs themselves
        packs = re.findall(r'assets/[^"\\]+\.js', open(os.path.join(ROOT, src), encoding='utf-8').read())
        return '\n'.join(script(p) for p in packs if os.path.exists(os.path.join(ROOT, p)))
    return script(src)


out = re.sub(r'<script src="([^"]+)"></script>', inline, html)
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
path = os.path.join(ROOT, 'dist', 'PyroTD.html')
open(path, 'w', encoding='utf-8').write(out)
print(path, len(out), 'bytes')
