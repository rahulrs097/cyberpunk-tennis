# Court geometry, ball physics and the shot solver: a line-for-line port of
# js/physics.js. World units are metres and seconds. x = across the court,
# y = along it (net at y = 0, the bottom player's half is y < 0), z = height.
# Everything here is deterministic: the same inputs always give the same flight.
class_name Phys
extends RefCounted

# COURT
const HL := 11.885        # half length (net to baseline)
const SW := 4.115         # singles half width
const DW := 5.485         # doubles half width
const SL := 6.40          # net to service line
const LW := 0.05          # line width (the baselines are twice that)
const NET_C := 0.914      # net height at the centre strap
const NET_P := 1.07       # net height at the posts
const POST_X := 6.4

# PHYS
const G := 9.81
const R := 0.033          # ball radius
const K_DRAG := 0.014     # quadratic air drag
const K_MAG := 0.26       # topspin dip (per unit spin, per m/s)
const K_SIDE := 0.10      # sidespin curve
const DT := 1.0 / 240.0   # fixed simulation step
const E := 0.81           # vertical coefficient of restitution
const MU := 0.6           # ball-court sliding friction
const ALPHA := 0.55       # ball moment of inertia, I / (m R^2)
const K_AIR := 0.0363     # rho * A / 2m: turns a lift coefficient into m^-1

enum { EV_NONE, EV_BOUNCE, EV_NET }


class Flight:
	var land_x := 0.0
	var land_y := 0.0
	var t := 0.0
	var net_clear := 0.0


class Launch:
	var vx := 0.0
	var vy := 0.0
	var vz := 0.0
	var landing: Flight


class Root:
	var x := 0.0
	var r: Flight


# The C++ FastFlight (native/), when the extension is built for this
# platform; null means use the GDScript flight below. Set CT_NO_NATIVE=1 to
# force GDScript (the parity tests run both).
static var native = null
static var native_checked := false


static func use_native(on: bool) -> void:
	native_checked = true
	native = ClassDB.instantiate("FastFlight") if on and ClassDB.class_exists("FastFlight") else null


static func net_height(x: float) -> float:
	return NET_C + (NET_P - NET_C) * minf(1.0, absf(x) / POST_X)


# Game spin is a Magnus strength (accel = K_MAG * spin * speed). Convert it
# to the speed of the ball's surface (omega * R) and back, through the lift
# coefficient a real ball would need: C_L = S / (1 + 2S), S = omega R / v.
static func spin_to_surface(spin: float, v: float) -> float:
	var cl := JsMath.clamp(K_MAG * spin / (K_AIR * maxf(v, 1.0)), -1.0 / 3.0, 1.0 / 3.0)
	return v * cl / (1.0 - 2.0 * absf(cl))


static func surface_to_spin(wr: float, v: float) -> float:
	var s := wr / maxf(v, 1.0)
	return K_AIR * maxf(v, 1.0) * (s / (1.0 + 2.0 * absf(s))) / K_MAG


# The bounce (Cross / Brody): see js/physics.js.
static func bounce(b: Ball) -> void:
	var vh := sqrt(b.vx * b.vx + b.vy * b.vy)
	var vz_in := -b.vz
	var wr := spin_to_surface(b.spin, vh)
	var u := vh - wr
	var to_roll := ALPHA * u / (1.0 + ALPHA)
	var slide := MU * (1.0 + E) * vz_in
	var dv := to_roll if absf(to_roll) <= slide else JsMath.sgn(u) * slide
	var vh_out := maxf(0.0, vh - dv)
	if vh > 1e-6:
		b.vx *= vh_out / vh; b.vy *= vh_out / vh
	b.vz = vz_in * E
	b.spin = surface_to_spin(wr + dv / ALPHA, vh_out)
	b.side *= 0.3


# Advance one fixed step. Returns EV_BOUNCE, EV_NET or EV_NONE.
static func step_ball(b: Ball, dt: float, no_net := false) -> int:
	var h2 := b.vx * b.vx + b.vy * b.vy
	var vh := sqrt(h2)
	var sp := sqrt(h2 + b.vz * b.vz)
	var ax := -K_DRAG * sp * b.vx
	var ay := -K_DRAG * sp * b.vy
	var az := -G - K_DRAG * sp * b.vz
	az += -K_MAG * b.spin * vh
	if vh > 0.1 and b.side != 0.0:
		# right-hand perpendicular of the direction of travel
		var px := b.vy / vh
		var py := -b.vx / vh
		ax += K_SIDE * b.side * sp * px
		ay += K_SIDE * b.side * sp * py
	b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt
	var prev_y := b.py
	b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt

	var ev := EV_NONE
	if not no_net and b.in_flight and not b.netted and JsMath.sgn(prev_y) != JsMath.sgn(b.py) and prev_y != 0.0:
		if absf(b.px) < POST_X and b.pz < net_height(b.px) + R:
			# Into the tape: the ball dies and drops back on the hitter's side.
			b.py = JsMath.sgn(prev_y) * 0.06
			b.vy = -b.vy * 0.08; b.vx *= 0.3; b.vz = minf(b.vz, 0.0) * 0.3
			b.spin = 0.0; b.side = 0.0; b.netted = true
			ev = EV_NET
	if b.pz < R and b.vz < 0.0:
		b.pz = R
		bounce(b)
		if ev != EV_NET:
			ev = EV_BOUNCE
	return ev


