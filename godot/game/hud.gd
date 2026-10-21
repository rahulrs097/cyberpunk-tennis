# Menu, scoreboard, stamina, messages and the pause, end and help screens,
# built in code to the web game's design (index.html): the same palette,
# fonts, panels and layout, at its CSS sizes scaled to this 720-wide screen.
class_name Hud
extends CanvasLayer

signal play_pressed
signal setting_changed(key: String, value)
signal pause_toggled(on: bool)
signal view_toggled
signal auto_toggled
signal menu_pressed

# CSS px to screen px: the web layout is designed for a 390 px wide phone
const S := 720.0 / 390.0
const CHARS := [["octopus", "Octopus", "Baseline counterpuncher"], ["philosopher", "Philosopher", "Topspin attacker"]]
const HOW := [
	["Tap", "Run to that spot. With automove on, your player chases the ball for you and a tap overrides it until the next shot. On your serve, tap to toss."],
	["Swipe", "Hit. The swipe's direction is where the ball goes, and its length is how deep: a short swipe drops it short. A downward slice swipe aims the other way: top-left to bottom-right goes left."],
	["Spin", "Swipe up for topspin, down for slice. Bend the swipe for sidespin."],
	["Pace", "A fast flick hits hard and flat. A slow swipe adds spin and safety."],
	["Lob", "Swipe up slowly over a quarter of the screen or more to loft the ball deep, over a player at the net."],
	["Timing", "Swipe as the ring closes. Late forehands drift right, late backhands drift left."],
	["Stamina", "Running, every swing and repeated power shots tire you, and you only get part of it back between points. Tired players run slower and have less time to swing. The striped part of the bar is gone for the set."],
	["Level", "Chill is slower and the CPU covers less court. Pro is full speed against a CPU that rarely misses."],
]

var root: Control
var menu: Control
var playing: Control
var pause_panel: Control
var end_panel: Control
var help_panel: Control
var rows: Array[ScoreRow] = []
var callout_l: Label
var msg_box: Control
var msg_title: Label
var msg_sub: Label
var shot_l: Label
var hint_l: Label
var toast_l: Label
var fps_l: Label
var auto_note: Label
var end_title: Label
var end_score: Label
var auto_btn: Button
var view_btn: Button
var msg_t := 0.0
var shot_t := 0.0
var toast_t := 0.0
var groups := {}
var picks := {}
var _settings: Settings


static func px(v: float) -> int:
	return roundi(v * S)


func _ready() -> void:
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_build_playing()
	_build_menu()
	_build_pause()
	_build_end()
	_build_help()
	toast_l = _label("", 13, 500, Neon.INK)
	toast_l.add_theme_stylebox_override("normal", _box(Neon.PANEL, Neon.CYAN, 6, Vector2(12, 8)))
	toast_l.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	toast_l.grow_horizontal = Control.GROW_DIRECTION_BOTH
	toast_l.grow_vertical = Control.GROW_DIRECTION_BEGIN
	toast_l.offset_bottom = -px(80)
	toast_l.visible = false
	root.add_child(toast_l)


