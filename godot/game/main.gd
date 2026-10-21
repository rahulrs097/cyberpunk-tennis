# The app: menu, match loop, touch input and HUD (js/main.js). Single player
# against the CPU; the online mode comes with multiplayer.
extends Node3D

# What the billboard says (as js/main.js)
const BOARD_WORDS := {"Ace": ["YEAH!!", "#e4ff4a"], "Winner": ["OMG!!", "#e4ff4a"], "Out": ["OOPS", "#ff3f6c"],
	"Net": ["OOPS", "#ff3f6c"], "Double fault": ["OOPS", "#ff3f6c"]}
const LONG_RALLY := 8   # shots in a rally that get a WOW
# Close calls go up on the billboard as a close-up of the ball's mark against
# the line: outs that missed by up to CLOSE_OUT (m), ins that kept no more
# than CLOSE_IN of the ball on the line. They stay up over the point's word.
const CLOSE_OUT := 0.3
const CLOSE_IN := 0.05
# A lob: an upward swipe at least LOB_LEN screens long, averaging under LOB_SPEED screens a second.
const LOB_LEN := 0.22
const LOB_SPEED := 1.4

var settings := Settings.new()
var arena: Arena
var actors: Actors
var cam: CameraRig
var hud: Hud
var game: TennisGame = null
var me := 0
var paused := false
var touch = null            # {index, pts: [[pos, ms]]}
var rally_shots := 0
var line_call_shown := false
# frame-rate watch: benchmark in the menu, then step down on auto when slow
var bench := {"t": 0.0, "frames": 0, "gpu": 0.0, "cpu": 0.0, "done": false}
var watch := {"t": 0.0, "frames": 0}
var orbit := 0.0
# Screenshot runs for checking the look: -- --shot=out.png [--at=6] [--preset=high] [--demo] [--menu]
var shot_args := {}
var shot_clock := 0.0


