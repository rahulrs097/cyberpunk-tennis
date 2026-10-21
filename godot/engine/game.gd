# The match engine: players, serving, hitting, line calls and the CPU.
# A port of js/game.js, kept line for line so the two engines give the same
# match from the same seed (tests/parity). Side 0 plays from y < 0, side 1
# from y > 0. Inputs come in through request_move / request_toss /
# request_swipe; the CPU uses the same shot pipeline. The only randomness is
# in the CPU (cpu_choose_shot, cpu_choose_serve, cpu_hit), drawn from `rng`.
# The online-only parts of js/game.js (guest prediction, snapshots, the drawn
# ball) come with multiplayer.
class_name TennisGame
extends RefCounted


const POWER_Z := 1.3          # balls above this can be hit as power shots
const CONTACT_AHEAD := 0.35   # ideal contact point in front of the body
const OUTER := 2.5            # a swipe more than this many windows off whiffs
const REACT := 0.24           # split-step: seconds before an auto-moving player can react
const ACCEL := 8.0            # m/s² from a standstill to top speed
const AIM_FULL := 0.6         # a swipe this many radians off straight aims at the sideline
const NET_ZONE := 7.5
const LOB_LEAD := 0.18
const LOB_EASE := 1.5
const CPU_EARLY := 0.45       # share of the CPU's mistimed shots that are early rather than late
const CHASE_OUT := 1.0        # auto-moving players still run at a ball landing this far out
const STAMINA_POINT := 0.3
const STAMINA_CHANGEOVER := 0.6
const STAMINA_STILL := 0.4
const STAMINA_SWING := 0.4


class Shot:
	var px := 0.0
	var py := 0.0
	var pz := 0.0
	var vx := 0.0
	var vy := 0.0
	var vz := 0.0
	var spin := 0.0
	var side := 0.0
	var kind := "ground"
	var wing := "fh"
	var err := 0.0
	var e := 0.0
	var power_f := 1.0
	var lob := false
	var note := ""


var time_scale := 0.62
var time := 0.0
var wall := 0.0
var acc := 0.0
var players: Array[TennisPlayer] = []
var control := ["human", "cpu"]
var auto_move := [false, false]
var ball := Ball.new()
var match_score: MatchScore
var phase := "preServe"
var phase_wall := 0.0
var peak_t = null
var peak_ball: Ball = null
var box_side := 1
var box_sign := 1.0
var server := 0
var last_hit_t := -1.0
var marks: Array = []
var on_event: Callable
var last_shot = null      # Dictionary or null
var pred_land_x := 0.0
var pred_land_y := 0.0
var serve_clock = null
var serve_wait := 0.0
var cpu_err := 1.0
var cpu_react := REACT
var cpu_cover := 0.15
var cpu_speed := 1.0
var cpu_pace := 1.0
var cpu_depth := 1.0
var cpu_attack := 0.0
var cpu_smart := 0.0
var scout: Array = []
var drill = null          # Dictionary or null
var last_games := -1
var held = null
var rng: SeededRng


func _init(opts: Dictionary) -> void:
	time_scale = opts.get("timeScale", 0.62)
	players = [TennisPlayer.new(0, Characters.ALL[opts.p0]), TennisPlayer.new(1, Characters.ALL[opts.p1])]
	control = opts.get("control", ["human", "cpu"])
	auto_move = opts.get("autoMove", [false, false])
	match_score = MatchScore.new(opts.get("firstServer", 0))
	on_event = opts.get("onEvent", func(_t, _d): pass)
	serve_clock = opts.get("serveClock", null)
	cpu_err = _or(opts, "cpuErr", 1.0)
	cpu_react = _or(opts, "cpuReact", REACT)
	cpu_cover = _or(opts, "cpuCover", 0.15)
	cpu_speed = _or(opts, "cpuSpeed", 1.0)
	cpu_pace = _or(opts, "cpuPace", 1.0)
	cpu_depth = _or(opts, "cpuDepth", 1.0)
	cpu_attack = _or(opts, "cpuAttack", 0.0)
	cpu_smart = _or(opts, "cpuSmart", 0.0)
	rng = opts.get("rng", SeededRng.new(int(Time.get_ticks_usec()) & 0x7FFFFFFF))
	for i in 2:
		scout.append({"fh": {"n": 0, "err": 0}, "bh": {"n": 0, "err": 0}, "points": 0, "net": 0})
	drill = opts.get("drill", null)
	for i in 2:
		if control[i] == "cpu":
			players[i].speed_f = cpu_speed
	start_point(true)


# JS `opts.x || d`: a missing or zero value takes the default
static func _or(o: Dictionary, k: String, d: float) -> float:
	var v = o.get(k, null)
	return d if v == null or v == 0 else float(v)


func rand(a: float, b: float) -> float:
	return a + rng.next() * (b - a)


# Seconds to run `dist` metres from a standstill at top speed `sp`.
static func run_time(dist: float, sp: float) -> float:
	var dA := (sp * sp) / (2.0 * ACCEL)
	return sqrt((2.0 * dist) / ACCEL) if dist < dA else (dist - dA) / sp + sp / ACCEL


# running back towards your own baseline is slower than running forwards
static func back_f(uy: float, fwd: float) -> float:
	return 1.0 - 0.35 * maxf(0.0, -uy * fwd)


static func fwd_of(side: int) -> float:
	return 1.0 if side == 0 else -1.0


func auto_moves(side: int) -> bool:
	return control[side] == "cpu" or bool(auto_move[side])


func emit(type: String, data: Dictionary = {}) -> void:
	on_event.call(type, data)


static func stamina_f(p: TennisPlayer) -> float:
	return p.stamina / 100.0


static func move_speed(p: TennisPlayer) -> float:
	return p.ch.speed * p.speed_f * (0.55 + 0.45 * stamina_f(p))


