# Replays the seeded sets in tests/traces (written by js_trace.js from the JS
# engine) with the GDScript engine and checks every event matches.
# godot --headless --path godot -s tests/parity.gd
extends SceneTree

const TOL := 1e-7

var g: TennisGame


func _init() -> void:
	var failed := 0
	var dir := DirAccess.open("res://tests/traces")
	var names := dir.get_files()
	names.sort()
	for f in names:
		if f.ends_with(".json"):
			failed += 0 if run_case("res://tests/traces/" + f) else 1
	print("parity: %d failed (%s flight)" % [failed, "C++" if Phys.native != null else "GDScript"])
	quit(1 if failed else 0)


func run_case(path: String) -> bool:
	var want: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(path))
	var events: Array = []
	var on_event := func(t: String, d: Dictionary) -> void:
		if g == null: return   # (the first serveReady, from inside the constructor)
		var b := g.ball
		if t == "hit": events.append(["hit", g.time, d.side, d.kind, d.wing, b.px, b.py, b.pz, b.vx, b.vy, b.vz, b.spin, b.side])
		elif t == "bounce": events.append(["bounce", g.time, d.x, d.y])
		elif t == "point": events.append(["point", g.time, d.winner, d.text, d.result])
		elif t == "fault": events.append(["fault", g.time, d.text])
		elif t == "whiff": events.append(["whiff", g.time, d.side, d.reason])
	var bot_side: bool = want.ctl == "bot"
	var opts := Characters.level_opts(want.level)
	opts.merge({"p0": want.p0, "p1": want.p1, "control": ["human" if bot_side else "cpu", "cpu"],
		"autoMove": [bot_side, false], "onEvent": on_event, "rng": SeededRng.new(int(want.seed))})
	var t0 := Time.get_ticks_msec()
	g = null
	g = TennisGame.new(opts)
	var bot := Bot.new(g, 0, 0.5) if bot_side else null
	var wall := 0.0
	var worst := 0
	while g.phase != "matchOver" and wall < 3600.0:
		if bot: bot.tick()
		var u0 := Time.get_ticks_usec()
		g.update(1.0 / 60.0)
		worst = maxi(worst, Time.get_ticks_usec() - u0)
		wall += 1.0 / 60.0
	var ms := Time.get_ticks_msec() - t0
	var exp: Array = want.events
	var n := mini(exp.size(), events.size())
	for i in n:
		var bad := diff(exp[i], events[i])
		if bad != "":
			print("%s: FAIL at event %d of %d: %s\n  js:  %s\n  gd:  %s" % [want.name, i, exp.size(), bad, exp[i], events[i]])
			return false
	if exp.size() != events.size() or g.match_score.games != want.games.map(func(v): return int(v)):
		print("%s: FAIL event count %d vs %d, games %s vs %s" % [want.name, exp.size(), events.size(), want.games, g.match_score.games])
		return false
	print("%s: ok, %d events, %s, %d ms (slowest frame %.1f ms)" % [want.name, events.size(), g.match_score.games, ms, worst / 1000.0])
	return true


func diff(a: Array, b: Array) -> String:
	if a.size() != b.size():
		return "length"
	for k in a.size():
		var x = a[k]
		var y = b[k]
		if x is float or y is float:
			if absf(float(x) - float(y)) > TOL * maxf(1.0, absf(float(x))):
				return "field %d: %.17g vs %.17g" % [k, float(x), float(y)]
		elif str(x) != str(y):
			return "field %d" % k
	return ""


# The scripted player from tests/engine.js (makeBot): swipes like a person,
# with seeded timing errors, and moves with automove.
class Bot:
	var g: TennisGame
	var side: int
	var skill: float
	var p: TennisPlayer
	var opp: TennisPlayer
	var plan = null
	var last_hit := -2.0

	func _init(g_: TennisGame, side_: int, skill_: float) -> void:
		g = g_; side = side_; skill = skill_
		p = g.players[side]; opp = g.players[1 - side]

	func rnd() -> float:
		return g.rng.next()

	func gauss() -> float:
		var u := 0.0
		for i in 6: u += rnd()
		return (u - 3.0) / sqrt(0.5)

	func tick() -> void:
		if g.phase == "preServe" and g.server == side and g.phase_wall > 0.8:
			g.request_toss(side); plan = null; return
		if g.phase == "toss" and g.server == side:
			if g.peak_t == null: return
			if plan == null: plan = {"e": absf(gauss()) * skill * 0.5 * p.ch.window.fh}
			if (g.time - g.peak_t) / g.time_scale >= plan.e:
				g.request_swipe(side, {"aim": (rnd() - 0.5) * 0.6, "pace": 0.6 + rnd() * 0.3, "spinDir": 1, "curve": 0.0})
				plan = null
			return
		if g.phase != "rally" or g.last_hit_t == last_hit: return
		var info = g.incoming_info(side)
		if plan == null:
			if info == null: return
			var wing := "fh" if (info.x - p.x) * p.fwd >= 0.0 else "bh"
			var away := -1.0 if opp.x > 0.0 else 1.0
			var edge := Phys.SW - 0.45
			var land_x := away * edge * (0.6 + 0.4 * rnd()) if rnd() < 0.6 else (rnd() - 0.5) * edge
			var e: float = gauss() * skill * p.ch.window[wing]
			var pace := 0.55 + rnd() * 0.4
			var spin_dir := 1 if rnd() < 0.85 else -1
			var depth := 0.85 + rnd() * 0.15
			plan = {"hitT": g.last_hit_t, "e": e,
				"input": {"aim": 0.0, "landX": land_x, "pace": pace, "spinDir": spin_dir, "curve": 0.0, "depth": depth}}
		if plan.hitT != g.last_hit_t:
			plan = null; return
		var crossed: bool = p.cross != null and p.cross.t >= g.last_hit_t
		var fire: bool
		if plan.e < 0.0:
			fire = crossed or (info != null and info.t / g.time_scale <= -plan.e)
		else:
			fire = crossed and (g.time - p.cross.t) / g.time_scale >= plan.e
		if fire:
			g.request_swipe(side, plan.input); last_hit = g.last_hit_t; plan = null
