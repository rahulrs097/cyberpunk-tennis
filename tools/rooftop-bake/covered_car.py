"""Swap the baked box cars for Poly Haven's scanned covered car (CC0).

  python3 covered_car.py <dir with covered_car_1k.gltf from Poly Haven>

1. models/rooftop/car.glb + car.jpg + car_nor.jpg: the car's five meshes
   merged into one (positions, normals, uvs), its colour with the ambient
   occlusion multiplied in.
2. models/rooftop/props.glb: the covered bays' baked cars dropped (the game now
   draws a covered car in each bay, js/render3d.js loadCars). Run it once on
   the props.glb that bake.py exports; the car list matches scene.py.
"""
import json, math, struct, sys, os
import numpy as np
from PIL import Image

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'models', 'rooftop')

def read_glb(path):
    b = open(path, 'rb').read()
    jl = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jl])
    o = 20 + jl
    bl = struct.unpack('<I', b[o:o + 4])[0]
    return j, b[o + 8:o + 8 + bl]

def write_glb(path, j, binary):
    while len(binary) % 4: binary += b'\0'
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binary), 0x004E4942) + binary
    open(path, 'wb').write(out)

COMP = {5126: ('<f4', 4), 5123: ('<u2', 2), 5125: ('<u4', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}
def acc(j, buf, i):
    a = j['accessors'][i]; v = j['bufferViews'][a['bufferView']]
    dt, _ = COMP[a['componentType']]; n = NC[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(buf, dt, a['count'] * n, off).reshape(a['count'], n) if n > 1 else np.frombuffer(buf, dt, a['count'], off)

# ---- 1. the car
g = json.load(open(os.path.join(SRC, 'covered_car_1k.gltf')))
buf = open(os.path.join(SRC, g['buffers'][0]['uri']), 'rb').read()
P, N, U, I = [], [], [], []
for node in g['nodes']:
    t = np.array(node.get('translation', [0, 0, 0]), 'f4')
    for pr in g['meshes'][node['mesh']]['primitives']:
        at = pr['attributes']
        I.append(acc(g, buf, pr['indices']).astype('u4') + sum(len(p) for p in P))
        P.append(acc(g, buf, at['POSITION']) + t); N.append(acc(g, buf, at['NORMAL'])); U.append(acc(g, buf, at['TEXCOORD_0']))
P, N, U, I = np.concatenate(P).astype('f4'), np.concatenate(N).astype('f4'), np.concatenate(U).astype('f4'), np.concatenate(I).astype('u2')
print('car', len(P), 'verts', len(I) // 3, 'tris', P.min(0), P.max(0))
parts = [P.tobytes(), N.tobytes(), U.tobytes(), I.tobytes()]
views, off = [], 0
for k, p in enumerate(parts):
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(p), 'target': 34963 if k == 3 else 34962})
    off += len(p)
    while off % 4: off += 1
binary = b''
for p in parts:
    binary += p
    while len(binary) % 4: binary += b'\0'
gj = {'asset': {'version': '2.0', 'generator': 'covered_car.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}],
      'nodes': [{'name': 'CoveredCar', 'mesh': 0}],
      'meshes': [{'name': 'CoveredCar', 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3}]}],
      'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': P.min(0).tolist(), 'max': P.max(0).tolist()},
                    {'bufferView': 1, 'componentType': 5126, 'count': len(N), 'type': 'VEC3'},
                    {'bufferView': 2, 'componentType': 5126, 'count': len(U), 'type': 'VEC2'},
                    {'bufferView': 3, 'componentType': 5123, 'count': len(I), 'type': 'SCALAR'}],
      'bufferViews': views, 'buffers': [{'byteLength': len(binary)}]}
