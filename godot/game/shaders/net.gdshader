// The net: a 4.5 cm square mesh of dark cord, drawn on a quad. UV is (x, z) in metres.
shader_type spatial;
render_mode cull_disabled, depth_prepass_alpha;

void fragment() {
	vec2 g = abs(fract(UV / 0.045) - 0.5);
	float w = fwidth(UV.x / 0.045) * 0.8 + 0.06;
	float cord = smoothstep(0.5 - w, 0.5, max(g.x, g.y));
	ALBEDO = vec3(0.05, 0.045, 0.06);
	EMISSION = vec3(1.0, 0.25, 0.7) * 0.04;
	ROUGHNESS = 0.7;
	ALPHA = clamp(cord * 0.9, 0.0, 0.9);
}
