# Загрузка ассетов Poly Haven (CC0) в assets/src: python3 tools/prep/fetch_ph.py tex:name1,name2 model:name3 ...
import json, urllib.request, os, sys
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (asset-fetch)"})
    with urllib.request.urlopen(req, timeout=120) as r: return r.read()
def files(a): return json.loads(get(f"https://api.polyhaven.com/files/{a}"))
root = 'assets/src'
for arg in sys.argv[1:]:
    kind, names = arg.split(':', 1)
    for a in names.split(','):
        try:
            f = files(a)
            if kind == 'tex':
                os.makedirs(f'{root}/tex', exist_ok=True)
                for key, name in [('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough')]:
                    k = next((kk for kk in f if kk.lower() == key.lower()), None)
                    if not k: print('no', a, key); continue
                    open(f'{root}/tex/{a}_{name}.jpg', 'wb').write(get(f[k]['1k']['jpg']['url']))
            elif kind == 'model':
                g = f['gltf']['1k']['gltf']
                d = f'{root}/models/{a}'; os.makedirs(d, exist_ok=True)
                open(f'{d}/{a}.gltf', 'wb').write(get(g['url']))
                for rel, inc in g.get('include', {}).items():
                    p = os.path.join(d, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
                    open(p, 'wb').write(get(inc['url']))
            print('ok', kind, a)
        except Exception as e:
            print('FAIL', a, e)
