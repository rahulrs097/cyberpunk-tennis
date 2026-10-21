# The rooftop parking lot at night, built in code to the layout of
# js/render.js and the Blender court test (art/court-test): court, net, the
# six lamps, parked cars with underglow, parapets, the HHORNS billboard and
# the skyline. Detail follows the graphics preset (Settings.PRESETS).
# Game coordinates (x across, y along the court, z up) map to Godot as
# Vector3(x, z, -y).
class_name Arena
extends Node3D

const LOT_EDGE := 17.5
const LOT_BACK := -21.5
const LOT_X := 45.0
const STALL_IN := 8.0
const STALL_OUT := 13.2
const STALL_W := 2.6
const DROP := 24.0
const LAMPS := [[-7.7, 16.5, "#ffb04a"], [7.7, 16.5, "#ffb04a"], [-7.7, 3.0, "#ff4fc0"],
	[7.7, -3.0, "#3fdcff"], [-7.7, -12.0, "#ffb04a"], [7.7, -15.0, "#ffb04a"]]
const PALETTE := ["#2a2f45", "#3b1f3f", "#1d3340", "#40342a", "#262626", "#18203a"]
const CAR_MESHES := ["res://art/cars/car_sedan.glb", "res://art/cars/car_hatch.glb", "res://art/cars/car_suv.glb"]

var preset: Dictionary
var env: Environment
var lamp_lights: Array[SpotLight3D] = []
var glow_lights: Array[Light3D] = []


static func gv(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, z, -y)


# the scenery hash from render.js, so the cars sit in the same bays
static func hash_(n: float) -> float:
	var s := sin(n * 127.1) * 43758.5453
	return s - floor(s)


func build(p: Dictionary) -> void:
	preset = p
	_environment()
	_deck()
	_court()
	_net()
	_lot()
	_lamps()
	_cars()
	_parapets()
	_billboard()
	_skyline()
	apply_preset(p)


# Settings that can change without rebuilding the scene.
func apply_preset(p: Dictionary) -> void:
	preset = p
	env.glow_enabled = p.glow
	env.glow_bloom = 0.12 if p.glow_hq else 0.05
	env.fog_enabled = p.fog
	for i in lamp_lights.size():
		lamp_lights[i].shadow_enabled = p.lamp_shadows > i
	for l in glow_lights:
		l.visible = p.extra_lights


