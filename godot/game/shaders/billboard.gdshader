// The billboard's face (game/billboard.gd): the dark panel, the photo sliding
// in its square when the sign is idle, and the 2D-drawn neon over them. Only
// the bright neon is pushed past the glow threshold, so the photo stays a
// photo while the tag, words and frame bloom.
shader_type spatial;
render_mode unshaded, cull_disabled;

uniform sampler2D face : source_color, filter_linear;
uniform sampler2D photo : source_color, filter_linear_mipmap;
uniform vec4 photo_rect;          // x, y, w, h in face UV
uniform float photo_span = 1.0;   // the photo's visible height, as a fraction of it
uniform bool photo_on = false;
uniform float slide = 0.0;        // 0 top .. 1 bottom of the photo
uniform float on = 1.0;           // flicker and hum
uniform float neon_gain = 2.6;

void fragment() {
	vec2 uv = UV;
	vec3 c = vec3(8.0, 6.0, 22.0) / 255.0;
	c = c * c;   // (sRGB to linear, roughly)
	vec2 p = (uv - photo_rect.xy) / photo_rect.zw;
	if (photo_on && p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) {
		c = texture(photo, vec2(p.x, slide * (1.0 - photo_span) + p.y * photo_span)).rgb * 0.85;
	}
	vec4 f = texture(face, uv);
	float hot = smoothstep(0.35, 0.9, max(f.r, max(f.g, f.b)));
	vec3 neon = f.rgb * (1.0 + (neon_gain - 1.0) * hot);
	c = mix(c, neon, f.a);
	ALBEDO = c * on;
}