# ---------------- point setup ----------------
func start_point(fresh: bool, keep_clock := false) -> void:
	var m := match_score
	var srv := m.current_server()
	var recv := 1 - srv
	var deuce := m.deuce_side()
	if drill != null:
		start_rep(); return
	var S := players[srv]
	var Rp := players[recv]
	var rs := 1.0 if deuce else -1.0
	S.x = S.fwd * rs * 0.7; S.y = -S.fwd * (Phys.HL + 0.3)
	var bsign := Rp.fwd if deuce else -Rp.fwd
	Rp.x = bsign * 2.5; Rp.y = -Rp.fwd * Rp.ch.returnDepth
	var games_played: int = m.games[0] + m.games[1]
	var changeover := games_played != last_games and games_played % 2 == 1
	last_games = games_played
	for p in players:
		p.tx = p.x; p.ty = p.y; p.swing = -1.0; p.pending = null; p.plan = null
		p.cross = null; p.prev_rel = null; p.streak = 0; p.v = 0.0; p.at_net = false; p.net_spot = null
		p.pattern = null; p.shot_n = 0; p.last_tx = 0.0; p.seen_at_net = false
		if not fresh:
			p.stamina = minf(p.cap, p.stamina + (p.cap - p.stamina) * (STAMINA_CHANGEOVER if changeover else STAMINA_POINT))
	box_side = recv; box_sign = bsign
	server = srv
	ball = Ball.new()
	phase = "preServe"
	phase_wall = 0.0
	peak_t = null
	peak_ball = null
	held = null
	if not keep_clock:
		serve_wait = 0.0
	emit("serveReady", {"server": srv, "first": m.first_serve})


# A tutorial rep: the player serves, or waits on the baseline for a feed.
func start_rep() -> void:
	var m := match_score
	var Pl := players[0]
	var F := players[1]
	m.server = 0; m.first_serve = true
	for p in players:
		p.swing = -1.0; p.pending = null; p.plan = null; p.cross = null; p.prev_rel = null
		p.streak = 0; p.v = 0.0; p.at_net = false; p.net_spot = null; p.stamina = 100.0; p.cap = 100.0
	F.x = 0.0; F.y = 11.0; F.tx = F.x; F.ty = F.y
	server = 0 if drill.get("serve", false) else 1
	ball = Ball.new()
	peak_t = null; peak_ball = null; held = null; serve_wait = 0.0
	phase_wall = 0.0
	if drill.get("serve", false):
		var deuce: bool = int(drill.get("reps", 0)) % 2 == 0
		Pl.x = (1.0 if deuce else -1.0) * 0.7; Pl.y = -(Phys.HL + 0.3)
		box_side = 1; box_sign = -1.0 if deuce else 1.0
		phase = "preServe"
	else:
		var feed = drill.get("feed", null)
		var net: bool = feed == "volley" or feed == "smash"
		Pl.x = 0.0; Pl.y = -3.6 if net else -Pl.ch.home
		Pl.at_net = net
		phase = "feed"
	Pl.tx = Pl.x; Pl.ty = Pl.y
	emit("serveReady", {"server": server, "first": true})


# The ball machine feeds an easy ball to the player's wing side.
func feed_ball() -> void:
	var Pl := players[0]
	var F := players[1]
	var wing: String = drill.get("wing", "fh")
	var feed = drill.get("feed", null)
	var b := Ball.new()
	b.px = F.x; b.py = F.y - 0.5; b.pz = 1.0
	b.active = true; b.in_flight = true; b.bounces = 1
	ball = b
	phase = "rally"
	var land_x := JsMath.clamp(Pl.x + (1.0 if wing == "fh" else -1.0) * 0.9, -3.0, 3.0)
	var input: Dictionary
	if feed == "volley":
		input = {"aim": 0.0, "landX": land_x, "pace": 0.2, "spinDir": 1, "curve": 0.0, "depth": 0.45, "clear": 0.6}
	elif feed == "smash":
		input = {"aim": 0.0, "landX": Pl.x, "pace": 0.0, "spinDir": 1, "curve": 0.0, "depth": 0.32, "lob": true}
	else:
		input = {"aim": 0.0, "landX": land_x, "pace": 0.2, "spinDir": 1, "curve": 0.0, "depth": 0.75, "clear": 0.6}
	apply_shot(F, compute_shot(F, input, 0.0))


func drill_end(ok, text: String, has_at := false, ax := 0.0, ay := 0.0) -> void:
	if phase == "pointOver":
		return
	drill.reps = int(drill.get("reps", 0)) + 1
	held = null
	phase = "pointOver"
	phase_wall = 0.0
	for p in players:
		p.pending = null
	var shot = last_shot if last_shot != null and last_shot.side == 0 else null
	emit("drill", {"ok": ok, "text": text, "x": ax if has_at else null, "y": ay if has_at else null, "shot": shot})


func request_toss(side: int) -> bool:
	if phase != "preServe" or server != side:
		return false
	var S := players[side]
	var b := ball
	b.px = S.x + S.fwd * 0.25; b.py = S.y + S.fwd * 0.35; b.pz = 1.5
	b.vx = 0.0; b.vy = 0.0; b.vz = 5.3
	b.spin = 0.0; b.side = 0.0
	b.active = true; b.in_flight = false; b.bounces = 0; b.last_hitter = -1
	phase = "toss"
	phase_wall = 0.0
	peak_t = null
	peak_ball = null
	emit("toss", {"side": side})
	return true


func request_move(side: int, x: float, y: float) -> void:
	var p := players[side]
	if phase == "matchOver":
		return
	if (phase == "preServe" or phase == "toss") and server == side:
		return
	p.tx = JsMath.clamp(x, -7.5, 7.5)
	var f := JsMath.clamp(p.fwd * y, -15.6, -0.7)
	p.ty = p.fwd * f
	# Asking for a spot near the net means coming in.
	p.net_spot = [p.tx, p.ty] if -f < NET_ZONE else null
	if p.net_spot != null:
		p.at_net = true


# ---------------- hitting ----------------
static func window_for(p: TennisPlayer, wing: String) -> float:
	return p.ch.window[wing] * (0.55 + 0.45 * stamina_f(p))


static func swing_lead(input: Dictionary) -> float:
	var lead = input.get("lead", null)
	return JsMath.clamp(lead, 0.0, LOB_LEAD) if input.get("lob", false) and lead != null and is_finite(lead) else 0.0


static func outer_window(p: TennisPlayer, input: Dictionary) -> float:
	return OUTER * maxf(window_for(p, "fh"), window_for(p, "bh")) * (LOB_EASE if input.get("lob", false) else 1.0)


func can_reach(p: TennisPlayer) -> bool:
	var b := ball
	return absf(b.px - p.x) <= p.ch.reach and b.pz <= p.ch.maxZ and absf(p.fwd * (b.py - p.y)) <= 2.8


