# Menu, scoreboard, stamina, messages and the pause and end screens, built
# in code with a neon look.
class_name Hud
extends CanvasLayer

signal play_pressed
signal setting_changed(key: String, value)
signal pause_toggled(on: bool)
signal view_toggled
signal auto_toggled
signal menu_pressed

const CYAN := Color("#25d9ff")
const PINK := Color("#ff3fb4")
const GOLD := Color("#ffc23d")
const RED := Color("#ff3f6c")
const INK := Color("#e8f6ff")

var root: Control
var menu: Control
var playing: Control
var pause_panel: Control
var end_panel: Control
var score_l: Array[Label] = []
var stam: Array[ProgressBar] = []
var msg_title: Label
var msg_sub: Label
var shot_l: Label
var hint_l: Label
var toast_l: Label
var fps_l: Label
var end_title: Label
var end_score: Label
var auto_btn: Button
var view_btn: Button
var msg_t := 0.0
var shot_t := 0.0
var toast_t := 0.0
var groups := {}


func _ready() -> void:
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_playing()
	_build_menu()
	_build_pause()
	_build_end()
	toast_l = _label("", 22, INK)
	toast_l.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast_l.position.y -= 160
	root.add_child(toast_l)


# ---------------------------------------------------------------- helpers
func _label(text: String, size: int, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("outline_size", 6)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _button(text: String, color := CYAN, size := 26) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.add_theme_color_override("font_color", color)
	b.add_theme_color_override("font_pressed_color", Color.BLACK)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.03, 0.02, 0.08, 0.85)
	sb.border_color = color
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(10)
	sb.content_margin_left = 18; sb.content_margin_right = 18; sb.content_margin_top = 10; sb.content_margin_bottom = 10
	var on := sb.duplicate()
	on.bg_color = color
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", sb)
	b.add_theme_stylebox_override("pressed", on)
	b.add_theme_stylebox_override("focus", sb)
	return b


func _panel() -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.01, 0.06, 0.82)
	sb.border_color = PINK
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(16)
	sb.content_margin_left = 24; sb.content_margin_right = 24; sb.content_margin_top = 24; sb.content_margin_bottom = 24
	p.add_theme_stylebox_override("panel", sb)
	return p


# A row of toggle buttons; exactly one is pressed.
func _choice(box: Container, key: String, title: String, options: Array) -> void:
	box.add_child(_label(title, 20, Color(INK, 0.7)))
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 8)
	box.add_child(row)
	var bg := ButtonGroup.new()
	groups[key] = []
	for o in options:
		var b := _button(o[1], CYAN, 22)
		b.toggle_mode = true
		b.button_group = bg
		b.set_meta("value", o[0])
		b.pressed.connect(func(): setting_changed.emit(key.trim_suffix("_p"), o[0]))
		row.add_child(b)
		groups[key].append(b)


func _select(key: String, value) -> void:
	for b in groups.get(key, []):
		b.set_pressed_no_signal(b.get_meta("value") == value)


# ---------------------------------------------------------------- screens
func _build_menu() -> void:
	menu = CenterContainer.new()
	menu.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(menu)
	var p := _panel()
	menu.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	p.add_child(v)
	var t := _label("CYBERPUNK\nTENNIS", 54, CYAN)
	t.add_theme_color_override("font_outline_color", PINK)
	v.add_child(t)
	_choice(v, "character", "Play as", [["octopus", "Octopus"], ["philosopher", "Philosopher"]])
	_choice(v, "level", "Level", [["chill", "Chill"], ["club", "Club"], ["pro", "Pro"]])
	_choice(v, "graphics", "Graphics", [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["ultra", "Ultra"]])
	_choice(v, "auto_move", "Automove", [[true, "On"], [false, "Off"]])
	_choice(v, "view", "Camera", [["chase", "Behind"], ["first", "First person"]])
	var play := _button("PLAY", PINK, 34)
	play.pressed.connect(func(): play_pressed.emit())
	v.add_child(play)


func _build_playing() -> void:
	playing = Control.new()
	playing.set_anchors_preset(Control.PRESET_FULL_RECT)
	playing.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(playing)
	var top := VBoxContainer.new()
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.offset_top = 14; top.offset_left = 14; top.offset_right = -14
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	playing.add_child(top)
	for i in 2:
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		top.add_child(row)
		var l := _label("", 24, INK)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		score_l.append(l)
		var bar := ProgressBar.new()
		bar.custom_minimum_size = Vector2(140, 14)
		bar.show_percentage = false
		bar.max_value = 100
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var fill := StyleBoxFlat.new(); fill.bg_color = CYAN; fill.set_corner_radius_all(6)
		var bgs := StyleBoxFlat.new(); bgs.bg_color = Color(1, 1, 1, 0.12); bgs.set_corner_radius_all(6)
		bar.add_theme_stylebox_override("fill", fill)
		bar.add_theme_stylebox_override("background", bgs)
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(bar)
		stam.append(bar)
	var btns := HBoxContainer.new()
	btns.alignment = BoxContainer.ALIGNMENT_END
	btns.add_theme_constant_override("separation", 8)
	top.add_child(btns)
	auto_btn = _button("AUTO", CYAN, 18)
	auto_btn.pressed.connect(func(): auto_toggled.emit())
	view_btn = _button("1P", CYAN, 18)
	view_btn.pressed.connect(func(): view_toggled.emit(); _refresh_view_btn())
	var pause := _button("II", PINK, 18)
	pause.pressed.connect(func(): set_paused(true))
	for b in [auto_btn, view_btn, pause]: btns.add_child(b)
	var mid := VBoxContainer.new()
	mid.set_anchors_preset(Control.PRESET_CENTER)
	mid.grow_horizontal = Control.GROW_DIRECTION_BOTH
	mid.position.y -= 160
	mid.mouse_filter = Control.MOUSE_FILTER_IGNORE
	playing.add_child(mid)
	msg_title = _label("", 52, CYAN)
	msg_sub = _label("", 24, INK)
	mid.add_child(msg_title); mid.add_child(msg_sub)
	shot_l = _label("", 24, GOLD)
	shot_l.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	shot_l.grow_horizontal = Control.GROW_DIRECTION_BOTH
	shot_l.position.y -= 110
	playing.add_child(shot_l)
	hint_l = _label("", 20, Color(INK, 0.75))
	hint_l.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint_l.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint_l.position.y -= 60
	playing.add_child(hint_l)