# Fly a ball from a launch state until it first lands. No net collision:
# instead it reports how far above the tape it passed. The shot solver runs
# this thousands of times per shot, so it is step_ball (with no net) inlined
# on local variables, with exactly the same arithmetic.
static func flight(px: float, py: float, pz: float, vx: float, vy: float, vz: float, spin: float, side: float) -> Flight:
	if not native_checked:
		use_native(OS.get_environment("CT_NO_NATIVE") == "")
	if native != null:
		var r: PackedFloat64Array = native.flight(px, py, pz, vx, vy, vz, spin, side)
		var nf := Flight.new()
		nf.land_x = r[0]; nf.land_y = r[1]; nf.t = r[2]; nf.net_clear = r[3]
		return nf
	var net_clear := 0.0
	var have_clear := false
	var t := 0.0
	var y0 := py
	while t < 5.0:
		var prev_y := py
		var h2 := vx * vx + vy * vy
		var vh := sqrt(h2)
		var sp := sqrt(h2 + vz * vz)
		var ax := -K_DRAG * sp * vx
		var ay := -K_DRAG * sp * vy
		var az := -G - K_DRAG * sp * vz
		az += -K_MAG * spin * vh
		if vh > 0.1 and side != 0.0:
			ax += K_SIDE * side * sp * (vy / vh)
			ay += K_SIDE * side * sp * (-vx / vh)
		vx += ax * DT; vy += ay * DT; vz += az * DT
		px += vx * DT; py += vy * DT; pz += vz * DT
		t += DT
		if not have_clear and prev_y != 0.0 and (py == 0.0 or (prev_y < 0.0) != (py < 0.0)):
			net_clear = pz - net_height(px)
			have_clear = true
		if pz < R and vz < 0.0:
			break
	if not have_clear:
		net_clear = -9.0 if JsMath.sgn(y0) == JsMath.sgn(py) else 9.0
	var f := Flight.new()
	f.land_x = px; f.land_y = py; f.t = t; f.net_clear = net_clear
	return f


static func flight_of(b: Ball) -> Flight:
	return flight(b.px, b.py, b.pz, b.vx, b.vy, b.vz, b.spin, b.side)


# Find x in [lo, hi] where an increasing f(x) crosses zero, by regula falsi
# (Illinois). fr(x) returns [f, r]. See js/physics.js findRoot.
static func find_root(fr: Callable, lo: float, hi: float, tol: float, either: bool) -> Root:
	var A: Array = fr.call(lo)
	var B: Array = fr.call(hi)
	var out := Root.new()
	if A[0] >= 0.0:
		out.x = lo; out.r = A[1]; return out
	if B[0] < 0.0:
		out.x = hi; out.r = B[1]; return out
	var a := lo; var b := hi
	var fa: float = A[0]; var fb: float = B[0]
	var last := 0
	var i := 0
	while i < 40 and b - a > 1e-6:
		var x := (a * fb - b * fa) / (fb - fa)
		if not (x > a and x < b):
			x = (a + b) / 2.0
		var X: Array = fr.call(x)
		var f: float = X[0]
		if (f < tol) if f >= 0.0 else (either and -f < tol):
			out.x = x; out.r = X[1]; return out
		if f < 0.0:
			a = x; fa = f
			if last < 0: fb /= 2.0
			last = -1
		else:
			b = x; fb = f; B = X
			if last > 0: fa /= 2.0
			last = 1
		i += 1
	out.x = b; out.r = B[1]
	return out


# Find the vertical launch speed that sends a ball with horizontal speed
# `speed_h` along (dx, dy) to land `dist` metres away (to within a
# centimetre), clearing the net by at least `min_clear`. If the net forces a
# higher launch the ball lands longer.
static func solve_launch(px: float, py: float, pz: float, dx: float, dy: float, speed_h: float,
		spin: float, side: float, dist: float, min_clear: float) -> Launch:
	var vx := dx * speed_h
	var vy := dy * speed_h
	var fly_along := func(vz: float) -> Array:
		var r := flight(px, py, pz, vx, vy, vz, spin, side)
		return [(r.land_x - px) * dx + (r.land_y - py) * dy - dist, r]
	var s := find_root(fly_along, -15.0, maxf(2.0, minf(20.0, speed_h * 0.95)), 0.01, true)
	if s.r.net_clear < min_clear:
		var fly_clear := func(vz: float) -> Array:
			var r := flight(px, py, pz, vx, vy, vz, spin, side)
			return [r.net_clear - min_clear, r]
		s = find_root(fly_clear, s.x, maxf(s.x + 0.01, minf(24.0, speed_h * 1.1)), 0.002, false)
	var l := Launch.new()
	l.vx = vx; l.vy = vy; l.vz = s.x; l.landing = s.r
	return l


static func in_singles(x: float, y: float) -> bool:
	return absf(x) <= SW + R and absf(y) <= HL + R


# box: {side: 0|1 (whose half), sign: +1|-1 (which half of x)}
static func in_service_box(x: float, y: float, box_side: int, box_sign: float) -> bool:
	var in_y := (y <= 0.0 and y >= -SL - R) if box_side == 0 else (y >= 0.0 and y <= SL + R)
	# (the centre service line straddles x = 0 and belongs to both boxes)
	var c := LW / 2.0 + R
	var in_x := (x >= -c and x <= SW + R) if box_sign > 0.0 else (x <= c and x >= -SW - R)
	return in_x and in_y


# How far (m) the edge of a ball bouncing at x, y missed the outside of the
# nearest line: positive when out, negative when in. has_box: a service box.
static func line_margin(x: float, y: float, has_box: bool, box_sign: float) -> float:
	var ax := box_sign * x if has_box else absf(x)
	var ay := absf(y)
	var x0 := -LW / 2.0 if has_box else -INF
	var x1 := SW
	var y1 := SL if has_box else HL
	var past := maxf(maxf(x0 - ax, ax - x1), ay - y1)
	return past - R