func incoming_to(p: TennisPlayer) -> bool:
	var b := ball
	return phase == "rally" and b.active and b.in_flight and not b.netted and \
		b.last_hitter != p.side and not (b.is_serve and b.bounces == 0)


# Seconds of game time until the ball crosses p's contact plane, or null.
func predict_cross(p: TennisPlayer, max_t: float) -> TennisPlayer.Cross:
	var b := ball.copy()
	var plane := p.fwd * p.y + CONTACT_AHEAD
	var prev := p.fwd * b.py - plane
	var t := 0.0
	var bounces := b.bounces
	while t < max_t:
		var ev := Phys.step_ball(b, Phys.DT)
		t += Phys.DT
		if ev == Phys.EV_NET:
			return null
		if ev == Phys.EV_BOUNCE:
			bounces += 1
			if bounces >= 2:
				return null
		var rel := p.fwd * b.py - plane
		if prev > 0.0 and rel <= 0.0:
			if ball.is_serve and bounces == 0:
				return null
			var c := TennisPlayer.Cross.new()
			c.t = t; c.x = b.px; c.y = b.py; c.z = b.pz
			c.has_px = false; c.bounced = bounces > 0
			return c
		prev = rel
	return null


# Build launch parameters for p hitting the ball where it is now.
# input: {aim, pace, over, spinDir, curve, depth, landX, lob, lead, clear, run}
func compute_shot(p: TennisPlayer, input: Dictionary, err: float) -> Shot:
	var ch := p.ch
	var b := ball
	var f := stamina_f(p)
	var fwd := p.fwd
	var px := b.px; var py := b.py; var pz := maxf(b.pz, 0.08)
	var is_serve := phase == "toss"
	var local_x := (px - p.x) * fwd
	var wing := "fh" if is_serve else ("fh" if local_x >= -0.05 else "bh")
	var kind: String
	if is_serve: kind = "serve"
	elif pz >= ch.overheadZ: kind = "overhead"
	elif b.bounces == 0: kind = "powerVolley" if pz >= POWER_Z else "volley"
	elif pz >= POWER_Z: kind = "power"
	else: kind = "ground"

	var in_lob: bool = input.get("lob", false)
	var is_lob := in_lob and kind != "serve" and kind != "overhead"
	var W := window_for(p, wing) * (LOB_EASE if is_lob else 1.0)
	var balance := 0.0
	var note := ""
	if not is_serve:
		var d := absf(local_x)
		var far: float = ch.reach * 0.6
		if kind != "overhead" and d < 0.3:
			balance += ((0.3 - d) / 0.3) * 0.6; note = "Jammed"
		if d > far:
			balance += ((d - far) / (ch.reach - far)) * 0.8; note = "Stretched"
		var in_run = input.get("run", null)
		var run: float = in_run if in_run != null and is_finite(in_run) else (p.v / ch.speed if p.moving else 0.0)
		if run > 0.3:
			balance += ((run - 0.3) / 0.7) * 0.7
			if note == "": note = "On the run"
	var e0 := err / W
	var e := JsMath.clamp(e0 + (-balance if e0 < 0.0 else balance), -OUTER, OUTER)
	var drift := e * 0.085 * (1.0 if wing == "fh" else -1.0)
	var power_f := maxf(0.7, 1.0 - 0.1 * pow(absf(e), 1.5))
	var pace := JsMath.clamp(input.pace, 0.0, 1.0)
	var over := JsMath.clamp(input.get("over", 0.0), 0.0, 1.0)
	var cap_f := 0.68 + 0.32 * f
	var speed: float
	var spin: float
	var margin: float
	var min_clear: float = _or(input, "clear", 0.12)
	var depth_line := Phys.HL
	var side := JsMath.clamp(_or(input, "curve", 0.0), -1.0, 1.0)
	var spin_dir: float = input.get("spinDir", 1)

	if kind == "serve":
		speed = JsMath.lerp(30.0, ch.serve, pace) * cap_f
		spin = JsMath.lerp(0.9, 0.15, pace) if spin_dir > 0 else -JsMath.lerp(0.5, 0.1, pace)
		margin = 0.45 + (1.0 - pace) * 1.3 - over * 1.6
		depth_line = Phys.SL
		min_clear = 0.06
	elif kind == "overhead":
		speed = ch.pace.fh * 1.25 * (0.85 + 0.15 * pace)
		spin = 0.12
		margin = 2.2 - over * 2.0
		side *= 0.3
	else:
		speed = JsMath.lerp(ch.paceMin, ch.pace[wing], pace) * cap_f
		var sm: float = ch.spin[wing]
		spin = JsMath.lerp(sm, sm * 0.12, pace)
		if spin_dir < 0:
			spin = -JsMath.lerp(0.55, 0.3, pace); speed *= 0.9
		margin = 1.8 + 2.4 * (1.0 - pace) if spin_dir < 0 else 0.7 + 2.8 * (1.0 - pace)
		margin -= over * 2.5
		if kind == "power":
			speed *= 1.22; spin *= 0.5 if spin > 0.0 else 0.8; margin *= 0.7
		if kind == "volley":
			speed *= 0.72; spin *= 0.3
		if kind == "powerVolley":
			speed *= 1.1; spin *= 0.3; margin *= 0.7
		if in_lob:
			speed = JsMath.lerp(18.0, 20.0, pace) * cap_f; spin = 1.3; margin = 1.5; side = 0.0

	# launch at angle `ang` to land `along` metres down the court
	var solve := func(ang: float, spd: float, along: float, clear: float) -> Phys.Launch:
		return Phys.solve_launch(px, py, pz, fwd * sin(ang), fwd * cos(ang), spd, spin, side, maxf(1.5, along) / cos(ang), clear)
	var lob_up := JsMath.lerp(13.0, 15.0, JsMath.clamp(input.pace, 0.0, 1.0))
	var solve_lob := func(ang: float, along: float, up: float) -> Phys.Launch:
		var dx := fwd * sin(ang)
		var dy := fwd * cos(ang)
		var dist := maxf(1.5, along) / cos(ang)
		var s := Phys.find_root(func(v: float) -> Array:
			var r := Phys.flight(px, py, pz, dx * v, dy * v, up, spin, side)
			return [(r.land_x - px) * dx + (r.land_y - py) * dy - dist, r], 2.0, 25.0, 0.01, true)
		var l := Phys.Launch.new()
		l.vx = dx * s.x; l.vy = dy * s.x; l.vz = up; l.landing = s.r
		return l
	var target := depth_line - margin
	var sol: Phys.Launch
	if kind == "serve":
		var Tx := box_sign * Phys.SW * 0.5
		var Ty := fwd * (Phys.SL - 1.6)
		var a0 := atan2(fwd * (Tx - px), fwd * (Ty - py))
		var a := a0 + JsMath.clamp(input.get("aim", 0.0), -0.8, 0.8) * 0.45 + drift
		sol = solve.call(a, speed * power_f, target - fwd * py - (1.0 - power_f) * 9.0, min_clear - (1.0 - power_f) * 0.7)
	else:
		var depth_in = input.get("depth", null)
		var depth := 1.0 if depth_in == null else JsMath.clamp(depth_in, 0.0, 1.0)
		target = JsMath.lerp(3.2, target, depth)
		speed *= JsMath.lerp(0.5, 1.0, depth)
		var edge := Phys.SW - 0.45
		var lx = input.get("landX", null)
		var land_x: float = JsMath.clamp(lx, -edge, edge) if lx != null and is_finite(lx) \
			else fwd * edge * JsMath.clamp(input.get("aim", 0.0) / AIM_FULL, -1.0, 1.0)
		var along := target - fwd * py
		var aim_x := land_x
		var spd := speed
		var a := 0.0
		for i in 12:
			a = atan2(fwd * (aim_x - px), along)
			sol = solve_lob.call(a, along, lob_up) if is_lob else solve.call(a, spd, along, min_clear)
			var lnd := sol.landing
			var again := false
			if absf(lnd.land_x - land_x) > 0.25:
				aim_x -= lnd.land_x - land_x; again = true
			if target <= depth_line - 0.3 and fwd * lnd.land_y > depth_line - 0.25:
				spd *= 0.85; again = true
			if not again:
				break
		if absf(drift) > 0.002 or power_f < 0.999:
			if is_lob:
				sol = solve_lob.call(a + drift, along - (1.0 - power_f) * 9.0, lob_up * power_f)
				return _shot(px, py, pz, sol, spin, side, kind, wing, err, e, power_f, true, note)
			sol = solve.call(a + drift, spd * power_f, along - (1.0 - power_f) * 9.0, min_clear - (1.0 - power_f) * 0.7)
			# (a soft ball, like a scoop off a drop shot, dips by less)
			sol.vz -= (1.0 - power_f) * 2.0 * minf(1.0, spd / 25.0)
	return _shot(px, py, pz, sol, spin, side, kind, wing, err, e, power_f, is_lob, note)


