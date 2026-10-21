// Car paint with a clear coat; the band between the beltline and the roof is glass.
// Model space y is height (the meshes come from art/court-test).
shader_type spatial;

uniform vec3 paint : source_color = vec3(0.1, 0.1, 0.15);
varying vec3 lp;

void vertex() { lp = VERTEX; }

void fragment() {
	float glass = step(0.97, lp.y) * step(lp.y, 1.31) * step(0.06, abs(lp.x + 0.3));
	ALBEDO = mix(paint, vec3(0.004, 0.006, 0.01), glass);
	METALLIC = mix(0.55, 0.0, glass);
	ROUGHNESS = mix(0.3, 0.03, glass);
	CLEARCOAT = 1.0;
	CLEARCOAT_ROUGHNESS = 0.04;
}
