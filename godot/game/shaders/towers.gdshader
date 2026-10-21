// Skyline towers: dark boxes with sparse lit windows (warm, a few cyan and pink),
// fading into the purple haze with distance.
shader_type spatial;
render_mode unshaded;

varying vec3 wp;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }

void fragment() {
	vec3 n = abs(NORMAL);
	// windows 1.9 m apart, floors 3.4 m, on whichever wall this is
	vec2 u = vec2(wp.x + wp.z, wp.y);
	vec2 cell = floor(u / vec2(1.9, 3.4));
	vec2 f = fract(u / vec2(1.9, 3.4));
	float win = step(0.12, f.x) * step(f.x, 0.88) * step(0.15, f.y) * step(f.y, 0.85);
	float r = hash(vec3(cell, floor(wp.x * 0.05)));
	float on = win * step(0.86, r);
	vec3 col = r > 0.975 ? vec3(1.0, 0.25, 0.7) : (r > 0.93 ? vec3(0.15, 0.85, 1.0) : vec3(1.0, 0.78, 0.47));
	float dist = length(wp - CAMERA_POSITION_WORLD);
	float haze = clamp((dist - 150.0) / 700.0, 0.0, 0.55) * mix(1.0, 0.4, clamp(wp.y / 60.0, 0.0, 1.0));
	vec3 c = mix(vec3(0.006, 0.005, 0.012), col * 1.6, on);
	ALBEDO = mix(c, vec3(0.045, 0.008, 0.05), haze);
}
