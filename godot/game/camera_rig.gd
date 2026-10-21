# The two camera views from js/render.js: a raised chase camera behind the
# human player, or first person from their eyes with the head following the
# ball on springs.
class_name CameraRig
extends Camera3D

# Chase framing: high enough that the ball stays visible over your player's head.
const CAM := {"back": 7.2, "height": 6.4, "lookAhead": 13.0, "follow": 0.75, "ballPull": 0.4, "ease": 3.2}
const EYE := {"back": 0.5, "height": 1.65, "lookAhead": 10.0, "lookZ": 0.75, "follow": 8.0,
	"turn": 6.0, "tossTurn": 9.0, "serveBack": 2.5, "maxTurn": 0.6, "pastFrom": -0.3, "minPitch": -0.35,
	"ballPitch": 0.7, "maxSpin": 4.0}

var view := "chase"
var ready_ := false
var cx := 0.0
var cy := -20.0
var cz := 6.4
var lx := 0.0
var ly := 0.0
var lz := 0.0
var eye_yaw := 0.0
var eye_pitch := 0.0
var yaw_v := 0.0
var pitch_v := 0.0


func set_view(v: String) -> void:
	view = "first" if v == "first" else "chase"
	ready_ = false


# Wide enough to see the far court on a narrow phone (42 degrees across),
# 60 degrees tall on wider screens, as the 2D renderer frames it.
func fit(size: Vector2) -> void:
	var f := minf((size.x / 2.0) / tan(deg_to_rad(21.0)), (size.y / 2.0) / tan(deg_to_rad(30.0)))
	keep_aspect = Camera3D.KEEP_HEIGHT
	fov = rad_to_deg(2.0 * atan((size.y / 2.0) / f))
	near = 0.2
	far = 1500.0


static func angle_diff(a: float, b: float) -> float:
	var d := a - b
	return d - round(d / TAU) * TAU


func update_view(g: TennisGame, human: int, dt: float) -> void:
	if view == "first":
		_eye(g, human, dt)
	else:
		_chase(g, human, dt)
	position = Arena.gv(cx, cy, cz)
	var target := Arena.gv(lx, ly, lz)
	if position.distance_to(target) > 0.01:
		look_at(target, Vector3.UP)


func _chase(g: TennisGame, human: int, dt: float) -> void:
	var p := g.players[human]
	var b := g.ball
	var fwd := p.fwd
	var tx := p.x * CAM.follow
	var ty := p.y - fwd * CAM.back
	var bx := b.px if b.active else 0.0
	var tlx := clampf(p.x * 0.35 + bx * CAM.ballPull, -6.0, 6.0)
	var tly := p.y + fwd * CAM.lookAhead
	var k := 1.0 - exp(-dt * CAM.ease) if ready_ else 1.0
	cx += (tx - cx) * k; cy += (ty - cy) * k; cz = CAM.height
	lx += (tlx - lx) * k; ly += (tly - ly) * k; lz = 0.0
	ready_ = true


func _eye(g: TennisGame, human: int, dt: float) -> void:
	var p := g.players[human]
	var b := g.ball
	var fwd := p.fwd
	var serving := (g.phase == "preServe" or g.phase == "toss") and g.server == human
	var tossing := g.phase == "toss" and g.server == human
	var tx := p.x
	var ty := p.y - fwd * (EYE.serveBack if serving else EYE.back)
	var kp := 1.0 - exp(-dt * EYE.follow) if ready_ else 1.0
	cx += (tx - cx) * kp; cy += (ty - cy) * kp; cz = EYE.height
	var ahead := 0.0 if fwd > 0 else PI
	var court_pitch := atan2(EYE.lookZ - EYE.height, EYE.lookAhead)
	var yaw := ahead
	var pitch := court_pitch
	if b.active:
		var dx := b.px - cx
		var dy := b.py - cy
		var h := maxf(2.0, sqrt(dx * dx + dy * dy))
		var ball_pitch := atan2(b.pz - cz, h)
		yaw = atan2(dx, dy)
		var past := not serving and b.last_hitter != human and fwd * (b.py - p.y) < EYE.pastFrom
		if tossing:
			pitch = ball_pitch
		else:
			pitch = court_pitch + (ball_pitch - court_pitch) * EYE.ballPitch
			if not past:
				yaw = ahead + clampf(angle_diff(yaw, ahead), -EYE.maxTurn, EYE.maxTurn)
				pitch = maxf(EYE.minPitch, pitch)
	pitch = clampf(pitch, -0.7, 0.9)
	if not ready_:
		eye_yaw = yaw; eye_pitch = pitch; yaw_v = 0.0; pitch_v = 0.0
	var w: float = EYE.tossTurn if tossing else EYE.turn
	var step := minf(dt, 0.05)
	yaw_v += (w * w * angle_diff(yaw, eye_yaw) - 2.0 * w * yaw_v) * step
	yaw_v = clampf(yaw_v, -EYE.maxSpin, EYE.maxSpin)
	eye_yaw += yaw_v * step
	pitch_v += (w * w * (pitch - eye_pitch) - 2.0 * w * pitch_v) * step
	eye_pitch += pitch_v * step
	lx = cx + sin(eye_yaw) * cos(eye_pitch) * 10.0
	ly = cy + cos(eye_yaw) * cos(eye_pitch) * 10.0
	lz = cz + sin(eye_pitch) * 10.0
	ready_ = true


# Screen point to a spot on the ground, in game coordinates (or null).
func unproject_ground(sp: Vector2):
	var o := project_ray_origin(sp)
	var d := project_ray_normal(sp)
	if d.y >= -1e-3:
		return null
	var t := -o.y / d.y
	var w := o + d * t
	return Vector2(w.x, -w.z)


# Game point to screen (or null when behind the camera).
func project_game(x: float, y: float, z: float):
	var w := Arena.gv(x, y, z)
	if is_position_behind(w):
		return null
	return unproject_position(w)
