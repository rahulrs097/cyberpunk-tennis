# The ball's state. Plain float fields rather than Vector3, which is single
# precision: the engine must match the JS one (doubles) step for step.
class_name Ball
extends RefCounted

var px := 0.0
var py := 0.0
var pz := 1.0
var vx := 0.0
var vy := 0.0
var vz := 0.0
var spin := 0.0        # + topspin, - backspin (roughly -1..1.2)
var side := 0.0        # + curves to the hitter's right
var active := false
var in_flight := false # false while being tossed
var bounces := 0
var last_hitter := -1
var is_serve := false
var netted := false


func copy() -> Ball:
	var b := Ball.new()
	b.px = px; b.py = py; b.pz = pz
	b.vx = vx; b.vy = vy; b.vz = vz
	b.spin = spin; b.side = side
	b.active = active; b.in_flight = in_flight; b.bounces = bounces
	b.last_hitter = last_hitter; b.is_serve = is_serve; b.netted = netted
	return b