static func _shot(px: float, py: float, pz: float, sol: Phys.Launch, spin: float, side: float, kind: String,
		wing: String, err: float, e: float, power_f: float, lob: bool, note: String) -> Shot:
	var s := Shot.new()
	s.px = px; s.py = py; s.pz = pz
	s.vx = sol.vx; s.vy = sol.vy; s.vz = sol.vz
	s.spin = spin; s.side = side; s.kind = kind; s.wing = wing
	s.err = err; s.e = e; s.power_f = power_f; s.lob = lob; s.note = note
	return s


func apply_shot(p: TennisPlayer, shot: Shot) -> void:
	var b := ball
	b.px = shot.px; b.py = shot.py; b.pz = shot.pz
	b.vx = shot.vx; b.vy = shot.vy; b.vz = shot.vz
	b.spin = shot.spin; b.side = shot.side
	b.active = true; b.in_flight = true; b.bounces = 0; b.netted = false
	b.last_hitter = p.side
	b.is_serve = shot.kind == "serve"
	held = null
	p.stamina = maxf(0.0, p.stamina - STAMINA_SWING)
	if shot.kind != "serve":
		scout[p.side][shot.wing].n += 1
		if -p.fwd * p.y < NET_ZONE:
			p.seen_at_net = true
	if shot.kind == "power" or shot.kind == "powerVolley":
		p.streak += 1; p.stamina = maxf(0.0, p.stamina - 3 * p.streak)
	elif shot.kind == "ground" or shot.kind == "volley":
		p.streak = 0
	p.swing = 0.0
	p.swing_wing = "oh" if shot.kind == "overhead" else ("serve" if shot.kind == "serve" else shot.wing)
	phase = "rally"
	last_hit_t = time
	for q in players:
		q.prev_rel = null; q.cross = null; q.pending = null
	var kmh := JsMath.js_round(JsMath.hypot3(b.vx, b.vy, b.vz) * 3.6)
	var spin_name := "Lob" if shot.lob else ("Topspin" if shot.spin > 0.35 else ("Slice" if shot.spin < 0.0 else "Flat"))
	var info := {
		"side": p.side, "kind": shot.kind, "wing": shot.wing, "kmh": kmh,
		"spin": spin_name,
		"curve": ("curls right" if shot.side * p.fwd > 0.0 else "curls left") if absf(shot.side) > 0.2 else "",
		"errMs": JsMath.js_round(shot.err * 1000.0),
		"perfect": absf(shot.e) < 0.35,
		"note": shot.note if absf(shot.e) >= 0.35 else "",
	}
	last_shot = info
	var fl := Phys.flight_of(b)
	pred_land_x = fl.land_x; pred_land_y = fl.land_y
	var other := players[1 - p.side]
	if auto_moves(other.side):
		other.react_until = time + (0.08 if b.is_serve else (cpu_react if control[other.side] == "cpu" else REACT))
		cpu_plan(other)
	if auto_moves(p.side):
		cpu_recover(p)
	emit("hit", info)


# A swing that misses still plays the stroke, on the side the ball is on.
func swing_miss(p: TennisPlayer, reason: String, at = null) -> void:
	var x: float = at.x if at != null else ball.px
	var z: float = at.z if at != null else ball.pz
	var px: float = at.px if at != null and at.has_px else p.x   # (a late swing: where they were as it passed)
	if p.swing < 0.0:
		p.swing = 0.0
		p.swing_wing = "oh" if z >= p.ch.overheadZ else ("fh" if (x - px) * p.fwd >= -0.05 else "bh")
	emit("whiff", {"side": p.side, "reason": reason})