# ---------------------------------------------------------------- materials
static func mat(color: Color, rough := 0.6, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	return m


static func glow_mat(color: Color, energy: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color * energy
	return m


func box(c0: Vector3, c1: Vector3, m: Material, parent: Node3D = self) -> MeshInstance3D:
	# c0, c1: opposite corners in game coordinates
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(absf(c1.x - c0.x), absf(c1.z - c0.z), absf(c1.y - c0.y))
	mi.mesh = bm
	mi.material_override = m
	mi.position = gv((c0.x + c1.x) / 2.0, (c0.y + c1.y) / 2.0, (c0.z + c1.z) / 2.0)
	parent.add_child(mi)
	return mi


func cyl(x: float, y: float, z0: float, h: float, r: float, m: Material, parent: Node3D = self) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r; cm.bottom_radius = r; cm.height = h
	cm.radial_segments = 16 if preset.detail > 0 else 8
	mi.mesh = cm
	mi.material_override = m
	mi.position = gv(x, y, z0 + h / 2.0)
	parent.add_child(mi)
	return mi


# ---------------------------------------------------------------- sky and light
func _environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sm := ShaderMaterial.new()
	sm.shader = load("res://game/shaders/night_sky.gdshader")
	sky.sky_material = sm
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("#2a2140")
	env.ambient_light_energy = 0.6
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.1
	env.glow_enabled = true
	env.glow_intensity = 0.9
	env.glow_strength = 1.0
	env.glow_hdr_threshold = 1.0
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.fog_enabled = true
	env.fog_light_color = Color("#2a1238")
	env.fog_density = 0.0015
	env.fog_sky_affect = 0.0
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var moon := DirectionalLight3D.new()
	moon.light_color = Color(0.6, 0.7, 1.0)
	moon.light_energy = 0.12
	moon.rotation = Vector3(deg_to_rad(-50), deg_to_rad(200), 0)
	add_child(moon)


# ---------------------------------------------------------------- deck
func _deck() -> void:
	var m := ShaderMaterial.new()
	m.shader = load("res://game/shaders/wet_asphalt.gdshader")
	box(Vector3(-LOT_X, LOT_BACK, -0.35), Vector3(LOT_X, LOT_EDGE + 0.3, 0.0), m)
	var st := mat(Color("#141418"), 0.9)
	box(Vector3(-LOT_X + 0.3, LOT_BACK + 0.3, -DROP), Vector3(LOT_X - 0.3, LOT_EDGE, -0.35), st)


func _court() -> void:
	var D := Phys.DW; var L := Phys.HL; var S := Phys.SW
	box(Vector3(-D - 1.2, -L - 2.5, 0.0), Vector3(D + 1.2, L + 2.5, 0.003), mat(Color("#17294a"), 0.45))
	box(Vector3(-S, -L, 0.003), Vector3(S, L, 0.004), mat(Color("#1b3a66"), 0.42))
	var lm := glow_mat(Color("#7af6ff"), 2.2)
	var lines := [[-D, -L, D, -L, 0.1], [-D, L, D, L, 0.1], [-D, -L, -D, L, 0.05], [D, -L, D, L, 0.05],
		[-S, -L, -S, L, 0.05], [S, -L, S, L, 0.05], [-S, -Phys.SL, S, -Phys.SL, 0.05], [-S, Phys.SL, S, Phys.SL, 0.05],
		[0.0, -Phys.SL, 0.0, Phys.SL, 0.05], [0.0, -L, 0.0, -L + 0.3, 0.05], [0.0, L, 0.0, L - 0.3, 0.05]]
	for l in lines:
		var w: float = l[4] / 2.0
		if l[0] == l[2]:
			box(Vector3(l[0] - w, l[1], 0.004), Vector3(l[0] + w, l[3], 0.008), lm)
		else:
			box(Vector3(l[0], l[1] - w, 0.004), Vector3(l[2], l[1] + w, 0.008), lm)


func _net() -> void:
	var X := Phys.POST_X
	# the mesh: a quad with a grid shader, its top following the sag of the net
	var nm := ShaderMaterial.new()
	nm.shader = load("res://game/shaders/net.gdshader")
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 32
	for i in n:
		var xa := -X + 2.0 * X * i / n
		var xb := -X + 2.0 * X * (i + 1) / n
		var ha := Phys.net_height(xa) - 0.03
		var hb := Phys.net_height(xb) - 0.03
		var q := [gv(xa, 0, 0), gv(xb, 0, 0), gv(xb, 0, hb), gv(xa, 0, ha)]
		var uv := [Vector2(xa, 0), Vector2(xb, 0), Vector2(xb, hb), Vector2(xa, ha)]
		for k in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uv[k]); st.add_vertex(q[k])
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = nm
	add_child(mi)
	# the pink neon headband
	var band := glow_mat(Color("#ff3fb4"), 2.6)
	for i in n:
		var xa := -X + 2.0 * X * i / n
		var xb := -X + 2.0 * X * (i + 1) / n
		var b := box(Vector3(xa, -0.012, Phys.net_height(xa) - 0.055), Vector3(xb, 0.012, Phys.net_height(xa) - 0.0), band)
		b.rotation.z = atan2(Phys.net_height(xb) - Phys.net_height(xa), xb - xa)
	box(Vector3(-0.025, -0.006, 0.0), Vector3(0.025, 0.006, Phys.NET_C - 0.02), mat(Color(0.9, 0.9, 0.95), 0.5))
	var metal := mat(Color("#1c1b2a"), 0.35, 0.8)
	for sx in [-1.0, 1.0]:
		cyl(sx * (X + 0.04), 0.0, 0.0, Phys.NET_P + 0.06, 0.04, metal)


# ---------------------------------------------------------------- lot markings
func _lot() -> void:
	var paint := mat(Color(0.55, 0.54, 0.48), 0.6)
	var yellow := mat(Color(0.85, 0.55, 0.02), 0.55)
	for sx in [-1.0, 1.0]:
		var y := -19.5
		while y <= LOT_EDGE - 0.5:
			box(Vector3(minf(sx * STALL_IN, sx * STALL_OUT), y - 0.05, 0.0), Vector3(maxf(sx * STALL_IN, sx * STALL_OUT), y + 0.05, 0.004), paint)
			if preset.detail > 1:
				box(Vector3(minf(sx * 16.0, sx * 21.2), y - 0.05, 0.0), Vector3(maxf(sx * 16.0, sx * 21.2), y + 0.05, 0.004), paint)
			y += STALL_W
		y = LOT_BACK + 0.5
		while y < LOT_EDGE - 0.5:
			box(Vector3(sx * 7.2 - 0.06, y, 0.0), Vector3(sx * 7.2 + 0.06, minf(y + 1.6, LOT_EDGE), 0.004), yellow)
			y += 3.2


func _lamps() -> void:
	var metal := mat(Color("#1c1b2a"), 0.35, 0.8)
	var conc := mat(Color("#2a2a30"), 0.85)
	for l in LAMPS:
		var x: float = l[0]; var y: float = l[1]
		var col := Color(l[2])
		var hx := x * 0.75
		cyl(x, y, 0.0, 0.5, 0.28, conc)
		cyl(x, y, 0.0, 7.5, 0.085, metal)
		box(Vector3(minf(x, hx) - 0.05, y - 0.05, 7.45), Vector3(maxf(x, hx) + 0.05, y + 0.05, 7.55), metal)
		box(Vector3(hx - 0.45, y - 0.22, 7.38), Vector3(hx + 0.45, y + 0.22, 7.56), metal)
		box(Vector3(hx - 0.38, y - 0.16, 7.36), Vector3(hx + 0.38, y + 0.16, 7.38), glow_mat(col, 3.0))
		var s := SpotLight3D.new()
		s.light_color = col
		s.light_energy = 9.0
		s.spot_range = 16.0
		s.spot_angle = 62.0
		s.spot_attenuation = 1.2
		s.position = gv(hx, y, 7.3)
		s.rotation = Vector3(-PI / 2, 0, 0)
		s.shadow_bias = 0.05
		add_child(s)
		lamp_lights.append(s)
	# the lamps over the court cast shadows first
	lamp_lights.sort_custom(func(a, b): return absf(a.position.z) < absf(b.position.z))


# ---------------------------------------------------------------- cars, as in the game's CARS
func _cars() -> void:
	var cars := []
	for sx in [-1.0, 1.0]:
		var k := 0; var y := -19.5
		while y < LOT_EDGE - STALL_W:
			if hash_(k * 7.3 + sx * 3.3) >= 0.38:
				cars.append([sx * (STALL_IN + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y + STALL_W / 2.0, sx, k])
			y += STALL_W; k += 1
	for y in [-17.6, -20.1]:
		for x in [-5.0, 0.0, 5.0]:
			var k := 40 + JsMath.js_round(x + y * 3.0)
			if hash_(k * 2.9) < 0.2: continue
			cars.append([x + (hash_(k * 1.3) - 0.5) * 0.4, y, -1.0 if x < 0 else 1.0, k])
	if preset.detail > 1:
		for sx in [-1.0, 1.0]:
			var k := 100; var y := -19.5
			while y < LOT_EDGE - STALL_W:
				if hash_(k * 2.7 + sx) >= 0.45:
					cars.append([sx * (16.0 + 0.5 + 2.15 + hash_(k * 1.9) * 0.3), y + STALL_W / 2.0, -sx, k])
				y += STALL_W; k += 1
	var meshes := []
	for p in CAR_MESHES:
		var scn: PackedScene = load(p)
		meshes.append(scn)
	var shader: Shader = load("res://game/shaders/car_paint.gdshader")
	var paints := {}
	var tyre := mat(Color(0.012, 0.012, 0.012), 0.8)
	var head := glow_mat(Color(1.0, 0.95, 0.85), 2.5)
	var tail := glow_mat(Color(1.0, 0.05, 0.05), 1.6)
	for c in cars:
		var kk: float = c[3]
		var sx: float = c[2]
		var kind := int(hash_(kk * 4.3 + sx) * 3.0)
		var hexc: String = PALETTE[int(hash_(kk * 3.7 + sx) * PALETTE.size())]
		if not paints.has(hexc):
			var pm := ShaderMaterial.new(); pm.shader = shader
			pm.set_shader_parameter("paint", Color(hexc) * 1.6)
			paints[hexc] = pm
		var root := Node3D.new()
		root.position = gv(c[0], c[1], 0.0)
		# nose towards the court (local +x is the nose)
		root.rotation.y = (PI if sx > 0 else 0.0) + (hash_(kk * 6.1) - 0.5) * 0.06
		add_child(root)
		var body: Node3D = meshes[kind].instantiate()
		root.add_child(body)
		for mi in body.find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).material_override = paints[hexc]
		var zc := 0.38 if kind == 2 else 0.34
		var width: float = [1.8, 1.78, 1.9][kind]
		if preset.detail > 0:
			for wx in [-1.35, 1.35]:
				for wy in [-1.0, 1.0]:
					var t := MeshInstance3D.new()
					var cm := CylinderMesh.new(); cm.top_radius = zc; cm.bottom_radius = zc; cm.height = 0.22; cm.radial_segments = 14
					t.mesh = cm; t.material_override = tyre
					t.position = Vector3(wx, zc, -wy * (width / 2.0 - 0.13)); t.rotation.x = PI / 2
					root.add_child(t)
		var xf: float = [2.24, 2.09, 2.3][kind]
		var hz := 0.66 + (0.12 if kind == 2 else 0.0)
		for wy in [-1.0, 1.0]:
			var h := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(0.1, 0.08, 0.36)
			h.mesh = bm; h.material_override = head; h.position = Vector3(xf - 0.05, hz, -wy * (width / 2.0 - 0.12))
			root.add_child(h)
		var tl := MeshInstance3D.new(); var tb := BoxMesh.new(); tb.size = Vector3(0.08, 0.06, width - 0.3)
		tl.mesh = tb; tl.material_override = tail; tl.position = Vector3(-xf + 0.02, 0.81 + (0.1 if kind == 2 else 0.0), 0)
		root.add_child(tl)
		# underglow, pink or cyan as in the game
		var ug := OmniLight3D.new()
		ug.light_color = Color("#ff3fb4") if hash_(kk * 5.1) > 0.5 else Color("#25d9ff")
		ug.light_energy = 1.6
		ug.omni_range = 2.6
		ug.position = Vector3(0, 0.15, 0)
		root.add_child(ug)
		glow_lights.append(ug)


func _parapets() -> void:
	var conc := mat(Color("#2e2e36"), 0.85)
	var strip := glow_mat(Color("#25d9ff"), 2.0)
	box(Vector3(-LOT_X, LOT_EDGE, 0.0), Vector3(LOT_X, LOT_EDGE + 0.3, 1.0), conc)
	box(Vector3(-LOT_X, LOT_EDGE - 0.03, 0.97), Vector3(LOT_X, LOT_EDGE, 1.0), strip)
	box(Vector3(-LOT_X, LOT_BACK - 0.3, 0.0), Vector3(LOT_X, LOT_BACK, 1.0), conc)
	box(Vector3(-LOT_X, LOT_BACK, 0.97), Vector3(LOT_X, LOT_BACK + 0.03, 1.0), strip)
	for sx in [-1.0, 1.0]:
		box(Vector3(sx * LOT_X - (0.3 if sx > 0 else 0.0), LOT_BACK, 0.0), Vector3(sx * LOT_X + (0.0 if sx > 0 else 0.3), LOT_EDGE, 1.0), conc)
	if preset.detail > 0:
		# stair tower with an exit sign, AC units, bollards
		box(Vector3(17.0, 8.0, 0.0), Vector3(23.0, 14.5, 4.2), conc)
		box(Vector3(18.7, 7.95, 2.35), Vector3(19.5, 7.98, 2.6), glow_mat(Color(0.05, 1.0, 0.25), 2.0))
		var hv := mat(Color(0.25, 0.26, 0.28), 0.5, 0.6)
		for h in [[-20.0, 12.5], [-23.5, 12.5], [24.0, -16.0]]:
			box(Vector3(h[0] - 1.4, h[1] - 1.0, 0.15), Vector3(h[0] + 1.4, h[1] + 1.0, 1.6), hv)
		var bol := mat(Color(0.85, 0.55, 0.02), 0.5)
		var led := glow_mat(Color("#ff3fb4"), 2.5)
		for b in [[-7.0, -14.6], [7.0, -14.6], [-7.0, 14.6], [7.0, 14.6], [-7.0, 0.0], [7.0, 0.0]]:
			cyl(b[0], b[1], 0.0, 1.0, 0.1, bol)
			cyl(b[0], b[1], 1.0, 0.02, 0.1, led)


# ---------------------------------------------------------------- the billboard (BOARD in render.js)
var board_label: Label3D

func _billboard() -> void:
	var root := Node3D.new()
	root.position = gv(-6.0, 40.0, 0.0)
	root.rotation.y = 0.4   # (turned in towards the court, far end to the right)
	add_child(root)
	var metal := mat(Color("#1c1b2a"), 0.4, 0.7)
	var pylon := MeshInstance3D.new(); var pm := CylinderMesh.new()
	pm.top_radius = 0.5; pm.bottom_radius = 0.5; pm.height = 5.5 + DROP
	pylon.mesh = pm; pylon.material_override = metal; pylon.position = Vector3(0, (5.5 - DROP) / 2.0, -0.6)
	root.add_child(pylon)
	var panel := MeshInstance3D.new(); var bm := BoxMesh.new(); bm.size = Vector3(17.0, 5.2, 0.3)
	panel.mesh = bm; panel.material_override = mat(Color("#080616"), 0.5); panel.position = Vector3(0, 5.5 + 2.6, -0.35)
	root.add_child(panel)
	var frame := glow_mat(Color("#ff3fb4"), 3.0)
	for f in [[0.0, 5.76, 16.6, 0.12], [0.0, 10.44, 16.6, 0.12], [-8.24, 8.1, 0.12, 4.8], [8.24, 8.1, 0.12, 4.8]]:
		var fm := MeshInstance3D.new(); var fb := BoxMesh.new(); fb.size = Vector3(f[2], f[3], 0.08)
		fm.mesh = fb; fm.material_override = frame; fm.position = Vector3(f[0], f[1], -0.15)
		root.add_child(fm)
	board_label = Label3D.new()
	board_label.text = "HHORNS"
	board_label.font_size = 420
	board_label.pixel_size = 0.0085
	board_label.modulate = Color(0.15, 0.85, 1.0) * 2.4
	board_label.outline_size = 0
	board_label.position = Vector3(0, 8.1, -0.1)
	board_label.shaded = false
	root.add_child(board_label)


func flash_board(text: String, color: Color) -> void:
	board_label.text = text
	board_label.modulate = color * 2.4


func reset_board() -> void:
	board_label.text = "HHORNS"
	board_label.modulate = Color(0.15, 0.85, 1.0) * 2.4


# ---------------------------------------------------------------- skyline
func _skyline() -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = BoxMesh.new()
	var rng := RandomNumberGenerator.new()
	rng.seed = 4
	var xf := []
	var count: int = preset.towers
	while xf.size() < count:
		var ang := rng.randf_range(-1.25, 1.25) if rng.randf() < 0.75 else rng.randf_range(1.25, 2.6) * (1.0 if rng.randf() < 0.5 else -1.0)
		var dist := rng.randf_range(220.0, 700.0)
		var x := dist * sin(ang); var y := dist * cos(ang)
		var h := rng.randf_range(10.0, 45.0) * (1.6 if dist > 420.0 else 1.0) * (1.5 if rng.randf() > 0.88 else 1.0)
		var w := rng.randf_range(18.0, 40.0); var d := rng.randf_range(18.0, 40.0)
		var b := Basis(Vector3.UP, rng.randf_range(-0.2, 0.2)).scaled(Vector3(w, h + DROP, d))
		xf.append(Transform3D(b, gv(x, y, (h - DROP) / 2.0)))
	mm.instance_count = xf.size()
	for i in xf.size():
		mm.set_instance_transform(i, xf[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	var sm := ShaderMaterial.new()
	sm.shader = load("res://game/shaders/towers.gdshader")
	mmi.material_override = sm
	add_child(mmi)
	var street := mat(Color(0.01, 0.01, 0.012), 0.3)
	box(Vector3(-900, -600, -DROP - 0.1), Vector3(900, 900, -DROP), street)
