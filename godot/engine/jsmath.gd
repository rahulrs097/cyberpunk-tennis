# The few places where JavaScript's Math differs from Godot's, reproduced
# exactly so the port gives the same numbers as js/*.js.
class_name JsMath
extends RefCounted


# Math.hypot as V8 computes it: scaled by the largest value, Kahan-summed.
static func hypot2(a: float, b: float) -> float:
	var x := absf(a); var y := absf(b)
	var m := maxf(x, y)
	if m == 0.0:
		return 0.0
	var sum := 0.0; var comp := 0.0
	for v in [x, y]:
		var n: float = v / m
		var summand := n * n - comp
		var pre := sum + summand
		comp = (pre - sum) - summand
		sum = pre
	return sqrt(sum) * m


static func hypot3(a: float, b: float, c: float) -> float:
	var x := absf(a); var y := absf(b); var z := absf(c)
	var m := maxf(x, maxf(y, z))
	if m == 0.0:
		return 0.0
	var sum := 0.0; var comp := 0.0
	for v in [x, y, z]:
		var n: float = v / m
		var summand := n * n - comp
		var pre := sum + summand
		comp = (pre - sum) - summand
		sum = pre
	return sqrt(sum) * m


# Math.round: halves round up, towards +infinity.
static func js_round(v: float) -> int:
	return int(floor(v + 0.5))


# Math.sign
static func sgn(v: float) -> float:
	return 1.0 if v > 0.0 else (-1.0 if v < 0.0 else 0.0)


static func clamp(v: float, a: float, b: float) -> float:
	return maxf(a, minf(b, v))


static func lerp(a: float, b: float, t: float) -> float:
	return a + (b - a) * t


# 32-bit Math.imul without overflowing 64-bit ints.
static func imul(a: int, b: int) -> int:
	a &= 0xFFFFFFFF; b &= 0xFFFFFFFF
	var lo := (a & 0xFFFF) * b
	var hi := ((a >> 16) * b) & 0xFFFF
	return (lo + (hi << 16)) & 0xFFFFFFFF