func try_hit(p: TennisPlayer, input: Dictionary, err: float) -> bool:
	if not can_reach(p):
		swing_miss(p, "Out of reach"); return false
	var shot := compute_shot(p, input, err)
	apply_shot(p, shot)
	return true


# A swipe from a controller. `input` as in compute_shot. Timing is judged in
# game seconds.
func request_swipe(side: int, input: Dictionary) -> void:
	var p := players[side]
	var b := ball
	if phase == "toss" and server == side:
		var peak = peak_t
		if peak == null:
			peak = time + maxf(0.0, b.vz) / Phys.G
		var err: float = time - peak
		if absf(err) > OUTER * window_for(p, "fh"):
			emit("whiff", {"side": side, "reason": "Too early, wait for the top of the toss" if err < 0.0 else "Too late"})
			return
		apply_shot(p, compute_shot(p, input, err))
		return
	if not incoming_to(p):
		return
	var Wout := outer_window(p, input)
	var lead := swing_lead(input) * time_scale
	if p.cross != null and p.cross.t >= last_hit_t:
		var err := time - p.cross.t - lead
		if err <= Wout:
			try_hit(p, input, err); return
		swing_miss(p, "Too late", p.cross)
		return
	var c := predict_cross(p, 3.0)
	if c == null:
		emit("whiff", {"side": side, "reason": "Nothing to hit"}); return
	if c.t + lead > Wout:
		swing_miss(p, "Too early", c)
		return
	p.pending = {"t": time - lead, "input": input}


# ---------------- CPU ----------------
func cpu_recover(c: TennisPlayer) -> void:
	var opp := players[1 - c.side]
	c.plan = null
	if c.net_spot != null:
		c.at_net = true
		c.tx = c.net_spot[0]; c.ty = c.net_spot[1]
		return
	if -c.fwd * c.y < 7.5:
		c.at_net = true
		var bx := ball.px if ball.active else 0.0
		c.tx = JsMath.clamp(c.x * 0.4 + bx * 0.4, -3.0, 3.0)
		c.ty = -c.fwd * JsMath.clamp(-c.fwd * c.y, 2.6, 4.2)
		return
	c.at_net = false
	var cover := cpu_cover if control[c.side] == "cpu" else 0.15
	c.tx = JsMath.clamp(opp.x * cover, -2.2, 2.2)
	c.ty = -c.fwd * c.ch.home


func cpu_plan(c: TennisPlayer) -> void:
	var b := ball.copy()
	var ch := c.ch
	var fwd := c.fwd
	var Rr := fwd
	var speed := move_speed(c)
	var t := 0.0
	var bounces := b.bounces
	var cands: Array[TennisPlayer.Cand] = []
	var step := 0
	var let_go := false
	while t < 4.5:
		var ev := Phys.step_ball(b, Phys.DT)
		t += Phys.DT; step += 1
		if ev == Phys.EV_NET:
			cpu_recover(c); return
		if ev == Phys.EV_BOUNCE:
			if bounces == 0:
				var on_my_side := fwd * b.py < 0.0
				var good := Phys.in_service_box(b.px, b.py, box_side, box_sign) if ball.is_serve else Phys.in_singles(b.px, b.py)
				if not on_my_side or (not good and out_by(b.px, b.py, ball.is_serve) > CHASE_OUT):
					cpu_recover(c); c.leaving = true; return
				if not good:
					let_go = true
			bounces += 1
			if bounces >= 2:
				break
		if step % 3 != 0:
			continue
		if fwd * b.py >= 0.0 or fwd * b.vy >= 0.0:
			continue
		var bounced := bounces > 0
		if let_go and not bounced:
			continue
		var z := b.pz
		if bounced:
			if z < 0.25 or z > ch.maxZ:
				continue
		else:
			if ball.is_serve:
				continue
			if z < (0.3 if c.at_net else 0.45) or z > ch.maxZ:
				continue
			if fwd * b.py < -8.0 and z < ch.overheadZ:
				continue
			if z < Phys.net_height(b.px) + 0.1 and fwd * b.py > -2.0:
				continue
		for wing in ["fh", "bh"]:
			var ws := 1.0 if wing == "fh" else -1.0
			var px := b.px - ws * Rr * 0.75
			var py := b.py - fwd * CONTACT_AHEAD
			if fwd * py > -0.8 or fwd * py < -16.5:
				continue
			var dist := JsMath.hypot2(px - c.x, py - c.y)
			var slack := t - ((c.react_until - time) + run_time(dist, speed * back_f((py - c.y) / maxf(dist, 1e-6), fwd)) + 0.12)
			var q := -absf(z - 1.0) + (0.4 if bounced else 0.0)
			if c.at_net:
				q += -1.5 if bounced else 0.8
			if not bounced and z >= POWER_Z + 0.1 and z < ch.overheadZ:
				q += 0.6
			if z >= ch.overheadZ and not bounced:
				q += 2.2
			elif bounced and z >= POWER_Z + 0.1:
				q += 1.0 + 0.5 * (z - POWER_Z)
			q -= maxf(0.0, -fwd * py - ch.home) * 0.25
			q += ch.tactics.late * t + (ch.tactics.fhPref if wing == "fh" else 0.0)
			q -= dist * 0.05
			var k := TennisPlayer.Cand.new()
			k.t = t; k.x = px; k.y = py; k.z = z; k.slack = slack; k.q = q; k.wing = wing
			cands.append(k)
	c.leaving = let_go
	if cands.is_empty():
		cpu_recover(c); c.leaving = let_go; return
	var best: TennisPlayer.Cand = null
	for k in cands:
		if k.slack >= 0.15 and (best == null or k.q > best.q):
			best = k
	if best == null:
		for k in cands:
			if best == null or k.slack > best.slack:
				best = k
	c.plan = best
	c.tx = best.x; c.ty = best.y


# How far (m) a bounce at x, y lands outside the singles court, or outside
# the service box when `box` is set.
func out_by(x: float, y: float, box: bool) -> float:
	if box:
		var sx := box_sign * x
		return JsMath.hypot2(maxf(0.0, maxf(-sx, sx - Phys.SW)), maxf(0.0, absf(y) - Phys.SL))
	return JsMath.hypot2(maxf(0.0, absf(x) - Phys.SW), maxf(0.0, absf(y) - Phys.HL))


