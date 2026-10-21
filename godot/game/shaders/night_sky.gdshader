// The game's night sky: purple haze on the horizon into deep blue, stars and a moon.
shader_type sky;

uniform vec3 moon_dir = vec3(0.33, 0.21, -0.92);

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

void sky() {
	vec3 d = EYEDIR;
	float h = d.y;
	vec3 horizon = vec3(0.069, 0.012, 0.078);   // #4a1d4f
	vec3 low = vec3(0.024, 0.008, 0.026);       // #2b1645
	vec3 mid = vec3(0.003, 0.004, 0.019);       // #0a0d26
	vec3 top = vec3(0.0006, 0.0009, 0.003);     // #02030a
	vec3 c = mix(horizon, low, smoothstep(0.0, 0.03, h));
	c = mix(c, mid, smoothstep(0.03, 0.12, h));
	c = mix(c, top, smoothstep(0.12, 0.45, h));
	if (h < 0.0) c = horizon * 0.6;
	// stars: one candidate per cell of a direction grid
	vec3 g = floor(d * 220.0);
	float r = hash(g);
	if (h > 0.04 && r > 0.985) {
		vec3 cp = (g + 0.5 + (vec3(hash(g + 1.0), hash(g + 2.0), hash(g + 3.0)) - 0.5) * 0.6) / 220.0;
		float s = smoothstep(0.0025, 0.0, length(d - normalize(cp)) );
		c += vec3(0.8, 0.85, 1.0) * s * (0.6 + 1.4 * hash(g + 7.0));
	}
	float m = dot(d, normalize(moon_dir));
	c += vec3(0.9, 0.92, 1.0) * smoothstep(0.99975, 0.9998, m) * 3.0;
	c += vec3(0.5, 0.55, 0.8) * pow(max(m, 0.0), 900.0) * 0.4;
	COLOR = c;
}
