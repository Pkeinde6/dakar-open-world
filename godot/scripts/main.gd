# Prototype Godot : un quartier reel de Dakar (Place de l'Independance) construit depuis OpenStreetMap,
# soleil et ciel HDR, une voiture a suspension, un avatar a pied qui monte en voiture avec F.
# Lancer avec --capture=<fichier.png> pour enregistrer une image et quitter.
extends Node3D

const PAL := [Color("e9d7a8"), Color("dcb47c"), Color("f2ece0"), Color("e3c48f"), Color("c98f6a"), Color("f0e6d2"), Color("d7cfc0"), Color("bfcfd6")]
const SHUTTERS := [Color("2f6b43"), Color("2a5d8f"), Color("6b4a2a"), Color("8a8f99")]
var data: Dictionary
var car: VehicleBody3D
var avatar: CharacterBody3D
var cam: Camera3D
var driving := false
var capture := ""
var frames := 0

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--capture="): capture = a.substr(10)
	data = JSON.parse_string(FileAccess.get_file_as_string("res://data/quartier.json"))
	_environment()
	_ground()
	_roads()
	_buildings()
	_greenery()
	car = preload("res://scripts/car.gd").new(); add_child(car); car.setup("res://models/corolla_roues.glb", Color("f2c200"))
	car.global_position = _spawn_point() + Vector3(0, 0.6, 0)
	avatar = preload("res://scripts/avatar.gd").new(); add_child(avatar)
	avatar.setup("res://models/mixamo/leonard.fbx", {"Idle": "res://models/mixamo/idle.fbx", "Run": "res://models/mixamo/running.fbx", "Enter": "res://models/mixamo/entering_car.fbx"})
	avatar.global_position = car.global_position + car.global_basis.x * 2.6
	_passersby()
	cam = Camera3D.new(); cam.fov = 60; cam.far = 1500; add_child(cam)

func _environment() -> void:
	var env := Environment.new()
	var sky := Sky.new(); var pano := PanoramaSkyMaterial.new(); pano.panorama = load("res://textures/kloofendal_48d_partly_cloudy_puresky.hdr"); sky.sky_material = pano
	env.background_mode = Environment.BG_SKY; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX; env.tonemap_exposure = 1.0
	env.ssao_enabled = true; env.ssao_radius = 1.5; env.ssao_intensity = 2.0
	env.ssil_enabled = true; env.glow_enabled = true; env.glow_intensity = 0.4
	env.fog_enabled = true; env.fog_light_color = Color("e8dcc8"); env.fog_density = 0.0005; env.fog_aerial_perspective = 0.15 # brume de poussiere
	env.adjustment_enabled = true; env.adjustment_saturation = 1.08
	var we := WorldEnvironment.new(); we.environment = env; add_child(we)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-38, -35, 0); sun.light_energy = 2.2; sun.light_color = Color("fff2dc")
	sun.shadow_enabled = true; sun.directional_shadow_max_distance = 220; sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS; add_child(sun)

func _mat(tex: String, col: Color, scale: float, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new(); m.albedo_texture = load(tex); m.albedo_color = col; m.roughness = rough
	m.uv1_triplanar = true; m.uv1_world_triplanar = true; m.uv1_scale = Vector3.ONE / scale; m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

func _static(mesh: Mesh, mat: Material, collide := true) -> void:
	var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = mat; add_child(mi)
	if collide:
		var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); cs.shape = mesh.create_trimesh_shape(); body.add_child(cs); add_child(body)

func _ground() -> void:
	var p := PlaneMesh.new(); p.size = Vector2(1600, 1600)
	_static(p, _mat("res://textures/sand_02_diff.jpg", Color(1.0, 0.97, 0.92), 6.0))

# ribbon along a polyline at height y, half width hw
func _ribbon(st: SurfaceTool, pts: Array, hw: float, y: float) -> void:
	for i in pts.size() - 1:
		var a := Vector3(pts[i][0], y, pts[i][1]); var b := Vector3(pts[i + 1][0], y, pts[i + 1][1])
		var d := (b - a); if d.length() < 0.01: continue
		var n := Vector3(-d.z, 0, d.x).normalized() * hw
		for v in [a - n, b - n, b + n, a - n, b + n, a + n]: st.add_vertex(v)
		# rounded joint: a small fan at b so bends have no gaps
		for k in 8:
			var a0 := TAU * k / 8.0; var a1 := TAU * (k + 1) / 8.0
			for v in [b, b + Vector3(cos(a1), 0, sin(a1)) * hw, b + Vector3(cos(a0), 0, sin(a0)) * hw]: st.add_vertex(v)

