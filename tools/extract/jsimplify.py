"""Inline trivial GUI-generated JASS condition/callback functions to make the script readable."""
import re, sys

src = open(sys.argv[1]).read()
lines = src.split('\n')

funcs = {}  # name -> (start, end, header, body lines)
order = []
i = 0
while i < len(lines):
    m = re.match(r'^function (\w+) takes (.*?) returns (\w+)', lines[i])
    if m:
        j = i + 1
        while lines[j] != 'endfunction':
            j += 1
        funcs[m.group(1)] = dict(takes=m.group(2), ret=m.group(3), body=lines[i + 1:j], start=i)
        order.append(m.group(1))
        i = j + 1
    else:
        i += 1

pre = '\n'.join(lines[:funcs[order[0]]['start']])

def simple_expr(f):
    b = [l for l in f['body'] if not l.startswith('local')]
    if f['takes'] == 'nothing' and len(b) == 1 and b[0].startswith('return') and f['ret'] == 'boolean':
        e = b[0][len('return'):].strip()
        e = re.sub(r'\)!=null$', ')', e) if e.endswith('!=null') else e
        return e
    return None

def simple_cb(f):
    # tiny ForGroup/ForForce callbacks (no locals, <=3 lines)
    b = f['body']
    if f['takes'] == 'nothing' and f['ret'] == 'nothing' and 0 < len(b) <= 12 and not any(l.startswith('local') for l in b):
        return b
    return None

changed = True
exprs = {}
while changed:
    changed = False
    for n in order:
        f = funcs[n]
        e = simple_expr(f)
        if e is not None and exprs.get(n) != e:
            exprs[n] = e; changed = True
    for n in order:
        f = funcs[n]
        nb = []
        for l in f['body']:
            l2 = l
            for en, ee in exprs.items():
                if en == n: continue
                if en in l2:
                    l2 = re.sub(r'\b' + en + r'\(\)', '(' + ee + ')', l2)
                    l2 = re.sub(r'Condition\(function ' + en + r'\)', 'filter{' + ee + '}', l2)
            nb.append(l2)
        if nb != f['body']:
            f['body'] = nb; changed = True

# inline small callbacks referenced via "function X"
cbs = {n: simple_cb(funcs[n]) for n in order if simple_cb(funcs[n])}
for n in order:
    f = funcs[n]
    nb = []
    for l in f['body']:
        refs = re.findall(r'function (\w+)', l)
        nb.append(l)
        for r in refs:
            if r in cbs and r != n:
                l_new = nb.pop()
                l_new = l_new.replace('function ' + r, 'λ' + r[-6:])
                nb.append(l_new)
                for cl in cbs[r]:
                    nb.append('    ⤷ ' + cl)
    f['body'] = nb

used = set()
alltext = '\n'.join('\n'.join(funcs[n]['body']) for n in order)
for n in order:
    if re.search(r'\b' + n + r'\b', alltext):
        used.add(n)

out = [pre]
for n in order:
    f = funcs[n]
    if n in exprs and not n.startswith('InitTrig'):
        continue
    if n in cbs and n not in re.findall(r'\b(\w+)\b', alltext.replace('λ', ' ')) and not n.startswith(('InitTrig', 'Trig_') ) :
        pass
    if n in cbs and ('function ' + n) not in alltext and n.endswith('A'):
        continue
    ind = 0
    out.append(f"function {n} takes {f['takes']} returns {f['ret']}")
    for l in f['body']:
        s = l.strip()
        if re.match(r'^(endif|endloop|else|elseif)', s): ind = max(0, ind - 1)
        out.append('  ' * ind + l)
        if re.match(r'^(if|loop|else|elseif)\b', s): ind += 1
    out.append('endfunction')
open(sys.argv[2], 'w').write('\n'.join(out))