func weak_side_of(opp: TennisPlayer) -> float:
	var sc: Dictionary = scout[opp.side]
	var k := 4.0 + 30.0 * (1.0 - cpu_smart)
	var rate := func(w: String) -> float:
		var other := "bh" if w == "fh" else "fh"
		return (sc[w].err + k * (0.25 if opp.ch.window[w] < opp.ch.window[other] else 0.15)) / (sc[w].n + k)
	return (1.0 if rate.call("fh") > rate.call("bh") else -1.0) * opp.fwd


func score_mood(c: TennisPlayer) -> float:
	var m := match_score
	var s := c.side
	var o := 1 - s
	var mood := JsMath.clamp((m.games[o] - m.games[s]) * 0.25, -0.5, 0.5)
	if not m.tiebreak:
		if m.points[s] >= 3 and m.points[s] - m.points[o] >= 2: mood -= 0.4
		if m.points[o] >= 3 and m.points[o] - m.points[s] >= 2: mood += 0.4
	return JsMath.clamp(mood, -1.0, 1.0) * cpu_smart


func cpu_choose_shot(c: TennisPlayer) -> Dictionary:
	var opp := players[1 - c.side]
	var b := ball
	var fwd := c.fwd
	var T: Dictionary = c.ch.tactics
	var smart := cpu_smart
	var slack := c.plan.slack if c.plan != null else 0.0
	var edge := Phys.SW - 0.45
	var mood := score_mood(c)
	var pace: float = rand(T.pace[0], T.pace[1]) * cpu_pace * (1.0 + 0.05 * mood)
	if slack < 0.2: pace *= 0.75
	if b.pz < 0.5: pace *= 0.6
	var spin_dir := -1 if (b.pz < 0.42 or slack < 0.05) else (-1 if rng.next() < T.slice else 1)
	var weak_side := weak_side_of(opp)
	var away := -1.0 if opp.x > 0.0 else 1.0
	var opp_at_net := -opp.fwd * opp.y < NET_ZONE
	var opp_deep := -opp.fwd * opp.y > 12.5
	var from_net := -fwd * c.y
	var opp_tired := stamina_f(opp) < 0.4
	if c.pattern == null:
		if rng.next() < smart * 0.8:
			var pats: Array = T.patterns
			c.pattern = pats[int(floor(rng.next() * pats.size()))]
		else:
			c.pattern = ""
	var sc: Dictionary = scout[opp.side]
	var net_rate: float = float(sc.net) / sc.points if sc.points > 4 else 0.0
	var tx := 0.0
	var lob := false
	var depth := cpu_depth
	var touch := false
	if opp_at_net:
		if rng.next() < T.lob + smart * net_rate * 0.4:
			lob = true; tx = rand(-1.5, 1.5)
		else:
			tx = away * edge * rand(0.75, 1.0); pace = maxf(pace, 0.7)
	elif opp_deep and from_net < 11.5 and slack > 0.3 and b.pz > 0.6 and rng.next() < T.drop * (0.4 + smart):
		touch = true; depth = 0.12; pace = 0.15; spin_dir = -1; tx = away * rand(0.5, 2.0)
	elif absf(c.x) > 2.2 and slack > 0.25 and b.pz > 0.5 and rng.next() < T.angle * (0.4 + smart):
		touch = true; depth = 0.55; tx = -JsMath.sgn(c.x) * edge
	elif absf(opp.x) > (1.0 if opp_tired else 1.8) and rng.next() < T.openCourt + (0.3 if opp_tired else 0.0):
		tx = away * edge * rand(0.7, 1.0)
	elif c.pattern == "pressure":
		tx = (weak_side * rand(0.5, 0.75) if c.shot_n < 2 else away * rand(0.7, 0.9)) * edge
	elif c.pattern == "sideToSide":
		var s := JsMath.sgn(c.last_tx)
		tx = -(s if s != 0.0 else -weak_side) * edge * rand(0.55, 0.75)
	elif c.pattern == "behind" and opp.moving and absf(opp.dir_x) > 0.6:
		tx = -JsMath.sgn(opp.dir_x) * edge * rand(0.5, 0.75)
	elif rng.next() < T.weakWing + smart * 0.2:
		tx = weak_side * edge * rand(0.55, 0.9)
	elif absf(c.x) > 0.8 and rng.next() < T.cross:
		tx = -JsMath.sgn(c.x) * edge * rand(0.45, 0.9)
	else:
		tx = rand(-edge, edge) * 0.8
	var go_for := not lob and not touch and slack > 0.6 and b.pz > 0.8
	if go_for:
		pace = maxf(pace, T.pace[1] * cpu_pace); tx = away * edge * 0.85
	var attack: float = cpu_attack * T.attack * (1.5 if absf(opp.x) > 1.8 else 1.0) * (1.0 + 0.3 * mood)
	if not lob and not touch and not go_for and slack > 0.3 and b.pz > 0.6 and rng.next() < attack:
		go_for = true
		pace = maxf(pace, minf(1.0, T.pace[1] + 0.15))
		tx = away * edge * rand(0.75, 0.9)
	if not go_for and not touch:
		tx *= T.safe * (1.0 + 0.1 * minf(0.0, mood))
	if slack < 0.2 and not lob:
		tx *= 0.5
	var approach: bool = not lob and not touch and T.approach > 0 and from_net < 11.0 and slack > 0.15 and b.pz > 0.6 and \
		rng.next() < T.approach
	if approach:
		pace = maxf(pace, 0.75); tx = (weak_side if rng.next() < 0.5 else away) * edge * 0.85; spin_dir = 1; depth = 1.0
	var curve := 0.0 if touch else rand(-0.25, 0.25)
	var input := {}
	for i in 6:
		input = {"aim": 0.0, "landX": tx, "pace": pace, "over": 0.0, "spinDir": spin_dir, "curve": curve, "lob": lob, "clear": 0.4, "depth": depth}
		var shot := compute_shot(c, input, 0.0)
		var fl := Phys.flight(shot.px, shot.py, shot.pz, shot.vx, shot.vy, shot.vz, shot.spin, shot.side)
		var safe := fwd * fl.land_y > 0.3 and fl.net_clear > 0.3 and absf(fl.land_x) < Phys.SW - 0.25 and absf(fl.land_y) < Phys.HL - 0.3
		if safe:
			break
		pace = maxf(0.15, pace - 0.12)
		tx *= 0.7
	c.shot_n += 1
	c.last_tx = tx
	if approach:
		c.net_spot = [JsMath.clamp(tx * 0.3, -1.5, 1.5), -fwd * 3.6]
	return input


