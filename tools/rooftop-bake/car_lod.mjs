// Thin models/rooftop/car.glb (from covered_car.py) to a phone budget:
// 39 cars on the roof at the scan's 12.6k triangles would be half a million.
//   npm i meshoptimizer@0.21.0 && node car_lod.mjs [target tris]
import { readFileSync, writeFileSync } from 'node:fs';
import { MeshoptSimplifier as S } from 'meshoptimizer';
const path = new URL('../../models/rooftop/car.glb', import.meta.url);
const b = readFileSync(path);
const jl = b.readUInt32LE(12), j = JSON.parse(b.subarray(20, 20 + jl)), bin = b.subarray(28 + jl);
const view = (i, T) => { const a = j.accessors[i], v = j.bufferViews[a.bufferView]; const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[a.type]; return new T(bin.buffer.slice(bin.byteOffset + (v.byteOffset || 0), bin.byteOffset + (v.byteOffset || 0) + a.count * n * T.BYTES_PER_ELEMENT)); };
const P = view(0, Float32Array), N = view(1, Float32Array), U = view(2, Float32Array), I = new Uint32Array(view(3, Uint16Array));
// the four wheels (first, 2016 triangles each, mostly under the cover) thin far more than the cover
const cover = +(process.argv[2] || 2000), wheel = +(process.argv[3] || 160), W = 4 * 2016 * 3;
await S.ready;
S.useExperimentalFeatures = true;   // (simplifyWithAttributes)
const attr = new Float32Array(P.length / 3 * 5);
for (let i = 0; i < P.length / 3; i++) attr.set([N[i * 3] * 0.5, N[i * 3 + 1] * 0.5, N[i * 3 + 2] * 0.5, U[i * 2], U[i * 2 + 1]], i * 5);
const thin = (ix, n, e) => S.simplifyWithAttributes(ix, P, 3, attr, 5, [1, 1, 1, 2, 2], null, n * 3, e, [])[0];
const parts0 = [0, 1, 2, 3].map((w) => thin(I.slice(w * 2016 * 3, (w + 1) * 2016 * 3), wheel, 0.2));
parts0.push(thin(I.slice(W), cover, 0.2));
const idx = new Uint32Array(parts0.reduce((a, p) => a + p.length, 0)); let at = 0;
for (const p of parts0) { idx.set(p, at); at += p.length; }
console.log('tris', I.length / 3, '->', idx.length / 3, parts0.map((p) => p.length / 3));
// compact the vertices
const map = new Int32Array(P.length / 3).fill(-1); let n = 0;
const out = new Uint16Array(idx.length);
for (let k = 0; k < idx.length; k++) { const v = idx[k]; if (map[v] < 0) map[v] = n++; out[k] = map[v]; }
const P2 = new Float32Array(n * 3), N2 = new Float32Array(n * 3), U2 = new Float32Array(n * 2);
map.forEach((m, v) => { if (m < 0) return; P2.set(P.subarray(v * 3, v * 3 + 3), m * 3); N2.set(N.subarray(v * 3, v * 3 + 3), m * 3); U2.set(U.subarray(v * 2, v * 2 + 2), m * 2); });
const parts = [P2, N2, U2, out].map((a) => { const u = Buffer.from(a.buffer, a.byteOffset, a.byteLength); return Buffer.concat([u, Buffer.alloc((4 - u.length % 4) % 4)]); });
let off = 0;
j.bufferViews = parts.map((p, k) => { const v = { buffer: 0, byteOffset: off, byteLength: k === 3 ? out.byteLength : p.length, target: k === 3 ? 34963 : 34962 }; off += p.length; return v; });
j.accessors[0].count = j.accessors[1].count = j.accessors[2].count = n; j.accessors[3].count = out.length;
const B = Buffer.concat(parts); j.buffers = [{ byteLength: B.length }];
let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + B.length, 8);
const ch = (len, type) => { const c = Buffer.alloc(8); c.writeUInt32LE(len, 0); c.writeUInt32LE(type, 4); return c; };
writeFileSync(path, Buffer.concat([head, ch(js.length, 0x4E4F534A), js, ch(B.length, 0x004E4942), B]));