func _roads() -> void:
	var road := SurfaceTool.new(); road.begin(Mesh.PRIMITIVE_TRIANGLES)
	var walk := SurfaceTool.new(); walk.begin(Mesh.PRIMITIVE_TRIANGLES)
	var marks := SurfaceTool.new(); marks.begin(Mesh.PRIMITIVE_TRIANGLES)
	for r in data.roads:
		_ribbon(road, r.pts, r.w / 2.0, 0.05)
		if r.side > 0.5: _ribbon(walk, r.pts, r.w / 2.0 + r.side, 0.03)
		if r.t <= 4: # tirets blancs au milieu
			for i in r.pts.size() - 1:
				var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
				var dd := 0.0
				while dd + 3.0 < L:
					var p0 := a.lerp(b, dd / L); var p1 := a.lerp(b, (dd + 3.0) / L)
					_ribbon(marks, [[p0.x, p0.y], [p1.x, p1.y]], 0.08, 0.065); dd += 9.0
	for st in [road, walk, marks]: st.generate_normals()
	_static(road.commit(), _mat("res://textures/worn_asphalt_diff.jpg", Color(1.25, 1.32, 1.45), 5.0, 0.85))
	_static(walk.commit(), _mat("res://textures/interlocking_concrete_pavers_diff.jpg", Color(1.25, 1.55, 1.75), 2.5))
	var mm := StandardMaterial3D.new(); mm.albedo_color = Color(0.95, 0.95, 0.92); _static(marks.commit(), mm, false)

func _buildings() -> void:
	var shader := load("res://shaders/facade.gdshader")
	var tex := load("res://textures/worn_plaster_wall_diff.jpg")
	var rng := RandomNumberGenerator.new(); rng.seed = 221
	for b in data.buildings:
		var pts := PackedVector2Array(); for p in b.pts: pts.append(Vector2(p[0], p[1]))
		if pts.size() < 3 or absf(_area(pts)) < 15: continue
		var h: float = b.h if b.h > 0 else 3.1 * rng.randi_range(2, 5)
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var cw := _area(pts) > 0
		for i in pts.size():
			var a := pts[i]; var c := pts[(i + 1) % pts.size()]
			var v := [Vector3(a.x, 0, a.y), Vector3(c.x, 0, c.y), Vector3(c.x, h, c.y), Vector3(a.x, h, a.y)]
			for k in ([0, 2, 1, 0, 3, 2] if cw else [0, 1, 2, 0, 2, 3]): st.add_vertex(v[k])
		var tri := Geometry2D.triangulate_polygon(pts)
		for k in range(0, tri.size(), 3):
			var t := [tri[k], tri[k + 1], tri[k + 2]] if cw else [tri[k], tri[k + 2], tri[k + 1]]
			for j in t: st.add_vertex(Vector3(pts[j].x, h, pts[j].y))
		st.generate_normals()
		var m := ShaderMaterial.new(); m.shader = shader; m.set_shader_parameter("plaster", tex)
		m.set_shader_parameter("tint", (Color("f4f1ea") if b.mosque else PAL[rng.randi() % PAL.size()])); m.set_shader_parameter("shutter", SHUTTERS[rng.randi() % SHUTTERS.size()])
		_static(st.commit(), m)
		# acrotere : petit muret autour du toit-terrasse
		var rim := SurfaceTool.new(); rim.begin(Mesh.PRIMITIVE_TRIANGLES)
		for i in pts.size():
			var a := pts[i]; var c := pts[(i + 1) % pts.size()]
			var v := [Vector3(a.x, h, a.y), Vector3(c.x, h, c.y), Vector3(c.x, h + 0.6, c.y), Vector3(a.x, h + 0.6, a.y)]
			for k in [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]: rim.add_vertex(v[k])
		rim.generate_normals(); _static(rim.commit(), m, false)

func _area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size(): s += p[i].x * p[(i + 1) % p.size()].y - p[(i + 1) % p.size()].x * p[i].y
	return s / 2.0