func cpu_choose_serve(c: TennisPlayer) -> Dictionary:
	var first := match_score.first_serve
	var opp := players[1 - c.side]
	var T: Dictionary = c.ch.tactics
	var mood := score_mood(c)
	var pace: float = (rand(0.7, 1.0) * (1.0 - 0.1 * mood) if first else rand(0.35, 0.6)) * cpu_pace
	var wide := box_sign * (Phys.SW - (0.8 if first else 1.3))
	var middle := box_sign * (0.5 if first else 1.0)
	var weak_target := wide if weak_side_of(opp) == box_sign else middle
	var target: float
	if not first or rng.next() < cpu_smart * 0.4:
		target = weak_target
	else:
		var r := rng.next()
		target = wide if r < T.serveWide else (JsMath.clamp(opp.x, -Phys.SW + 0.6, Phys.SW - 0.6) if r < T.serveWide + 0.2 else middle)
	var spin_dir := -1 if first and rng.next() < 0.6 else 1
	var curve := rand(-0.3, 0.3)
	var input = null
	for i in 8:
		var best = null
		var lo := -0.8
		var hi := 0.8
		for k in 7:
			var aim := (lo + hi) / 2.0
			var inp := {"aim": aim, "pace": pace, "over": 0.0, "spinDir": spin_dir, "curve": curve}
			var shot := compute_shot(c, inp, 0.0)
			var fl := Phys.flight(shot.px, shot.py, shot.pz, shot.vx, shot.vy, shot.vz, shot.spin, shot.side)
			if c.fwd * (fl.land_x - target) < 0.0: lo = aim
			else: hi = aim
			var in_box := Phys.in_service_box(fl.land_x, fl.land_y, box_side, box_sign) and \
				absf(fl.land_x) > 0.15 and absf(fl.land_x) < Phys.SW - 0.15 and absf(fl.land_y) < Phys.SL - 0.2
			if not in_box:
				continue
			var d := absf(fl.land_x - target)
			if best == null or d < best.d:
				best = {"d": d, "inp": inp}
		if best != null:
			input = best.inp; break
		pace = maxf(0.2, pace - 0.1)
	if input == null:
		input = {"aim": 0.0, "pace": pace, "over": 0.0, "spinDir": spin_dir, "curve": curve}
	if first and rng.next() < T.serveVolley:
		c.net_spot = [0.0, -c.fwd * 4.2]
	var W := window_for(c, "fh")
	input.err = (rng.next() + rng.next() - 1.0) * W * (2.6 * pace if first else 1.1)
	return input


func cpu_timing_error(c: TennisPlayer, wing: String, pace: float) -> float:
	var slack := c.plan.slack if c.plan != null else 0.0
	var n := 0.0 if slack >= 0.5 else ((0.5 - slack) / 0.5) * 1.4
	n += pow(pace, 3.0) * 0.8
	n += absf(ball.pz - 1.0) * 0.6
	n += (1.0 - stamina_f(c)) * 0.5
	if ball.pz >= c.ch.overheadZ and c.moving and c.dir_y * c.fwd < -0.5:
		n += 0.8
	var v := JsMath.hypot3(ball.vx, ball.vy, ball.vz)
	n += maxf(0.0, (v - 16.0) / 10.0) * 0.6
	return minf(n, 1.6) * cpu_err * c.ch.tactics.err * window_for(c, wing)


func cpu_hit(c: TennisPlayer) -> void:
	var input := cpu_choose_shot(c)
	var wing := "fh" if (ball.px - c.x) * c.fwd >= -0.05 else "bh"
	var err := cpu_timing_error(c, wing, input.pace) * (-1.0 if rng.next() < CPU_EARLY else 1.0)
	var shot := compute_shot(c, input, err)
	var fl := Phys.flight(shot.px, shot.py, shot.pz, shot.vx, shot.vy, shot.vz, shot.spin, shot.side)
	var goes_in := fl.net_clear > 0.0 and c.fwd * fl.land_y > 0.0 and Phys.in_singles(fl.land_x, fl.land_y)
	var r := 1.0 if goes_in or input.lob else rng.next()
	if r < 0.15:
		# into the net: drop the launch until it catches the tape or below
		var lo := shot.vz - 12.0
		var hi := shot.vz
		for i in 20:
			var mid := (lo + hi) / 2.0
			if Phys.flight(shot.px, shot.py, shot.pz, shot.vx, shot.vy, mid, shot.spin, shot.side).net_clear < -0.12: lo = mid
			else: hi = mid
		shot.vz = lo
	elif r < 0.3:
		var inp2 := input.duplicate()
		inp2.depth = 0.45; inp2.pace = input.pace * 0.6; inp2.landX = input.landX * 0.3
		shot = compute_shot(c, inp2, err * 0.3)
	apply_shot(c, shot)


func cpu_think(c: TennisPlayer) -> void:
	if phase == "preServe" and server == c.side and phase_wall > 1.1:
		request_toss(c.side)


# ---------------- simulation ----------------
func point_to(w: int, text: String, detail := "") -> void:
	if phase == "pointOver" or phase == "matchOver":
		return
	if drill != null:
		drill_end(null if ball.last_hitter == 1 and w == 0 else w == 0, text if w == 0 else "Missed")
		return
	held = null
	var ls = last_shot
	if (text == "Out" or text == "Net") and ls != null and ls.side == 1 - w and ls.kind != "serve":
		scout[ls.side][ls.wing].err += 1
	for p in players:
		scout[p.side].points += 1
		if p.seen_at_net:
			scout[p.side].net += 1
	var res := match_score.award_point(w)
	phase = "pointOver"
	phase_wall = 0.0
	for p in players:
		p.pending = null
	emit("point", {"winner": w, "text": text, "detail": detail, "result": res})


func fault(text: String) -> void:
	var m := match_score
	if drill != null:
		drill_end(false, "Net" if text == "Net" else "Fault", true, ball.px, ball.py); return
	if m.first_serve:
		m.first_serve = false
		phase = "fault"
		phase_wall = 0.0
		emit("fault", {"text": text})
	else:
		point_to(1 - server, "Double fault", text)