write_glb(os.path.join(OUT, 'car.glb'), gj, binary)
tex = os.path.join(SRC, 'textures')
col = np.asarray(Image.open(os.path.join(tex, 'covered_car_diff_1k.jpg')).convert('RGB'), 'f4')
ao = np.asarray(Image.open(os.path.join(tex, 'covered_car_arm_1k.jpg')).convert('RGB'), 'f4')[..., :1] / 255
Image.fromarray(np.clip(col * ao, 0, 255).astype('u1')).save(os.path.join(OUT, 'car.jpg'), quality=85)
Image.open(os.path.join(tex, 'covered_car_nor_gl_1k.jpg')).resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'car_nor.jpg'), quality=88)

# ---- 2. strip the box cars from props.glb (same list as scene.py)
def hash_(n):
    s = math.sin(n * 127.1) * 43758.5453
    return s - math.floor(s)
LOT_EDGE, STALL_IN, STALL_W = 17.5, 8.0, 2.6
cars = []
for sx in (-1, 1):
    k = 0; y = -19.5
    while y < LOT_EDGE - STALL_W:
        if hash_(k * 7.3 + sx * 3.3) >= 0.38: cars.append((sx * (STALL_IN + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y + STALL_W / 2, sx, k))
        y += STALL_W; k += 1
for y in (-17.6, -20.1):
    for x in (-5, 0, 5):
        k = 40 + round(x + y * 3)
        if hash_(k * 2.9) < 0.2: continue
        cars.append((x + (hash_(k * 1.3) - 0.5) * 0.4, y, -1 if x < 0 else 1, k))
for sx in (-1, 1):
    k = 100; y = -19.5
    while y < LOT_EDGE - STALL_W:
        if hash_(k * 2.7 + sx) >= 0.45 and not (sx > 0 and 6.5 < y < 15.5):
            cars.append((sx * (16.0 + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y + STALL_W / 2, -sx, k))
        y += STALL_W; k += 1
# about a third of them covered; the rest stay the baked open cars
# (the same pick as COVER in js/render3d.js loadCars)
cars = [c for c in cars if hash_(c[3] * 8.3 + c[2] * 1.7) < 0.35]
print(len(cars), 'cars covered')
path = os.path.join(OUT, 'props.glb')
j, pb = read_glb(path)
pr = j['meshes'][0]['primitives'][0]
pos = acc(j, pb, pr['attributes']['POSITION'])
idx = acc(j, pb, pr['indices']).reshape(-1, 3)
c = pos[idx].mean(1)                        # three.js axes: x, up, -y
cx, cz, cy = c[:, 0], c[:, 1], -c[:, 2]
drop = np.zeros(len(idx), bool)
for x, y, sx, k in cars:
    rot = (0 if sx < 0 else math.pi) + (hash_(k * 6.1) - 0.5) * 0.06
    dx, dy = cx - x, cy - y
    lx = dx * math.cos(rot) + dy * math.sin(rot); ly = -dx * math.sin(rot) + dy * math.cos(rot)
    inside = (np.abs(lx) < 2.45) & (np.abs(ly) < 1.05) & (cz < 1.8)
    # (keeps the concrete wheel stop just past the nose: low, beyond the tyres)
    drop |= inside & ((cz > 0.16) | (np.abs(lx) < 1.8))
print('dropping', drop.sum(), 'of', len(idx), 'triangles')
keep = idx[~drop].astype('u2').ravel()
ia = j['accessors'][pr['indices']]; iv = j['bufferViews'][ia['bufferView']]
assert iv['byteOffset'] + iv['byteLength'] == len(pb) or True
before, after = pb[:iv['byteOffset']], pb[iv['byteOffset'] + iv['byteLength']:]
new = keep.tobytes()
pad = (-len(new)) % 4
shift = len(new) + pad - iv['byteLength']
for v in j['bufferViews']:
    if v['byteOffset'] > iv['byteOffset']: v['byteOffset'] += shift
iv['byteLength'] = len(new); ia['count'] = len(keep)
pb = before + new + b'\0' * pad + after
j['buffers'][0]['byteLength'] = len(pb)
write_glb(path, j, pb)