func _greenery() -> void:
	var grass := StandardMaterial3D.new(); grass.albedo_texture = load("res://textures/sand_02_diff.jpg"); grass.albedo_color = Color(0.55, 0.72, 0.35); grass.uv1_triplanar = true; grass.uv1_world_triplanar = true; grass.uv1_scale = Vector3.ONE / 6
	var trunk := StandardMaterial3D.new(); trunk.albedo_color = Color("6b5440"); trunk.roughness = 1
	var leaf := StandardMaterial3D.new(); leaf.albedo_color = Color("4f7a34"); leaf.roughness = 1
	var rng := RandomNumberGenerator.new(); rng.seed = 7
	var tm := CylinderMesh.new(); tm.top_radius = 0.22; tm.bottom_radius = 0.35; tm.height = 4.0
	var cm := SphereMesh.new(); cm.radius = 3.2; cm.height = 4.6
	for poly in data.parks + data.places.map(func(p): return p.pts):
		var pts := PackedVector2Array(); for p in poly: pts.append(Vector2(p[0], p[1]))
		var tri := Geometry2D.triangulate_polygon(pts); if tri.is_empty(): continue
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var flip := _area(pts) > 0
		for k in range(0, tri.size(), 3):
			for j in ([tri[k], tri[k + 2], tri[k + 1]] if flip else [tri[k], tri[k + 1], tri[k + 2]]): st.add_vertex(Vector3(pts[j].x, 0.04, pts[j].y))
		st.generate_normals(); _static(st.commit(), grass, false)
		var r := Rect2(pts[0], Vector2.ZERO); for p in pts: r = r.expand(p)
		for n in int(clamp(absf(_area(pts)) / 140.0, 2, 80)): # neems d'ombre
			var q := Vector2(rng.randf_range(r.position.x, r.end.x), rng.randf_range(r.position.y, r.end.y))
			if not Geometry2D.is_point_in_polygon(q, pts): continue
			var t := MeshInstance3D.new(); t.mesh = tm; t.material_override = trunk; t.position = Vector3(q.x, 2.0, q.y); add_child(t)
			var c := MeshInstance3D.new(); c.mesh = cm; c.material_override = leaf; var s := rng.randf_range(0.8, 1.3); c.scale = Vector3(s, s * 0.85, s); c.position = Vector3(q.x, 5.6 * s, q.y); add_child(c)

func _spawn_point() -> Vector3:
	var best: Vector3 = Vector3.ZERO; var bd := 1e9
	for r in data.roads:
		if r.t > 4: continue
		for p in r.pts:
			var d := Vector2(p[0], p[1]).length()
			if d < bd:
				bd = d; best = Vector3(p[0], 0, p[1])
	return best

func _passersby() -> void:
	var models := ["res://models/gens_boubou.glb", "res://models/gens_drianke.glb", "res://models/gens_vendeuse.glb", "res://models/gens_jeune.glb"]
	var rng := RandomNumberGenerator.new(); rng.seed = 3
	var roads: Array = data.roads.filter(func(r): return r.side > 1.0 and r.pts.size() > 1)
	for i in 24:
		var r: Dictionary = roads[rng.randi() % roads.size()]
		var npc := preload("res://scripts/passant.gd").new(); add_child(npc)
		npc.setup(models[i % models.size()], r, rng.randf_range(0, 1), 1 if rng.randf() < 0.5 else -1)

func _physics_process(_dt: float) -> void:
	if Input.is_key_pressed(KEY_F) and not _f_held:
		_f_held = true
		if driving: _leave_car()
		elif avatar.global_position.distance_to(car.global_position) < 4.0: _enter_car()
	elif not Input.is_key_pressed(KEY_F): _f_held = false
var _f_held := false

func _enter_car() -> void:
	driving = true; car.driven = false
	var t: float = avatar.enter_car() # il ouvre la portiere et s'assoit, puis on prend le volant
	avatar.look_at(car.global_position, Vector3.UP, true)
	await get_tree().create_timer(t).timeout
	if not driving: return
	avatar.visible = false; avatar.process_mode = Node.PROCESS_MODE_DISABLED; car.driven = true
func _leave_car() -> void:
	driving = false; car.driven = false; avatar.global_position = car.global_position + car.global_basis.x * 2.2 + Vector3.UP * 0.5
	avatar.visible = true; avatar.process_mode = Node.PROCESS_MODE_INHERIT

func _process(dt: float) -> void:
	var target: Node3D = car if driving else avatar
	var back := 9.0 if driving else 4.2; var up := 3.6 if driving else 2.0
	var fwd := target.global_basis.z; fwd.y = 0; fwd = fwd.normalized()
	var want := target.global_position - fwd * back + Vector3.UP * up
	var look := target.global_position + Vector3.UP * 1.2
	if capture != "":
		cam.global_position = avatar.global_position + Vector3(-2.2, 1.7, -3.2); look = avatar.global_position + Vector3.UP * 1.1
	elif frames > 2: cam.global_position = cam.global_position.lerp(want, clamp(dt * 5.0, 0, 1))
	else: cam.global_position = want
	cam.look_at(look)
	frames += 1
	if capture != "" and frames == 90:
		get_viewport().get_texture().get_image().save_png(capture); get_tree().quit()
