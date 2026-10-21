# Drives the real app with touch events (in viewport coordinates): tap to toss, swipe at the peak,
# tap to move. godot --headless --path godot -s tests/input_smoke.gd
extends SceneTree

var main: Node
var step := 0
var t := 0.0
var log := []


func _init() -> void:
	main = load("res://game/main.tscn").instantiate()
	root.add_child(main)


func touch(pos: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = 0; e.position = pos; e.pressed = pressed
	main._unhandled_input(e)


func drag(pos: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = 0; e.position = pos
	main._unhandled_input(e)


func _process(dt: float) -> bool:
	t += dt

	match step:
		0:
			if t > 0.5:
				main.settings.level = "chill"
				main.start_match()
				main.game.on_event = func(ty, d): log.append(ty); main._on_event(ty, d)
				# make side 0 serve first
				main.game.match_score.server = 0
				main.game.start_point(true)
				step = 1; t = 0.0
		1:
			if t > 0.3:
				touch(Vector2(360, 900), true); touch(Vector2(361, 901), false)
				step = 2; t = 0.0
		2:
			if main.game.peak_t != null:
				touch(Vector2(360, 1000), true)
				drag(Vector2(370, 900))
				drag(Vector2(380, 700))
				touch(Vector2(385, 600), false)
				step = 3; t = 0.0
		3:
			if t > 0.4:
				var w = main.cam.unproject_ground(Vector2(200, 1000))
				print("ground under tap: ", w)
				touch(Vector2(200, 1000), true); touch(Vector2(200, 1000), false)
				step = 4; t = 0.0
		4:
			if t > 0.2:
				var p: TennisPlayer = main.game.players[0]
				print("events: ", log)
				print("target after tap: ", p.tx, ", ", p.ty)
				var ok: bool = log.has("toss") and (log.has("hit") or log.has("whiff"))
				print("input smoke: ", "ok" if ok else "FAIL")
				quit(0 if ok else 1)
	return false
