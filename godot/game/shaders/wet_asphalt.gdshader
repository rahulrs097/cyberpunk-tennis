// The deck: dark asphalt with damp, glossy patches and fine grain.
shader_type spatial;

varying vec3 wp;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec2 p = wp.xz;
	float wet = smoothstep(0.5, 0.62, fbm(p * 0.16));
	float grain = noise(p * 6.0);
	vec3 base = mix(vec3(0.011, 0.012, 0.017), vec3(0.006, 0.006, 0.008), grain);
	ALBEDO = mix(base, vec3(0.003), wet * 0.3);
	ROUGHNESS = mix(0.55, 0.06, wet);
	SPECULAR = 0.5;
}
