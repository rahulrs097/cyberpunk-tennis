// Phys.flight (engine/phys.gd) in C++. The shot solver flies thousands of
// trial balls per shot, which is too slow in GDScript for 60 fps on a phone.
// Same arithmetic in the same order, built without FMA contraction
// (-ffp-contract=off), so results are bit-identical to the GDScript and JS
// engines (only + - * / and sqrt, all exactly rounded).
#pragma once

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/packed_float64_array.hpp>

namespace godot {

class FastFlight : public RefCounted {
	GDCLASS(FastFlight, RefCounted)

protected:
	static void _bind_methods();

public:
	// [land_x, land_y, t, net_clear]
	PackedFloat64Array flight(double px, double py, double pz, double vx, double vy, double vz, double spin, double side) const;
};

} // namespace godot
