# Player settings, saved to user://settings.cfg, and the graphics presets.
# Every preset aims at a steady 60 fps on the phones it suits; "auto" picks
# one from a short benchmark on first launch and steps down during play if
# frames keep running slow.
class_name Settings
extends RefCounted

const PATH := "user://settings.cfg"
const ORDER := ["low", "medium", "high", "ultra"]
const PRESETS := {
	# scale: 3D resolution; detail: 0 bare court .. 2 everything
	"low": {"name": "Low", "scale": 0.6, "msaa": Viewport.MSAA_DISABLED, "fxaa": false, "glow": false, "glow_hq": false,
		"fog": false, "lamp_shadows": 0, "extra_lights": false, "detail": 0, "shadow_size": 1024, "trail": 4},
	"medium": {"name": "Medium", "scale": 0.75, "msaa": Viewport.MSAA_DISABLED, "fxaa": true, "glow": true, "glow_hq": false,
		"fog": true, "lamp_shadows": 0, "extra_lights": false, "detail": 1, "shadow_size": 1024, "trail": 6},
	"high": {"name": "High", "scale": 0.9, "msaa": Viewport.MSAA_2X, "fxaa": false, "glow": true, "glow_hq": true,
		"fog": true, "lamp_shadows": 2, "extra_lights": true, "detail": 2, "shadow_size": 2048, "trail": 10},
	"ultra": {"name": "Ultra", "scale": 1.0, "msaa": Viewport.MSAA_4X, "fxaa": false, "glow": true, "glow_hq": true,
		"fog": true, "lamp_shadows": 6, "extra_lights": true, "detail": 2, "shadow_size": 4096, "trail": 14},
}

var graphics := "auto"      # auto | low | medium | high | ultra
var auto_pick := ""         # what the benchmark chose, for auto
var character := "octopus"
var level := "club"
var auto_move := true
var view := "chase"


func load_file() -> void:
	var cf := ConfigFile.new()
	if cf.load(PATH) != OK:
		return
	graphics = cf.get_value("video", "graphics", graphics)
	auto_pick = cf.get_value("video", "auto_pick", auto_pick)
	character = cf.get_value("play", "character", character)
	level = cf.get_value("play", "level", level)
	auto_move = cf.get_value("play", "auto_move", auto_move)
	view = cf.get_value("play", "view", view)


func save() -> void:
	var cf := ConfigFile.new()
	cf.set_value("video", "graphics", graphics)
	cf.set_value("video", "auto_pick", auto_pick)
	cf.set_value("play", "character", character)
	cf.set_value("play", "level", level)
	cf.set_value("play", "auto_move", auto_move)
	cf.set_value("play", "view", view)
	cf.save(PATH)


# The preset in effect: the chosen one, or the benchmark's pick on auto.
func preset_id() -> String:
	if graphics != "auto":
		return graphics
	return auto_pick if auto_pick != "" else "medium"


func preset() -> Dictionary:
	return PRESETS[preset_id()]


# Apply the viewport-level parts of a preset.
static func apply_viewport(vp: Viewport, p: Dictionary) -> void:
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = p.scale
	vp.msaa_3d = p.msaa
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if p.fxaa else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.positional_shadow_atlas_size = p.shadow_size
	RenderingServer.directional_shadow_atlas_set_size(p.shadow_size, true)