func on_bounce() -> void:
	var b := ball
	marks.append({"x": b.px, "y": b.py, "age": 0.0})
	emit("bounce", {"x": b.px, "y": b.py})
	if phase != "rally":
		b.bounces += 1; return
	var h := b.last_hitter
	var r := 1 - h
	if b.bounces == 0:
		var in_opp_half := fwd_of(h) * b.py > 0.0
		if not b.netted and in_opp_half:
			emit("lineCall", {"m": Phys.line_margin(b.px, b.py, b.is_serve, box_sign), "x": b.px, "y": b.py, "vx": b.vx, "vy": b.vy, "box": b.is_serve})
		if b.is_serve:
			if b.netted or not in_opp_half: fault("Net")
			elif not Phys.in_service_box(b.px, b.py, box_side, box_sign): fault("Fault")
			elif drill != null: drill_end(true, "In", true, b.px, b.py)
			else: b.bounces = 1
			return
		if b.netted or not in_opp_half:
			point_to(r, "Net"); return
		if not Phys.in_singles(b.px, b.py):
			point_to(r, "Out"); return
		if drill != null and h == 0:
			drill_end(true, "In", true, b.px, b.py); return
		b.bounces = 1
		return
	b.bounces += 1
	if held != null:
		return
	point_to(h, "Ace" if b.is_serve else "Winner")


func update_players(dt: float) -> void:
	for p in players:
		p.anim += dt
		if p.swing >= 0.0:
			p.swing += dt / 0.28
			if p.swing > 1.2: p.swing = -1.0
		var dx := p.tx - p.x
		var dy := p.ty - p.y
		var d := JsMath.hypot2(dx, dy)
		var sp := move_speed(p)
		if d > 0.02 and time >= p.react_until:
			var ux := dx / d
			var uy := dy / d
			if ux * p.dir_x + uy * p.dir_y < 0.3:
				p.v *= 0.3
			p.dir_x = ux; p.dir_y = uy
			p.v = minf(sp * back_f(uy, p.fwd), p.v + ACCEL * dt)
			var stp := minf(d, p.v * dt)
			p.x += ux * stp; p.y += uy * stp
			p.moving = true
			if phase == "rally":
				p.run += stp
				p.stamina = maxf(0.0, p.stamina - stp * p.ch.drain)
				p.cap = maxf(45.0, 100.0 - p.run * p.ch.capDrain)
				p.stamina = minf(p.stamina, p.cap)
		else:
			p.moving = false
			if d <= 0.02: p.v = 0.0
			if phase == "rally":
				p.stamina = minf(p.cap, p.stamina + STAMINA_STILL * dt)


func check_crossings() -> void:
	var b := ball
	for p in players:
		if not incoming_to(p) or p.fwd * b.py > 0.0:
			p.prev_rel = null; continue
		var rel := p.fwd * b.py - (p.fwd * p.y + CONTACT_AHEAD)
		if p.prev_rel != null and p.prev_rel > 0.0 and rel <= 0.0:
			var cr := TennisPlayer.Cross.new()
			cr.t = time; cr.x = b.px; cr.y = b.py; cr.z = b.pz; cr.ball = b.copy(); cr.px = p.x; cr.py = p.y
			p.cross = cr
			if control[p.side] == "cpu":
				if has_plan(p) and can_reach(p):
					cpu_hit(p)
					return
				# got there a step too late: lunge for it anyway
				if has_plan(p) and absf(b.px - p.x) <= p.ch.reach + 1.2 and b.pz <= p.ch.maxZ + 0.5:
					swing_miss(p, "Out of reach")
			elif p.pending != null:
				var err: float = p.pending.err if p.pending.has("err") else p.pending.t - time
				var input: Dictionary = p.pending.input
				p.pending = null
				try_hit(p, input, err)
				return
		p.prev_rel = rel


static func has_plan(p: TennisPlayer) -> bool:
	return p.plan != null and not p.leaving


func step_once(dt: float) -> void:
	time += dt
	update_players(dt)
	var b := ball
	if b.active:
		var vz_before := b.vz
		var ev := Phys.step_ball(b, dt)
		if phase == "toss":
			if vz_before > 0.0 and b.vz <= 0.0:
				peak_t = time
				peak_ball = b.copy()
				if control[server] == "cpu":
					var c := players[server]
					var input := cpu_choose_serve(c)
					apply_shot(c, compute_shot(c, input, input.err))
			elif b.vz < 0.0 and b.pz < 1.25:
				emit("whiff", {"side": server, "reason": "Re-toss"})
				start_point(true, true)
			return
		if ev == Phys.EV_NET: emit("net")
		if ev == Phys.EV_BOUNCE: on_bounce()
		if phase == "rally": check_crossings()
		if absf(b.py) > 40.0 or absf(b.px) > 25.0: b.active = false
	for p in players:
		if control[p.side] == "cpu":
			cpu_think(p)


func update(wall_dt: float) -> void:
	wall_dt = minf(wall_dt, 0.05)
	wall += wall_dt
	phase_wall += wall_dt
	if phase == "preServe" or phase == "toss":
		serve_wait += wall_dt
	acc += wall_dt * time_scale
	while acc >= Phys.DT:
		step_once(Phys.DT)
		acc -= Phys.DT
	for mk in marks:
		mk.age += wall_dt
	marks = marks.filter(func(mk): return mk.age < 1.2)
	if serve_clock != null and phase == "preServe" and control[server] != "cpu" and serve_wait > serve_clock:
		fault("Serve clock")
	if phase == "fault" and phase_wall > 1.1:
		var m := match_score
		start_point(true)
		m.first_serve = false
	if phase == "feed" and phase_wall > 0.9:
		feed_ball()
	if phase == "pointOver" and phase_wall > (1.3 if drill != null else 1.9):
		if match_score.over:
			phase = "matchOver"; emit("matchOver", {"winner": match_score.winner})
		else:
			start_point(false)


# Data the HUD needs about the human's incoming ball.
func incoming_info(side: int):
	var p := players[side]
	if not incoming_to(p):
		return null
	var c := predict_cross(p, 3.0)
	if c == null:
		return null
	return {"t": c.t, "x": c.x, "y": c.y, "z": c.z, "reach": absf(c.x - p.x) <= p.ch.reach and c.z <= p.ch.maxZ}


func set_auto_move(side: int, on: bool) -> void:
	auto_move[side] = on