func _build_pause() -> void:
	pause_panel = CenterContainer.new()
	pause_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(pause_panel)
	var p := _panel()
	pause_panel.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	p.add_child(v)
	v.add_child(_label("PAUSED", 44, PINK))
	fps_l = _label("", 18, Color(INK, 0.6))
	v.add_child(fps_l)
	_choice(v, "graphics_p", "Graphics", [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["ultra", "Ultra"]])
	var resume := _button("RESUME", CYAN, 30)
	resume.pressed.connect(func(): set_paused(false))
	v.add_child(resume)
	var quit := _button("MENU", PINK, 26)
	quit.pressed.connect(func(): menu_pressed.emit())
	v.add_child(quit)


func _build_end() -> void:
	end_panel = CenterContainer.new()
	end_panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(end_panel)
	var p := _panel()
	end_panel.add_child(p)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	p.add_child(v)
	end_title = _label("", 40, CYAN)
	end_score = _label("", 30, INK)
	v.add_child(end_title); v.add_child(end_score)
	var again := _button("REMATCH", PINK, 30)
	again.pressed.connect(func(): play_pressed.emit())
	v.add_child(again)
	var m := _button("MENU", CYAN, 26)
	m.pressed.connect(func(): menu_pressed.emit())
	v.add_child(m)


# ---------------------------------------------------------------- state
func _show(which: Control) -> void:
	for c in [menu, playing, pause_panel, end_panel]:
		c.visible = c == which or (c == playing and which in [pause_panel, end_panel])


func show_menu(s: Settings) -> void:
	_show(menu)
	refresh_settings(s)


var _settings: Settings

func refresh_settings(s: Settings) -> void:
	_settings = s
	_select("character", s.character)
	_select("level", s.level)
	_select("graphics", s.graphics)
	_select("graphics_p", s.graphics)
	_select("auto_move", s.auto_move)
	_select("view", s.view)
	auto_btn.text = "AUTO ON" if s.auto_move else "AUTO OFF"
	_refresh_view_btn()
	if s.graphics == "auto" and s.auto_pick != "":
		for b in groups["graphics"] + groups["graphics_p"]:
			if b.get_meta("value") == "auto":
				b.text = "Auto (%s)" % Settings.PRESETS[s.auto_pick].name


func _refresh_view_btn() -> void:
	if _settings:
		view_btn.text = "3P" if _settings.view == "first" else "1P"


func start_match(g: TennisGame, me: int, s: Settings) -> void:
	_show(playing)
	refresh_settings(s)
	msg_title.text = ""; msg_sub.text = ""; shot_l.text = ""
	update(g, me, 0.0)


func set_paused(on: bool) -> void:
	_show(pause_panel if on else playing)
	fps_l.text = "%d fps" % Engine.get_frames_per_second()
	pause_toggled.emit(on)


func show_end(g: TennisGame, me: int) -> void:
	_show(end_panel)
	var m := g.match_score
	var w := m.winner
	end_title.text = "You win the set" if w == me else "%s wins the set" % g.players[w].ch.name
	var sc := "%d–%d" % [m.games[w], m.games[1 - w]]
	if m.tiebreak: sc += " (%d–%d)" % [m.points[w], m.points[1 - w]]
	end_score.text = sc


func update(g: TennisGame, me: int, dt: float) -> void:
	var m := g.match_score
	for i in 2:
		var p := g.players[i]
		var serve := "●  " if g.server == i else "   "
		var who: String = p.ch.name + (" (you)" if i == me else "")
		score_l[i].text = "%s%s   %d   %s" % [serve, who, m.games[i], m.point_label(i)]
		stam[i].value = p.stamina
		var low := p.stamina < 35.0
		(stam[i].get_theme_stylebox("fill") as StyleBoxFlat).bg_color = RED if low else CYAN
		stam[i].modulate.a = 0.6 + 0.4 * absf(sin(Time.get_ticks_msec() / 200.0)) if low else 1.0
	msg_t -= dt
	if msg_t <= 0.0:
		msg_title.text = ""; msg_sub.text = ""
	shot_t -= dt
	if shot_t <= 0.0: shot_l.text = ""
	toast_t -= dt
	if toast_t <= 0.0: toast_l.text = ""


func show_msg(title: String, sub: String, tone: String) -> void:
	msg_title.text = title
	msg_sub.text = sub
	msg_title.add_theme_color_override("font_color", {"good": CYAN, "bad": RED, "warn": GOLD}.get(tone, INK))
	msg_t = 1.8


func show_shot(text: String) -> void:
	shot_l.text = text
	shot_t = 1.6


func hint(text: String) -> void:
	hint_l.text = text


func toast(text: String) -> void:
	toast_l.text = text
	toast_t = 3.0
