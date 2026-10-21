# The CPU's only source of randomness (Math.random in the JS engine).
# mulberry32, the same generator tests/engine.js seeds Math.random with, so a
# seeded match plays out identically in both engines.
class_name SeededRng
extends RefCounted

var s := 1


func _init(seed_value: int = 1) -> void:
	s = seed_value & 0xFFFFFFFF
	if s == 0:
		s = 1


func next() -> float:
	s = (s + 0x6d2b79f5) & 0xFFFFFFFF
	var t := s
	t = JsMath.imul(t ^ (t >> 15), t | 1)
	t = (t ^ ((t + JsMath.imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
