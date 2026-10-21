# The web game's look, shared by the HUD and the billboard: its palette and
# its two fonts, Tektur (display) and Chakra Petch (UI), both from Google
# Fonts under the OFL (fonts/).
class_name Neon
extends RefCounted

const VOID := Color("#05040c")
const PANEL := Color(14 / 255.0, 10 / 255.0, 34 / 255.0, 0.78)
const INK := Color("#eae6ff")
const MUTED := Color("#9d95c9")
const CYAN := Color("#25d9ff")
const PINK := Color("#ff3fb4")
const GOLD := Color("#ffc23d")
const BALL := Color("#e4ff4a")
const WARN := Color("#ff3f6c")
const LINE := Color(122 / 255.0, 92 / 255.0, 1.0, 0.35)
const COURT_LINE := Color("#7af6ff")

static var _cache := {}


# Tektur at a weight (500..900), with letter spacing in em at a given size.
static func display(weight := 900, spacing_em := 0.0, size := 16) -> Font:
	return _font("res://fonts/Tektur.ttf", weight, spacing_em, size)


# Chakra Petch: 400, 500 or 600.
static func ui(weight := 500, spacing_em := 0.0, size := 16) -> Font:
	var file: String = {400: "Regular", 500: "Medium", 600: "SemiBold"}.get(weight, "Medium")
	return _font("res://fonts/ChakraPetch-%s.ttf" % file, 0, spacing_em, size)


static func _font(path: String, weight: int, spacing_em: float, size: int) -> Font:
	var spacing := roundi(spacing_em * size)
	var key := "%s|%d|%d" % [path, weight, spacing]
	if _cache.has(key):
		return _cache[key]
	var f := FontVariation.new()
	f.base_font = load(path)
	if weight > 0:
		f.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
	f.spacing_glyph = spacing
	_cache[key] = f
	return f