func _ready() -> void:
	Engine.max_fps = 60
	settings.load_file()
	cam = CameraRig.new()
	add_child(cam)
	cam.current = true
	hud = Hud.new()
	add_child(hud)
	hud.play_pressed.connect(start_match)
	hud.setting_changed.connect(_on_setting)
	hud.pause_toggled.connect(func(on: bool): paused = on)
	hud.view_toggled.connect(_toggle_view)
	hud.auto_toggled.connect(_toggle_auto)
	hud.menu_pressed.connect(show_menu)
	build_world()
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	get_viewport().size_changed.connect(func(): cam.fit(get_viewport().get_visible_rect().size))
	cam.fit(get_viewport().get_visible_rect().size)
	cam.set_view(settings.view)
	for a in OS.get_cmdline_user_args():
		var kv: PackedStringArray = a.trim_prefix("--").split("=")
		shot_args[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if shot_args.has("preset"):
		settings.graphics = shot_args.preset; settings.auto_pick = shot_args.preset
		build_world()
	if shot_args.has("view"):
		settings.view = shot_args.view
	show_menu()
	if shot_args.has("shot") and not shot_args.has("menu"):
		start_match()
		if shot_args.has("demo"):
			game.control = ["cpu", "cpu"]


func build_world() -> void:
	if arena: arena.queue_free()
	if actors: actors.queue_free()
	var p := settings.preset()
	Settings.apply_viewport(get_viewport(), p)
	arena = Arena.new()
	add_child(arena)
	arena.build(p)
	actors = Actors.new()
	add_child(actors)
	if game: actors.setup(game, p.trail)


func show_menu() -> void:
	game = null
	paused = false
	for c in actors.get_children(): c.queue_free()
	hud.show_menu(settings)


func start_match() -> void:
	settings.save()
	var opp := "philosopher" if settings.character == "octopus" else "octopus"
	var opts := Characters.level_opts(settings.level)
	opts.merge({"p0": settings.character, "p1": opp, "control": ["human", "cpu"], "autoMove": [settings.auto_move, false],
		"onEvent": _on_event, "firstServer": randi() % 2})
	game = TennisGame.new(opts)
	actors.setup(game, settings.preset().trail)
	cam.set_view(settings.view)
	hud.start_match(game, me, settings)
	watch = {"t": 0.0, "frames": 0}


func _process(dt: float) -> void:
	if shot_args.has("shot"):
		shot_clock += dt
		if shot_clock > float(shot_args.get("at", "6")):
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(shot_args.shot)
			print("saved ", shot_args.shot, " fps ", Engine.get_frames_per_second())
			get_tree().quit()
			return
	_watch_frames(dt)
	if game == null:
		# menu: a slow orbit over the court
		orbit += dt * 0.08
		cam.position = Arena.gv(sin(orbit) * 26.0, cos(orbit) * 26.0 - 2.0, 9.0)
		cam.look_at(Vector3(0, 0.5, 0), Vector3.UP)
		return
	if not paused:
		game.update(dt)
	actors.sync(dt)
	actors.sync_ball(me, true)
	cam.update_view(game, me, dt)
	hud.update(game, me, dt)


# ---------------------------------------------------------------- graphics
func _watch_frames(dt: float) -> void:
	var rid := get_viewport().get_viewport_rid()
	if not bench.done and settings.graphics == "auto" and settings.auto_pick == "":
		# first launch: measure the High preset for a few seconds in the menu
		bench.t += dt
		if bench.t > 1.0:
			bench.frames += 1
			bench.gpu += RenderingServer.viewport_get_measured_render_time_gpu(rid)
			bench.cpu += dt * 1000.0
		if bench.t > 4.0:
			bench.done = true
			var gpu: float = bench.gpu / maxf(1.0, bench.frames)
			var frame: float = bench.cpu / maxf(1.0, bench.frames)
			var pick := "high"
			if gpu > 0.0:
				pick = "ultra" if gpu < 7.0 else ("high" if gpu < 11.0 else ("medium" if gpu < 18.0 else "low"))
			if frame > 19.0:
				pick = Settings.ORDER[maxi(0, Settings.ORDER.find(pick) - 1)]
			print("benchmark: gpu %.1f ms, frame %.1f ms -> %s" % [gpu, frame, pick])
			settings.auto_pick = pick
			settings.save()
			if pick != "high":
				build_world()
			hud.refresh_settings(settings)
		return
	if game == null or paused or settings.graphics != "auto":
		return
	# during play on auto: three seconds averaging under 50 fps steps down a preset
	watch.t += dt
	watch.frames += 1
	if watch.t >= 3.0:
		var fps: float = watch.frames / watch.t
		watch = {"t": 0.0, "frames": 0}
		var i := Settings.ORDER.find(settings.preset_id())
		if fps < 50.0 and i > 0:
			settings.auto_pick = Settings.ORDER[i - 1]
			settings.save()
			var p := settings.preset()
			Settings.apply_viewport(get_viewport(), p)
			arena.apply_preset(p)
			hud.toast("Graphics set to %s for a smoother game" % p.name)


func _on_setting(key: String, value) -> void:
	settings.set(key, value)
	settings.save()
	if key == "graphics":
		build_world()
	if key == "view":
		cam.set_view(value)


func _toggle_view() -> void:
	settings.view = "first" if settings.view == "chase" else "chase"
	settings.save()
	cam.set_view(settings.view)


func _toggle_auto() -> void:
	settings.auto_move = not settings.auto_move
	settings.save()
	if game: game.set_auto_move(me, settings.auto_move)
	hud.refresh_settings(settings)


# ---------------------------------------------------------------- events
func _on_event(type: String, d: Dictionary) -> void:
	match type:
		"hit":
			hud.hint("")
			line_call_shown = false
			rally_shots = 1 if d.kind == "serve" else rally_shots + 1
			var kind: String = d.kind
			if rally_shots == LONG_RALLY or (d.perfect and d.side == me and (kind.to_lower().contains("power") or kind == "overhead")):
				arena.board.show_word("WOW", Neon.PINK, 1.8)
			if d.side == me:
				var wing: String = {"fh": "Forehand", "bh": "Backhand"}.get(d.wing, "")
				var label: String = {"serve": "Serve", "overhead": "Overhead", "volley": wing + " volley",
					"power": "Power " + wing.to_lower(), "powerVolley": "Power " + wing.to_lower() + " volley"}.get(d.kind, wing)
				var timing: String = "Perfect timing" if d.perfect else (d.note if d.note != "" and absi(d.errMs) < 15
					else ("Late " if d.errMs > 0 else "Early ") + str(absi(d.errMs)) + " ms" + (" · " + d.note if d.note != "" else ""))
				var parts := [label, timing, "%d km/h" % d.kmh, d.spin, d.curve].filter(func(x): return x != "")
				hud.show_shot(" · ".join(PackedStringArray(parts)))
		"lineCall":
			if d.m > CLOSE_OUT or d.m < -CLOSE_IN: return
			arena.board.show_call(d, me, 3.0)
			line_call_shown = true
		"whiff":
			if d.side == me: hud.show_shot(d.reason)
		"fault":
			hud.show_msg(d.text if d.text == "Net" or d.text == "Serve clock" else "Fault", "Second serve", "warn")
		"point":
			var names := [game.players[0].ch.name, game.players[1].ch.name]
			var sub: String = names[d.winner] + " wins the point"
			if d.result == "game": sub = names[d.winner] + " takes the game"
			if d.result == "set": sub = names[d.winner] + " wins the set"
			hud.show_msg(d.text, sub, "good" if d.winner == me else "bad")
			if BOARD_WORDS.has(d.text) and not line_call_shown:
				arena.board.show_word(BOARD_WORDS[d.text][0], Color(BOARD_WORDS[d.text][1]), 2.6)
		"serveReady":
			line_call_shown = false
			hud.hint("Tap to toss, then swipe as the ball peaks" if d.server == me else "")
		"toss":
			if d.side == me: hud.hint("Swipe at the top of the toss")
		"matchOver":
			hud.show_end(game, me)


# ---------------------------------------------------------------- input
func _unhandled_input(e: InputEvent) -> void:
	if OS.is_debug_build() and shot_args.has("trace"): print("input ", e)
	if game == null or paused:
		return
	var now := Time.get_ticks_msec()
	if e is InputEventScreenTouch:
		if e.pressed and touch == null:
			touch = {"index": e.index, "pts": [[e.position, now]]}
		elif not e.pressed and touch != null and e.index == touch.index:
			touch.pts.append([e.position, now])
			var pts: Array = touch.pts
			touch = null
			var a: Vector2 = pts[0][0]; var b: Vector2 = pts[-1][0]
			var dx := b.x - a.x; var dy := b.y - a.y
			var chord := sqrt(dx * dx + dy * dy)
			var dur := maxf(1.0, pts[-1][1] - pts[0][1])
			if chord < 24.0 and dur < 400.0:
				handle_tap(b); return
			if chord < 30.0:
				return
			handle_swipe(pts, dx, dy, chord, dur)
	elif e is InputEventScreenDrag and touch != null and e.index == touch.index:
		touch.pts.append([e.position, now])


func handle_tap(pos: Vector2) -> void:
	if game.phase == "preServe" and game.server == me:
		game.request_toss(me)
		return
	var w = cam.unproject_ground(pos)
	if w == null:
		return
	game.request_move(me, w.x, w.y)


# Where on the far court a swipe points: follow its direction on screen from
# the ball's shadow to the back of the court (pointAt in js/main.js).
func point_at(aim: float):
	var b := game.ball
	var fwd := game.players[me].fwd
	if not b.active:
		return null
	var P = cam.project_game(b.px, b.py, 0.0)
	if P == null:
		return null
	var g0 = cam.unproject_ground(P)
	var g1 = cam.unproject_ground(P + Vector2(40.0 * sin(aim), -40.0 * cos(aim)))
	if g0 == null or g1 == null or fwd * (g1.y - g0.y) < 0.05:
		return null
	var t: float = (fwd * (Phys.HL - 2.0) - g0.y) / (g1.y - g0.y)
	var x: float = g0.x + (g1.x - g0.x) * t
	return x if is_finite(x) else null


# A finger path to a shot: direction = aim, speed = pace vs spin, up =
# topspin, down = slice, a bowed path = sidespin (handleSwipe in js/main.js).
func handle_swipe(pts: Array, dx: float, dy: float, chord: float, dur: float) -> void:
	var end_pos: Vector2 = pts[-1][0]
	var end_t: float = pts[-1][1]
	var k := pts.size() - 1
	while k > 0 and end_t - pts[k][1] < 110:
		k -= 1
	var tail: float = end_pos.distance_to(pts[k][0]) / maxf(16.0, end_t - pts[k][1])
	var v := maxf(tail, chord / dur) * 1000.0
	var size := get_viewport().get_visible_rect().size
	var dim := minf(size.x, size.y)
	var u := v / dim
	var pace := clampf((u - 0.7) / (3.8 - 0.7), 0.0, 1.0)
	var depth := clampf((chord / dim - 0.1) / 0.3, 0.0, 1.0)
	var over := clampf((u - 7.0) / 4.0, 0.0, 1.0)
	var spin_dir := 1 if dy < 0 else -1
	var lob := spin_dir > 0 and (chord / dur) * 1000.0 / dim < LOB_SPEED and chord / dim >= LOB_LEN
	var aim := atan2(dx, absf(dy))
	var nx := -dy / chord
	var ny := dx / chord
	if nx < 0:
		nx = -nx; ny = -ny
	var bulge := 0.0
	var p0: Vector2 = pts[0][0]
	for p in pts:
		var q: Vector2 = p[0]
		var d := ((q.x - p0.x) * nx + (q.y - p0.y) * ny) / chord
		if absf(d) > absf(bulge): bulge = d
	if absf(bulge) < 0.04: bulge = 0.0
	var curve := -clampf(bulge * 5.0, -1.0, 1.0)
	aim += clampf(bulge * 0.45, -0.12, 0.12)
	if spin_dir < 0: aim = -aim
	var input := {"aim": aim, "pace": pace, "over": over, "spinDir": spin_dir, "curve": curve, "depth": depth, "lob": lob}
	var lx = point_at(aim)
	if lx != null: input.landX = lx
	if lob:
		input.lead = dur / 2000.0; input.depth = 1.0
	game.request_swipe(me, input)
