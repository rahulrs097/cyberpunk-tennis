# The neon sign over the skyline (render.js BOARD): a photo that slowly
# slides up and down beside the tag HHORNS, a word flashed when something
# happens, or a Hawk-Eye close-up of a close line call. The face is drawn in
# 2D at the web game's texture size (520 x 168) into a SubViewport, exactly
# as render.js draws it, and shown on a quad whose bright parts are pushed
# over the glow threshold so the neon blooms.
class_name Billboard
extends Node3D

const TEX_W := 520
const TEX_H := 168
const WIDTH := 17.0
const HEIGHT := 5.2
const BASE := 5.5
const TAG := "HHORNS"
const TAG_COLOR := Color("#25d9ff")

var board = null            # {text, color, call, me, from, until}
var canvas: BoardFace
var vp: SubViewport
var face_mat: ShaderMaterial
var photo: Texture2D


func _init(metal: Material) -> void:
	var pylon := MeshInstance3D.new(); var pm := CylinderMesh.new()
	pm.top_radius = 0.5; pm.bottom_radius = 0.5; pm.height = BASE + Arena.DROP
	pylon.mesh = pm; pylon.material_override = metal; pylon.position = Vector3(0, (BASE - Arena.DROP) / 2.0, -0.6)
	add_child(pylon)
	var back := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(WIDTH, HEIGHT, 0.3)
	back.mesh = bm; back.material_override = metal; back.position = Vector3(0, BASE + HEIGHT / 2.0, -0.3)
	add_child(back)
	photo = load("res://art/billboard.jpg")
	vp = SubViewport.new()
	vp.size = Vector2i(TEX_W, TEX_H)
	vp.transparent_bg = true
	vp.disable_3d = true
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	canvas = BoardFace.new()
	canvas.size = Vector2(TEX_W, TEX_H)
	canvas.sign = self
	vp.add_child(canvas)
	face_mat = ShaderMaterial.new()
	face_mat.shader = load("res://game/shaders/billboard.gdshader")
	face_mat.set_shader_parameter("face", vp.get_texture())
	face_mat.set_shader_parameter("photo", photo)
	var px := 12.0 / TEX_W; var py := 12.0 / TEX_H
	var side := TEX_H - 24.0
	face_mat.set_shader_parameter("photo_rect", Vector4(px, py, side / TEX_W, side / TEX_H))
	var ps := photo.get_size()
	face_mat.set_shader_parameter("photo_span", minf(ps.y, ps.x) / ps.y)
	var quad := MeshInstance3D.new(); var qm := QuadMesh.new(); qm.size = Vector2(WIDTH, HEIGHT)
	quad.mesh = qm; quad.material_override = face_mat
	quad.position = Vector3(0, BASE + HEIGHT / 2.0, -0.12)
	add_child(quad)


# Flash a word for `secs` seconds.
func show_word(text: String, color: Color, secs := 2.5) -> void:
	var now := _now()
	board = {"text": text, "color": color, "from": now, "until": now + secs}
	canvas.queue_redraw()


# Put a close line call up (the engine's lineCall event), seen from side `me`.
func show_call(call: Dictionary, me: int, secs := 3.0) -> void:
	var now := _now()
	board = {"call": call, "me": me, "from": now, "until": now + secs}
	canvas.queue_redraw()


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


# what the sign shows now: the latest word or call until it expires, else
# the photo and tag
func current() -> Dictionary:
	var now := _now()
	if board != null and now < board.until:
		return board
	return {"photo": true, "from": board.until if board != null else 0.0}


func _process(_dt: float) -> void:
	var now := _now()
	var cur := current()
	# a new word flickers on, then hums
	var age: float = now - cur.from
	var on := (0.25 if int(floor(age * 24.0)) % 2 else 1.0) if age < 0.35 else 0.88 + 0.12 * sin(now * 3.0)
	face_mat.set_shader_parameter("on", on)
	face_mat.set_shader_parameter("photo_on", cur.has("photo"))
	face_mat.set_shader_parameter("slide", 0.5 - 0.5 * cos(now * 0.5))   # eases at each end
	if cur.has("call") or cur != canvas.drawn:
		canvas.queue_redraw()