# ---------------------------------------------------------------- styling
func _box(bg: Color, border: Color, radius := 6, pad := Vector2(10, 6), glow := Color(0, 0, 0, 0), glow_size := 0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(maxi(1, px(1)) if border.a > 0.0 else 0)
	sb.set_corner_radius_all(px(radius))
	sb.content_margin_left = px(pad.x); sb.content_margin_right = px(pad.x)
	sb.content_margin_top = px(pad.y); sb.content_margin_bottom = px(pad.y)
	sb.shadow_color = glow; sb.shadow_size = px(glow_size)
	sb.anti_aliasing = true
	return sb


# A label in the UI font (weight 400..600) or, with display, Tektur.
func _label(text: String, css_size: float, weight: int, color: Color, display := false, spacing_em := 0.0, upper := false) -> Label:
	var l := Label.new()
	l.text = text
	l.uppercase = upper
	var size := px(css_size)
	l.add_theme_font_override("font", Neon.display(weight, spacing_em, size) if display else Neon.ui(weight, spacing_em, size))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


# text-shadow: 0 0 Npx color, as a soft halo
func _glow(l: Label, color: Color, css_blur: float) -> Label:
	l.add_theme_color_override("font_shadow_color", Color(color, 0.22))
	l.add_theme_constant_override("shadow_offset_x", 0)
	l.add_theme_constant_override("shadow_offset_y", 0)
	l.add_theme_constant_override("shadow_outline_size", px(css_blur * 0.3))
	return l


# .seg button / .btn, or .btn.primary
func _button(text: String, primary := false) -> Button:
	var b := Button.new()
	b.text = text.to_upper()
	b.custom_minimum_size.y = px(44)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.focus_mode = Control.FOCUS_NONE
	var size := px(17 if primary else 14)
	b.add_theme_font_override("font", Neon.display(700, 0.0, size) if primary else Neon.ui(600, 0.06, size))
	b.add_theme_font_size_override("font_size", size)
	var normal: StyleBoxFlat
	var on: StyleBoxFlat
	if primary:
		normal = _box(Neon.PINK, Neon.PINK, 6, Vector2(12, 8), Color(Neon.PINK, 0.45), 12)
		on = normal.duplicate(); on.bg_color = Neon.PINK.lightened(0.15)
		for k in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
			b.add_theme_color_override(k, Color("#14001a"))
	else:
		normal = _box(Neon.PANEL, Neon.LINE, 6, Vector2(8, 8))
		on = normal.duplicate(); on.border_color = Neon.GOLD
		for k in ["font_color", "font_hover_color"]:
			b.add_theme_color_override(k, Neon.INK)
		for k in ["font_pressed_color", "font_hover_pressed_color"]:
			b.add_theme_color_override(k, Neon.GOLD)
	b.add_theme_stylebox_override("normal", normal)
	b.add_theme_stylebox_override("hover", normal)
	b.add_theme_stylebox_override("pressed", on)
	b.add_theme_stylebox_override("hover_pressed", on)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return b


func _row(gap := 8) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", px(gap))
	return r


# A full-screen dimmed overlay with a centred, scrolling sheet (.overlay / .sheet).
func _overlay(gap := 16) -> VBoxContainer:
	var o := Control.new()
	o.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(o)
	var dim := ColorRect.new()
	dim.color = Color(5 / 255.0, 4 / 255.0, 12 / 255.0, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	o.add_child(dim)
	var sc := ScrollContainer.new()
	sc.set_anchors_preset(Control.PRESET_FULL_RECT)
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	o.add_child(sc)
	var c := CenterContainer.new()
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	c.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.add_child(c)
	var m := MarginContainer.new()
	for k in ["margin_left", "margin_right", "margin_top", "margin_bottom"]:
		m.add_theme_constant_override(k, px(16))
	m.custom_minimum_size.x = minf(720.0, px(440) + px(32))
	c.add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", px(gap))
	m.add_child(v)
	return v


func _title(v: Container, lines: Array) -> void:
	var t := VBoxContainer.new()
	t.add_theme_constant_override("separation", -px(6))
	for ln in lines:
		var l := _label(ln[0], 43, 900, ln[1], true, 0.02, true)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		t.add_child(_glow(l, ln[1], 20))
	v.add_child(t)


func _small_label(text: String) -> Label:
	var l := _label(text, 11, 500, Neon.MUTED, false, 0.16, true)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	return l


# A segmented choice; exactly one is pressed.
func _choice(box: Container, key: String, options: Array) -> HBoxContainer:
	var row := _row()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_child(row)
	var bg := ButtonGroup.new()
	groups[key] = []
	for o in options:
		var b := _button(o[1])
		b.toggle_mode = true
		b.button_group = bg
		b.set_meta("value", o[0])
		b.pressed.connect(func(): setting_changed.emit(key.trim_suffix("_p"), o[0]))
		if options.size() > 3:
			b.add_theme_font_size_override("font_size", px(12))
			b.add_theme_font_override("font", Neon.ui(600, 0.02, px(12)))
		row.add_child(b)
		groups[key].append(b)
	return row


func _select(key: String, value) -> void:
	for b in groups.get(key, []):
		b.set_pressed_no_signal(b.get_meta("value") == value)


# ---------------------------------------------------------------- screens
func _build_menu() -> void:
	var v := _overlay()
	menu = v.get_parent().get_parent().get_parent().get_parent()
	_title(v, [["Cyberpunk", Neon.PINK], ["Tennis", Neon.CYAN]])
	var lede := _label("One set on a rooftop parking lot under the night sky. Tiebreak at 6–6.", 14, 400, Neon.MUTED)
	lede.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	lede.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(lede)
	v.add_child(_small_label("Choose your player"))
	var row := _row(10)
	v.add_child(row)
	for c in CHARS:
		var b := _pick(c[0], c[1], c[2])
		row.add_child(b)
	var play := _button("Play vs CPU", true)
	play.pressed.connect(func(): play_pressed.emit())
	v.add_child(play)
	var opts := GridContainer.new()
	opts.columns = 2
	opts.add_theme_constant_override("h_separation", px(12))
	opts.add_theme_constant_override("v_separation", px(8))
	v.add_child(opts)
	for o in [["Automove", "auto_move", [[true, "On"], [false, "Off"]]],
			["Level", "level", [["chill", "Chill"], ["club", "Club"], ["pro", "Pro"]]],
			["Camera", "view", [["chase", "Chase"], ["first", "First person"]]],
			["Graphics", "graphics", [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["ultra", "Ultra"]]]]:
		opts.add_child(_small_label(o[0]))
		_choice(opts, o[1], o[2])
	auto_note = _label("", 11, 400, Neon.MUTED)
	auto_note.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	v.add_child(auto_note)
	var how := _button("How to play")
	how.pressed.connect(func(): help_panel.visible = true)
	v.add_child(how)


# .pick: a character card
func _pick(id: String, name: String, style: String) -> Button:
	var b := Button.new()
	b.toggle_mode = true
	b.focus_mode = Control.FOCUS_NONE
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.custom_minimum_size.y = px(178)
	var normal := _box(Neon.PANEL, Neon.LINE, 6, Vector2(10, 10))
	var on := _box(Neon.PANEL, Neon.CYAN, 6, Vector2(10, 10), Color(Neon.CYAN, 0.25), 11)
	on.set_border_width_all(px(2))
	b.add_theme_stylebox_override("normal", normal)
	b.add_theme_stylebox_override("hover", normal)
	b.add_theme_stylebox_override("pressed", on)
	b.add_theme_stylebox_override("hover_pressed", on)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	for k in ["offset_left", "offset_top"]: v.set(k, px(10))
	for k in ["offset_right", "offset_bottom"]: v.set(k, -px(10))
	v.add_theme_constant_override("separation", px(4))
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_child(v)
	var img := TextureRect.new()
	img.texture = load("res://art/portrait_%s.jpg" % id)
	img.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	img.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	img.custom_minimum_size.y = px(104)
	img.clip_contents = true
	img.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(img)
	var n := _label(name, 15, 700, Neon.INK, true, 0.05, true)
	n.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(n)
	var s := _label(style, 11, 400, Neon.MUTED)
	s.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(s)
	b.pressed.connect(func(): setting_changed.emit("character", id))
	picks[id] = b
	return b


func _build_playing() -> void:
	playing = Control.new()
	playing.set_anchors_preset(Control.PRESET_FULL_RECT)
	playing.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(playing)
	var top := _row(8)
	top.set_anchors_preset(Control.PRESET_TOP_WIDE)
	top.offset_top = px(8); top.offset_left = px(12); top.offset_right = -px(12)
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	playing.add_child(top)
	var board := PanelContainer.new()
	board.add_theme_stylebox_override("panel", _box(Neon.PANEL, Neon.LINE, 6, Vector2(10, 6)))
	board.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(board)
	var bv := VBoxContainer.new()
	bv.add_theme_constant_override("separation", px(4))
	board.add_child(bv)
	for i in 2:
		var r := ScoreRow.new(self)
		bv.add_child(r)
		rows.append(r)
	callout_l = _label("", 11, 500, Neon.GOLD, false, 0.14, true)
	callout_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	bv.add_child(callout_l)
	view_btn = _hud_button("1P")
	view_btn.pressed.connect(func(): view_toggled.emit(); _refresh_view_btn())
	var pause := _hud_button("II")
	pause.pressed.connect(func(): set_paused(true))
	top.add_child(view_btn); top.add_child(pause)
	# #msg: the big word a little above the middle
	msg_box = VBoxContainer.new()
	msg_box.set_anchors_preset(Control.PRESET_TOP_WIDE)
	msg_box.anchor_top = 0.38; msg_box.anchor_bottom = 0.38
	msg_box.offset_left = px(16); msg_box.offset_right = -px(16)
	msg_box.add_theme_constant_override("separation", px(8))
	msg_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	playing.add_child(msg_box)
	msg_title = _label("", 47, 900, Neon.INK, true, 0.04, true)
	msg_sub = _label("", 15, 400, Neon.MUTED, false, 0.05)
	msg_box.add_child(msg_title); msg_box.add_child(msg_sub)
	shot_l = _bottom_label(13, 400, Neon.INK, 34, 0.0, false)
	shot_l.add_theme_color_override("font_shadow_color", Color.BLACK)
	shot_l.add_theme_constant_override("shadow_outline_size", px(5))
	shot_l.add_theme_constant_override("shadow_offset_x", 0); shot_l.add_theme_constant_override("shadow_offset_y", 0)
	hint_l = _bottom_label(12, 500, Neon.MUTED, 12, 0.08, true)


func _bottom_label(css: float, weight: int, color: Color, css_bottom: float, spacing: float, upper: bool) -> Label:
	var l := _label("", css, weight, color, false, spacing, upper)
	l.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	l.grow_vertical = Control.GROW_DIRECTION_BEGIN
	l.offset_left = px(16); l.offset_right = -px(16); l.offset_bottom = -px(css_bottom)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	playing.add_child(l)
	return l


# .hud-btn
func _hud_button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(px(40), px(40))
	b.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	b.add_theme_font_override("font", Neon.ui(600, 0.0, px(15)))
	b.add_theme_font_size_override("font_size", px(15))
	for k in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color"]:
		b.add_theme_color_override(k, Neon.INK)
	var sb := _box(Neon.PANEL, Neon.LINE, 6, Vector2(0, 0))
	var on := sb.duplicate(); on.border_color = Neon.CYAN
	b.add_theme_stylebox_override("normal", sb)
	b.add_theme_stylebox_override("hover", sb)
	b.add_theme_stylebox_override("pressed", on)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return b


func _build_pause() -> void:
	var v := _overlay()
	pause_panel = v.get_parent().get_parent().get_parent().get_parent()
	_title(v, [["Paused", Neon.CYAN]])
	var r := _row(10)
	v.add_child(r)
	var resume := _button("Resume", true)
	resume.pressed.connect(func(): set_paused(false))
	auto_btn = _button("Automove on")
	auto_btn.pressed.connect(func(): auto_toggled.emit())
	r.add_child(resume); r.add_child(auto_btn)
	v.add_child(_small_label("Graphics"))
	_choice(v, "graphics_p", [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"], ["ultra", "Ultra"]])
	fps_l = _label("", 11, 400, Neon.MUTED)
	fps_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	v.add_child(fps_l)
	var quit := _button("Quit match")
	quit.pressed.connect(func(): menu_pressed.emit())
	v.add_child(quit)


func _build_end() -> void:
	var v := _overlay()
	end_panel = v.get_parent().get_parent().get_parent().get_parent()
	end_title = _glow(_label("", 43, 900, Neon.CYAN, true, 0.02, true), Neon.CYAN, 20)
	end_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	end_title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(end_title)
	end_score = _label("", 44, 900, Neon.BALL, true)
	end_score.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	v.add_child(end_score)
	var r := _row(10)
	v.add_child(r)
	var again := _button("Rematch", true)
	again.pressed.connect(func(): play_pressed.emit())
	var m := _button("Change player")
	m.pressed.connect(func(): menu_pressed.emit())
	r.add_child(again); r.add_child(m)


func _build_help() -> void:
	var v := _overlay()
	help_panel = v.get_parent().get_parent().get_parent().get_parent()
	_title(v, [["How to play", Neon.CYAN]])
	for h in HOW:
		var r := _row(10)
		var k := _label(h[0], 11, 600, Neon.CYAN, false, 0.1, true)
		k.custom_minimum_size.x = px(74)
		k.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		k.vertical_alignment = VERTICAL_ALIGNMENT_TOP
		var t := _label(h[1], 13, 400, Neon.INK)
		t.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		t.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		r.add_child(k); r.add_child(t)
		v.add_child(r)
	var ok := _button("Got it", true)
	ok.pressed.connect(func(): help_panel.visible = false)
	v.add_child(ok)
	help_panel.visible = false


# ---------------------------------------------------------------- state
func _show(which: Control) -> void:
	for c in [menu, playing, pause_panel, end_panel]:
		c.visible = c == which or (c == playing and which in [pause_panel, end_panel])
	help_panel.visible = false


func show_menu(s: Settings) -> void:
	_show(menu)
	refresh_settings(s)


func refresh_settings(s: Settings) -> void:
	_settings = s
	for id in picks:
		picks[id].set_pressed_no_signal(id == s.character)
	_select("level", s.level)
	_select("graphics", s.graphics)
	_select("graphics_p", s.graphics)
	_select("auto_move", s.auto_move)
	_select("view", s.view)
	auto_btn.text = "AUTOMOVE ON" if s.auto_move else "AUTOMOVE OFF"
	_refresh_view_btn()
	auto_note.text = ("Auto picked %s for this phone" % Settings.PRESETS[s.auto_pick].name) if s.graphics == "auto" and s.auto_pick != "" else ""


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
	var srv := g.server if g.phase == "preServe" or g.phase == "toss" else m.current_server()
	for side in 2:
		# your row is the lower one
		rows[1 if side == me else 0].show_player(g.players[side], m, side, side == me, srv == side and not m.over)
	var call := m.callout()
	if call == "" and not m.first_serve: call = "Second serve"
	callout_l.text = call
	callout_l.visible = call != ""
	msg_t -= dt
	if msg_t <= 0.0:
		msg_title.text = ""; msg_sub.text = ""
	shot_t -= dt
	if shot_t <= 0.0: shot_l.text = ""
	toast_t -= dt
	toast_l.visible = toast_t > 0.0


func show_msg(title: String, sub: String, tone: String) -> void:
	msg_title.text = title
	msg_sub.text = sub
	var glow: Color = {"good": Neon.CYAN, "bad": Neon.PINK, "warn": Neon.GOLD}.get(tone, Neon.CYAN)
	msg_title.add_theme_color_override("font_color", {"good": Color("#dffbff"), "bad": Color("#ffe1f3"), "warn": Color("#fff3d6")}.get(tone, Neon.INK))
	_glow(msg_title, glow, 22)
	msg_t = 1.8
	# pop in
	msg_box.pivot_offset = Vector2(msg_box.size.x / 2.0, msg_box.size.y / 2.0)
	msg_box.scale = Vector2(1.25, 1.25); msg_box.modulate.a = 0.0
	var tw := create_tween().set_parallel().set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tw.tween_property(msg_box, "scale", Vector2.ONE, 0.35)
	tw.tween_property(msg_box, "modulate:a", 1.0, 0.35)


func show_shot(text: String) -> void:
	shot_l.text = text
	shot_t = 1.6


func hint(text: String) -> void:
	hint_l.text = text


func toast(text: String) -> void:
	toast_l.text = text
	toast_t = 3.0


# One player's row of the scoreboard: serve dot, name, games, points and the
# stamina bar under them (.row in index.html).
class ScoreRow extends VBoxContainer:
	var dot: Panel
	var name_l: Label
	var games_l: Label
	var pts_l: Label
	var bar: StaminaBar

	func _init(h: Hud) -> void:
		add_theme_constant_override("separation", Hud.px(3))
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		var r := h._row(8)
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(r)
		dot = Panel.new()
		dot.custom_minimum_size = Vector2(Hud.px(10), Hud.px(8))
		dot.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		var ds := StyleBoxFlat.new()
		ds.bg_color = Neon.BALL; ds.set_corner_radius_all(Hud.px(4))
		ds.shadow_color = Color(Neon.BALL, 0.7); ds.shadow_size = Hud.px(4)
		ds.expand_margin_left = 0; ds.content_margin_right = Hud.px(2)
		dot.add_theme_stylebox_override("panel", ds)
		dot.mouse_filter = Control.MOUSE_FILTER_IGNORE
		r.add_child(dot)
		name_l = h._label("", 13, 700, Neon.INK, true, 0.06, true)
		name_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
		name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		name_l.clip_text = true
		name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		r.add_child(name_l)
		games_l = h._label("0", 18, 600, Neon.INK)
		games_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		games_l.custom_minimum_size.x = Hud.px(26)
		r.add_child(games_l)
		pts_l = h._label("0", 16, 600, Neon.BALL)
		pts_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		pts_l.custom_minimum_size.x = Hud.px(34)
		r.add_child(pts_l)
		var br := h._row(8)
		br.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(br)
		var pad := Control.new(); pad.custom_minimum_size.x = Hud.px(10); pad.mouse_filter = Control.MOUSE_FILTER_IGNORE
		br.add_child(pad)
		bar = StaminaBar.new()
		bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		bar.custom_minimum_size.y = Hud.px(4)
		br.add_child(bar)

	func show_player(p: TennisPlayer, m: MatchScore, side: int, mine: bool, serving: bool) -> void:
		var pc: Color = p.ch.colors.glow
		var tired := p.stamina < 35.0
		name_l.text = p.ch.name + (" (you)" if mine else "") + (" · tired" if tired else "")
		name_l.add_theme_color_override("font_color", pc)
		games_l.text = str(m.games[side])
		pts_l.text = m.point_label(side)
		dot.modulate.a = 1.0 if serving else 0.0
		bar.set_state(p.stamina, p.cap, pc, tired)


# .stam: the fill in the player's colour (pulsing red when tired) and the
# part lost for the set striped from the cap to the end.
class StaminaBar extends Control:
	var value := 100.0
	var cap := 100.0
	var color := Neon.CYAN
	var tired := false

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func set_state(v: float, c: float, col: Color, t: bool) -> void:
		if v != value or c != cap or col != color or t != tired or t:
			value = v; cap = c; color = col; tired = t
			queue_redraw()

	func _draw() -> void:
		var w := size.x; var h := size.y
		draw_rect(Rect2(0, 0, w, h), Color(1, 1, 1, 0.08))
		var fill := Neon.WARN if tired else color
		if tired:
			fill.a = 0.45 + 0.55 * (0.5 + 0.5 * cos(Time.get_ticks_msec() / 1000.0 * PI / 0.9))
		draw_rect(Rect2(0, -1, w * value / 100.0, h + 2), Color(fill, fill.a * 0.35))   # the glow
		draw_rect(Rect2(0, 0, w * value / 100.0, h), fill)
		var x0 := w * cap / 100.0
		var stripe := Hud.px(3)
		var x := x0
		while x < w:
			draw_rect(Rect2(x, 0, minf(stripe, w - x), h), Color(1.0, 63 / 255.0, 108 / 255.0, 0.55))
			x += stripe * 2
