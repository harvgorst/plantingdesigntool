"""Turn the PFAF snapshot (data.sqlite) into one compact line per plant for SevenLayers.
latin|common|layer|height|width|flowerFrom|flowerTo|harvestFrom|harvestTo|foliage|edibility"""
import sqlite3, re, sys
db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
M = {m: i + 1 for i, m in enumerate(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'])}
MP = '(' + '|'.join(M) + ')'
uses = {}
for plant, cat, name in c.execute("select plant, category, name from plant_uses where category in ('edible parts', 'special uses')"):
    uses.setdefault(plant, set()).add(name)
def span(text, word):
    m = re.search(word + r' from ' + MP + r' to ' + MP, text) or re.search(word + r' in ' + MP, text)
    if not m: return ('', '')
    a = M[m.group(1)]; b = M[m.group(2)] if m.lastindex > 1 else a
    return (a, b)
def num(v):
    try: v = float(v)
    except (TypeError, ValueError): return ''
    return ('%g' % round(v, 2)) if v > 0 else ''
rows, seen = [], set()
for latin, common, habit, h, w, t, ed in c.execute('select latin_name, common_name, habit, height, width, physical_characteristics, edibility_rating from plants order by latin_name'):
    latin = (latin or '').strip()
    if not latin or latin.lower() in seen: continue
    seen.add(latin.lower())
    t = (t or '').replace('\xa0', ' '); hb = (habit or '').lower(); u = uses.get(latin, set())
    hv_ = float(h) if isinstance(h, (int, float)) else 0
    if 'climber' in hb: L = 'l'
    elif hb in ('bulb', 'corm'): L = 't'
    elif hb == 'tree': L = 'c' if hv_ >= 10 else 'u'
    elif hb in ('shrub', 'bamboo'): L = 's'
    elif 'Ground Cover' in u and 0 < hv_ <= 0.5: L = 'g'
    else: L = 'h'
    ff, ft = span(t, 'in flower')
    hf, ht = span(t, 'seeds ripen') if u & {'Fruit', 'Seed', 'Seedpod'} else ('', '')
    fol = 'e' if re.search(r'is an? evergreen', t) else 'd' if re.search(r'is an? deciduous', t) else ''
    common1 = (common or '').split(',')[0].strip()
    clean = lambda s: str(s).replace('|', '/').replace('\n', ' ')
    rows.append('|'.join(map(clean, [latin, common1, L, num(h), num(w), ff, ft, hf, ht, fol, ed if isinstance(ed, int) and ed > 0 else ''])))
open(out, 'w', encoding='utf-8').write('\n'.join(rows))
print(len(rows), 'plants')