# The sign's face, drawn like render.js boardTexture / drawBoardPhoto /
# drawBoardCall. The photo itself goes in under it in the shader.
class BoardFace extends Control:
	var sign: Billboard
	var drawn := {}

	func _draw() -> void:
		var cur := sign.current()
		drawn = cur
		var W := float(TEX_W); var H := float(TEX_H)
		if cur.has("photo"):
			_photo_face(W, H)
		elif cur.has("call"):
			_call_face(W, H, cur.call, cur.me, sign._now() - cur.from)
		else:
			_word_face(W, H, cur.text, cur.color)

	func _frame(W: float, H: float) -> void:
		draw_rect(Rect2(8, 8, W - 16, H - 16), Neon.PINK, false, 6.0)

	# text centred on (cx, cy), shrunk to fit max_w
	func _text(text: String, cx: float, cy: float, size: int, weight: int, color: Color, max_w := 0.0, core := 0.0) -> void:
		var f := Neon.display(weight)
		var w := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		if max_w > 0.0 and w > max_w:
			size = int(floor(size * max_w / w)); w = f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
		var base := cy + (f.get_ascent(size) - f.get_descent(size)) / 2.0
		draw_string(f, Vector2(cx - w / 2.0, base), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
		if core > 0.0:   # the hot core of the neon
			draw_string(f, Vector2(cx - w / 2.0, base), text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, Color(1, 1, 1, core))

	func _word_face(W: float, H: float, text: String, color: Color) -> void:
		draw_rect(Rect2(0, 0, W, H), Color(8 / 255.0, 6 / 255.0, 22 / 255.0, 0.82))
		_frame(W, H)
		_text(text, W / 2.0, H / 2.0 + 4.0, 104, 900, color, W - 70.0, 0.75)

	func _photo_face(W: float, H: float) -> void:
		var m := 12.0; var side := H - 2.0 * m
		_frame(W, H)
		draw_line(Vector2(m + side + 3.0, 8), Vector2(m + side + 3.0, H - 8), Neon.PINK, 6.0)
		var cx := (m + side + W) / 2.0
		_text(TAG, cx, H / 2.0 + 4.0, 80, 900, TAG_COLOR, W - side - 60.0, 0.7)

	func _call_face(W: float, H: float, call: Dictionary, me: int, age: float) -> void:
		var R := Phys.R
		var m: float = call.m
		var out := m > 0.0
		var vw := 330.0; var vx := 14.0; var vy := 14.0; var vh := H - 28.0   # the close-up's window
		var f := -1.0 if me == 1 else 1.0   # seen from your end of the court
		var sp := Vector2(call.vx, call.vy).length()
		var skid := minf(0.14, sp * 0.004)   # how far the mark runs on past the contact
		var dx: float = call.vx / sp if sp > 0.1 else 0.0
		var dy: float = call.vy / sp if sp > 0.1 else 0.0
		var q := _nearest_line(call.x, call.y, call.box)
		var ox: float = (call.x + q.x) / 2.0; var oy: float = (call.y + q.y) / 2.0
		var hx: float = absf(call.x - q.x) / 2.0 + R + skid + 0.06
		var hy: float = absf(call.y - q.y) / 2.0 + R + skid + 0.06
		var zoom := 1.0 - pow(1.0 - minf(1.0, age / 0.6), 3.0)
		var k := minf(minf(vw / (2.0 * hx), vh / (2.0 * hy)), vh / 0.22) * (0.35 + 0.65 * zoom)   # px per metre
		var to_px := func(x: float, y: float) -> Vector2:
			return Vector2(vx + vw / 2.0 + f * (x - ox) * k, vy + vh / 2.0 - f * (y - oy) * k)
		var rect := func(r: Array) -> Rect2:
			var a: Vector2 = to_px.call(r[0], r[2]); var b: Vector2 = to_px.call(r[1], r[3])
			return Rect2(a, b - a).abs().intersection(Rect2(vx, vy, vw, vh))
		draw_rect(Rect2(0, 0, W, H), Color(8 / 255.0, 6 / 255.0, 22 / 255.0, 0.88))
		draw_rect(Rect2(vx, vy, vw, vh), Color("#08152b"))   # out
		draw_rect(rect.call(_call_area(call.box)), Color("#17487f"))   # in
		for l in _court_lines():
			var r: Rect2 = rect.call(l)
			if r.has_area(): draw_rect(r, Neon.COURT_LINE)
		# the mark: an oval from the back of the contact patch, stretched on along the skid
		var c: Vector2 = to_px.call(call.x + dx * skid / 2.0, call.y + dy * skid / 2.0)
		var ang := atan2(-f * dy, f * dx)
		var a := minf(1.0, age / 0.35)
		var pts := PackedVector2Array()
		for i in 40:
			var t := TAU * i / 40.0
			var e := Vector2(cos(t) * (R + skid / 2.0) * k, sin(t) * R * k).rotated(ang) + c
			e.x = clampf(e.x, vx, vx + vw); e.y = clampf(e.y, vy, vy + vh)
			pts.append(e)
		draw_colored_polygon(pts, Color(228 / 255.0, 1.0, 74 / 255.0, 0.55 * a))
		pts.append(pts[0])
		draw_polyline(pts, Color(Neon.BALL, a), 3.0, true)
		_frame(W, H)
		draw_line(Vector2(vx + vw + 3.0, 8), Vector2(vx + vw + 3.0, H - 8), Neon.PINK, 6.0)
		# the call, after the mark has landed
		if age < 0.35:
			return
		var col := Neon.WARN if out else Color("#3fff9a")
		var cx := (vx + vw + W) / 2.0; var tw := W - vx - vw - 30.0
		var mm := maxi(1, roundi(absf(m) * 1000.0))
		var dist := ("%d MM" % mm) if mm < 10 else ("%d CM" % roundi(mm / 10.0))
		_text("OUT" if out else "IN", cx, H * 0.36, 60, 900, col, tw)
		_text(dist, cx, H * 0.7, 36, 700, Color("#e8f6ff"), tw)

	# each line as [x0, x1, y0, y1]
	func _court_lines() -> Array:
		var SW := Phys.SW; var DW := Phys.DW; var HL := Phys.HL; var SL := Phys.SL; var LW := Phys.LW; var BW := 2.0 * LW
		return [[SW - LW, SW, -HL, HL], [-SW, -SW + LW, -HL, HL],
			[DW - LW, DW, -HL, HL], [-DW, -DW + LW, -HL, HL],
			[-DW, DW, HL - BW, HL], [-DW, DW, -HL, -HL + BW],
			[-SW, SW, SL - LW, SL], [-SW, SW, -SL, -SL + LW],
			[-LW / 2.0, LW / 2.0, -SL, SL]]

	# the area the ball had to land in; box: {side, sign} of the service box
	# for a serve, else null
	func _call_area(box) -> Array:
		if not box is Dictionary:
			return [-Phys.SW, Phys.SW, -Phys.HL, Phys.HL]
		var x := [-Phys.LW / 2.0, Phys.SW] if box.sign > 0 else [-Phys.SW, Phys.LW / 2.0]
		return [x[0], x[1], -Phys.SL if box.side == 0 else 0.0, 0.0 if box.side == 0 else Phys.SL]

	# the nearest point on a line the ball could have landed out over
	func _nearest_line(x: float, y: float, box) -> Vector2:
		var a := _call_area(box)
		if x < a[0] or x > a[1] or y < a[2] or y > a[3]:
			return Vector2(clampf(x, a[0], a[1]), clampf(y, a[2], a[3]))
		var edges := [[x - a[0], a[0], y], [a[1] - x, a[1], y]]
		# (the net isn't a line)
		if not box is Dictionary or box.side == 1: edges.append([a[3] - y, x, a[3]])
		if not box is Dictionary or box.side == 0: edges.append([y - a[2], x, a[2]])
		edges.sort_custom(func(p, q): return p[0] < q[0])
		return Vector2(edges[0][1], edges[0][2])
