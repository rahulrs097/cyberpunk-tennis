#include "fast_flight.h"

#include <cmath>
#include <godot_cpp/core/class_db.hpp>

using namespace godot;

namespace {
// physics constants: keep in step with engine/phys.gd
const double G = 9.81;
const double R = 0.033;
const double K_DRAG = 0.014;
const double K_MAG = 0.26;
const double K_SIDE = 0.10;
const double DT = 1.0 / 240.0;
const double NET_C = 0.914;
const double NET_P = 1.07;
const double POST_X = 6.4;

double net_height(double x) {
	return NET_C + (NET_P - NET_C) * std::fmin(1.0, std::fabs(x) / POST_X);
}

double sgn(double v) { return v > 0.0 ? 1.0 : (v < 0.0 ? -1.0 : 0.0); }
} // namespace

void FastFlight::_bind_methods() {
	ClassDB::bind_method(D_METHOD("flight", "px", "py", "pz", "vx", "vy", "vz", "spin", "side"), &FastFlight::flight);
}

PackedFloat64Array FastFlight::flight(double px, double py, double pz, double vx, double vy, double vz, double spin, double side) const {
	double net_clear = 0.0;
	bool have_clear = false;
	double t = 0.0;
	const double y0 = py;
	while (t < 5.0) {
		const double prev_y = py;
		const double h2 = vx * vx + vy * vy;
		const double vh = std::sqrt(h2);
		const double sp = std::sqrt(h2 + vz * vz);
		double ax = -K_DRAG * sp * vx;
		double ay = -K_DRAG * sp * vy;
		double az = -G - K_DRAG * sp * vz;
		az += -K_MAG * spin * vh;
		if (vh > 0.1 && side != 0.0) {
			ax += K_SIDE * side * sp * (vy / vh);
			ay += K_SIDE * side * sp * (-vx / vh);
		}
		vx += ax * DT; vy += ay * DT; vz += az * DT;
		px += vx * DT; py += vy * DT; pz += vz * DT;
		t += DT;
		if (!have_clear && prev_y != 0.0 && (py == 0.0 || (prev_y < 0.0) != (py < 0.0))) {
			net_clear = pz - net_height(px);
			have_clear = true;
		}
		if (pz < R && vz < 0.0) break;
	}
	if (!have_clear) net_clear = sgn(y0) == sgn(py) ? -9.0 : 9.0;
	PackedFloat64Array out;
	out.resize(4);
	out.set(0, px); out.set(1, py); out.set(2, t); out.set(3, net_clear);
	return out;
}
