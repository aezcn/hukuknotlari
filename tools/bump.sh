#!/bin/sh
# Surum artirici.
#
#   sh tools/bump.sh
#
# Uc yeri birlikte gunceller, boylece hicbiri unutulmaz:
#   sw.js        VERSION      -> onbellegi tazeler, eskisini siler
#   index.html   ?v=          -> tarayici yeni JS/CSS'i mecburen agdan ceker
#   config.js    HN_VERSION   -> Ayarlar'in altinda gorunen surum
#
# Her deploy'dan ONCE calistir, sonra commit + push et.

cd "$(dirname "$0")/.." || exit 1

python3 - <<'PY'
import io, re, sys

sw = io.open('sw.js', encoding='utf-8').read()
m = re.search(r"var VERSION = 'v(\d+)';", sw)
if not m:
    sys.exit('sw.js icinde VERSION bulunamadi')

old = int(m.group(1))
new = old + 1

io.open('sw.js', 'w', encoding='utf-8').write(
    sw.replace("var VERSION = 'v%d';" % old, "var VERSION = 'v%d';" % new, 1))

html = io.open('index.html', encoding='utf-8').read()
html, n = re.subn(r'\?v=%d\b' % old, '?v=%d' % new, html)
io.open('index.html', 'w', encoding='utf-8').write(html)
if n == 0:
    print('UYARI: index.html icinde ?v=%d bulunamadi, elle kontrol et' % old)

cfg = io.open('config.js', encoding='utf-8').read()
mv = re.search(r'self\.HN_VERSION = "(\d+)\.(\d+)\.(\d+)";', cfg)
if mv:
    ver = '%s.%s.%d' % (mv.group(1), mv.group(2), int(mv.group(3)) + 1)
    cfg = cfg.replace(mv.group(0), 'self.HN_VERSION = "%s";' % ver, 1)
    io.open('config.js', 'w', encoding='utf-8').write(cfg)
else:
    ver = '(degismedi)'

print('v%d -> v%d   (%d dosya adresi guncellendi)' % (old, new, n))
print('surum: %s' % ver)
print('')
print('Simdi:  git add -A && git commit -m "surum v%d" && git push' % new)
PY
