# Stand-in 3D players, the ball and the marks on the court. The players are
# simple shapes in each character's colours until the rigged models from the
# art tests (art/octopus-test, art/philosopher-test) replace them.
class_name Actors
extends Node3D

const SCALE := 1.15   # a little larger than life so they read on a phone, as in the 2D game

var game: TennisGame
var avatars: Array[Node3D] = []
var rackets: Array[Node3D] = []
var parts: Array[Dictionary] = []
var ball_mi: MeshInstance3D
var ball_shadow: MeshInstance3D
var trail: Array[MeshInstance3D] = []
var trail_pos: Array[Vector3] = []
var land_ring: MeshInstance3D
var mark_pool: Array[MeshInstance3D] = []
var human := 0


static func gv(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, z, -y)


static func glow(c: Color, e: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = c * e
	return m


static func lit(c: Color, rough := 0.5, rim := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	if rim > 0.0:
		m.rim_enabled = true; m.rim = rim; m.rim_tint = 0.6
	return m


func mesh(m: Mesh, mat: Material, parent: Node3D, pos := Vector3.ZERO, scl := Vector3.ONE) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = m; mi.material_override = mat; mi.position = pos; mi.scale = scl
	parent.add_child(mi)
	return mi


static func sphere(r: float, segs := 24) -> SphereMesh:
	var s := SphereMesh.new(); s.radius = r; s.height = r * 2.0; s.radial_segments = segs; s.rings = segs / 2
	return s


static func capsule(r: float, h: float) -> CapsuleMesh:
	var c := CapsuleMesh.new(); c.radius = r; c.height = h; c.radial_segments = 12; c.rings = 4
	return c


func setup(g: TennisGame, trail_len: int) -> void:
	game = g
	for c in get_children():
		c.queue_free()
	avatars.clear(); rackets.clear(); parts.clear(); trail.clear(); trail_pos.clear(); mark_pool.clear()
	for p in g.players:
		var a := Node3D.new()
		add_child(a)
		avatars.append(a)
		var info := {}
		if p.ch.id == "octopus": _octopus(a, p.ch, info)
		else: _owl(a, p.ch, info)
		parts.append(info)
	var bm := StandardMaterial3D.new()
	bm.albedo_color = Color(0.75, 0.95, 0.1)
	bm.emission_enabled = true; bm.emission = Color("#c6ff2e"); bm.emission_energy_multiplier = 1.4
	ball_mi = mesh(sphere(0.05, 16), bm, self)
	var sh := StandardMaterial3D.new()
	sh.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sh.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	sh.albedo_color = Color(0, 0, 0, 0.55)
	var disc := CylinderMesh.new(); disc.top_radius = 0.07; disc.bottom_radius = 0.07; disc.height = 0.002
	ball_shadow = mesh(disc, sh, self)
	var tm := StandardMaterial3D.new()
	tm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	tm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	for i in trail_len:
		var t := mesh(sphere(0.045, 8), tm.duplicate(), self)
		(t.material_override as StandardMaterial3D).albedo_color = Color(0.6, 1.0, 0.2, 0.35 * (1.0 - float(i) / trail_len))
		t.scale = Vector3.ONE * (1.0 - 0.6 * float(i) / trail_len)
		trail.append(t)
	var ring := TorusMesh.new(); ring.inner_radius = 0.22; ring.outer_radius = 0.28; ring.rings = 24; ring.ring_segments = 4
	land_ring = mesh(ring, glow(Color("#25d9ff"), 1.5), self)
	land_ring.scale = Vector3(1, 0.05, 1)
	var mm := glow(Color(0.8, 1.0, 0.3), 1.2)
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	for i in 6:
		var d := CylinderMesh.new(); d.top_radius = 0.09; d.bottom_radius = 0.09; d.height = 0.002
		var mk := mesh(d, mm.duplicate(), self)
		mk.visible = false
		mark_pool.append(mk)


# ---------------------------------------------------------------- stand-ins
func _racket(parent: Node3D, ch: Dictionary) -> Node3D:
	# pivot at the hand; the racket points along local -Z (forward) at rest
	var pivot := Node3D.new()
	parent.add_child(pivot)
	var h := mesh(capsule(0.016, 0.3), lit(Color(0.1, 0.1, 0.12), 0.6), pivot, Vector3(0, 0, -0.15))
	h.rotation.x = PI / 2
	var head := TorusMesh.new(); head.inner_radius = 0.12; head.outer_radius = 0.135; head.rings = 24; head.ring_segments = 6
	var hm := mesh(head, glow(ch.colors.glow, 1.4), pivot, Vector3(0, 0, -0.46), Vector3(0.8, 1, 1.05))
	hm.rotation.z = PI / 2
	var s := CylinderMesh.new(); s.top_radius = 0.12; s.bottom_radius = 0.12; s.height = 0.004
	var sm := StandardMaterial3D.new(); sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.albedo_color = Color(1, 1, 1, 0.18); sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var st := mesh(s, sm, pivot, Vector3(0, 0, -0.46), Vector3(0.8, 1, 1.05))
	st.rotation.z = PI / 2
	return pivot


func _octopus(a: Node3D, ch: Dictionary, info: Dictionary) -> void:
	var body := Node3D.new(); a.add_child(body); body.scale = Vector3.ONE * SCALE
	var skin := lit(Color("#4a1036"), 0.35, 0.5)
	skin.emission_enabled = true; skin.emission = Color("#28f0d6"); skin.emission_energy_multiplier = 0.08
	mesh(sphere(0.34), skin, body, Vector3(0, 1.45, 0.05), Vector3(1.0, 1.35, 1.05))
	for sx in [-1.0, 1.0]:
		mesh(sphere(0.07, 12), lit(Color(0.95, 0.85, 0.3), 0.2), body, Vector3(sx * 0.17, 1.33, -0.27))
		mesh(sphere(0.035, 8), glow(Color(0.02, 0.02, 0.02), 1.0), body, Vector3(sx * 0.17, 1.33, -0.33))
	var arms: Array[Node3D] = []
	for i in 8:
		var ang := TAU * i / 8.0 + 0.2
		var arm := Node3D.new()
		arm.position = Vector3(0, 1.05, 0)
		arm.rotation = Vector3(0, ang, 0)
		body.add_child(arm)
		var seg := Node3D.new(); arm.add_child(seg)
		seg.rotation.x = deg_to_rad(28)
		var c := mesh(capsule(0.075, 1.05), skin, seg, Vector3(0, -0.5, 0))
		c.scale = Vector3(1, 1, 1)
		arms.append(arm)
	# the racket arm, reaching out to the right
	var hand := Node3D.new(); hand.position = Vector3(0.5, 1.0, -0.15); body.add_child(hand)
	mesh(capsule(0.06, 0.6), skin, body, Vector3(0.3, 1.05, -0.08)).rotation.z = deg_to_rad(70)
	info.arms = arms
	info.hand = hand
	info.body = body
	info.lift = 0.0
	rackets.append(_racket(hand, ch))


func _owl(a: Node3D, ch: Dictionary, info: Dictionary) -> void:
	var body := Node3D.new(); a.add_child(body); body.scale = Vector3.ONE * SCALE
	var white := lit(Color(0.82, 0.8, 0.88), 0.85, 0.4)
	var bars := lit(Color(0.25, 0.22, 0.42), 0.8)
	mesh(sphere(0.3), white, body, Vector3(0, 0.95, 0), Vector3(1.0, 1.35, 0.95))
	mesh(sphere(0.25), white, body, Vector3(0, 1.4, -0.03))
	for i in 4:
		mesh(sphere(0.2, 12), bars, body, Vector3(0, 0.75 + i * 0.1, -0.13), Vector3(1.2, 0.08, 0.6))
	for sx in [-1.0, 1.0]:
		mesh(sphere(0.06, 12), glow(Color(1.0, 0.75, 0.1), 1.3), body, Vector3(sx * 0.09, 1.43, -0.21))
		mesh(sphere(0.03, 8), glow(Color(0.01, 0.01, 0.01), 1.0), body, Vector3(sx * 0.09, 1.43, -0.265))
	mesh(sphere(0.035, 8), lit(Color(0.1, 0.1, 0.1), 0.3), body, Vector3(0, 1.36, -0.25), Vector3(0.8, 1.3, 1))
	var laurel := TorusMesh.new(); laurel.inner_radius = 0.2; laurel.outer_radius = 0.24
	mesh(laurel, glow(ch.colors.glow, 1.3), body, Vector3(0, 1.56, -0.02)).rotation.x = deg_to_rad(-12)
	var wings: Array[Node3D] = []
	for sx in [-1.0, 1.0]:
		var w := Node3D.new(); w.position = Vector3(sx * 0.22, 1.15, 0.05); body.add_child(w)
		var f := mesh(BoxMesh.new(), white, w, Vector3(sx * 0.42, 0.18, 0), Vector3(0.85, 0.05, 0.42))
		f.rotation.z = sx * deg_to_rad(25)
		mesh(BoxMesh.new(), bars, w, Vector3(sx * 0.75, 0.33, 0.02), Vector3(0.35, 0.052, 0.36)).rotation.z = sx * deg_to_rad(25)
		wings.append(w)
	var hand := Node3D.new(); hand.position = Vector3(0.2, 0.5, -0.1); body.add_child(hand)
	for sx in [-1.0, 1.0]:
		mesh(capsule(0.04, 0.3), lit(Color(0.9, 0.75, 0.2), 0.4), body, Vector3(sx * 0.1, 0.55, -0.05))
	info.wings = wings
	info.hand = hand
	info.body = body
	info.lift = 0.45   # the Philosopher hovers low
	rackets.append(_racket(hand, ch))


# ---------------------------------------------------------------- per frame
func sync(dt: float) -> void:
	var g := game
	for i in 2:
		var p := g.players[i]
		var a := avatars[i]
		var info := parts[i]
		a.position = gv(p.x, p.y, 0.0)
		# face the net
		a.rotation.y = 0.0 if p.fwd > 0 else PI
		var t := p.anim
		var body: Node3D = info.body
		body.position.y = info.lift + (0.06 * sin(t * 7.0) if p.moving else 0.02 * sin(t * 2.0))
		if info.has("wings"):
			var flap := sin(t * (12.0 if p.moving else 6.0)) * (0.5 if p.moving else 0.3)
			info.wings[0].rotation.z = flap
			info.wings[1].rotation.z = -flap
		if info.has("arms"):
			for k in info.arms.size():
				var arm: Node3D = info.arms[k]
				arm.get_child(0).rotation.x = deg_to_rad(28) + 0.15 * sin(t * (9.0 if p.moving else 3.0) + k)
		_swing(rackets[i], p)


# Rotate the racket through the stroke: p.swing runs 0..1.2 during a swing.
func _swing(r: Node3D, p: TennisPlayer) -> void:
	var s := p.swing
	if s < 0.0:
		r.rotation = Vector3(deg_to_rad(-20), deg_to_rad(40), 0)
		return
	var k := clampf(s, 0.0, 1.0)
	k = 1.0 - pow(1.0 - k, 3.0)
	match p.swing_wing:
		"fh":
			r.rotation = Vector3(deg_to_rad(-10), lerp(deg_to_rad(110), deg_to_rad(-120), k), 0)
		"bh":
			r.rotation = Vector3(deg_to_rad(-10), lerp(deg_to_rad(-60), deg_to_rad(160), k), 0)
		_:
			r.rotation = Vector3(lerp(deg_to_rad(120), deg_to_rad(-80), k), 0, 0)


func sync_ball(human_side: int, show_landing: bool) -> void:
	var g := game
	var b := g.ball
	ball_mi.visible = b.active
	ball_shadow.visible = b.active
	if b.active:
		var pos := gv(b.px, b.py, b.pz)
		ball_mi.position = pos
		ball_shadow.position = gv(b.px, b.py, 0.012)
		var k := clampf(1.0 - b.pz / 6.0, 0.3, 1.0)
		ball_shadow.scale = Vector3(1.0 / k, 1, 1.0 / k)
		trail_pos.push_front(pos)
		if trail_pos.size() > trail.size():
			trail_pos.pop_back()
	else:
		trail_pos.clear()
	for i in trail.size():
		trail[i].visible = i < trail_pos.size() and i > 0
		if trail[i].visible:
			trail[i].position = trail_pos[i]
	land_ring.visible = show_landing and g.phase == "rally" and b.active and b.last_hitter != human_side and b.bounces == 0
	if land_ring.visible:
		land_ring.position = gv(g.pred_land_x, g.pred_land_y, 0.01)
	for i in mark_pool.size():
		var mk := mark_pool[i]
		if i < g.marks.size():
			var m: Dictionary = g.marks[i]
			mk.visible = true
			mk.position = gv(m.x, m.y, 0.011)
			(mk.material_override as StandardMaterial3D).albedo_color.a = clampf(1.0 - m.age / 1.2, 0.0, 1.0)
		else:
			mk.visible = false
