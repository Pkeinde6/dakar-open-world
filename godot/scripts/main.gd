# Dakar Open World, version Godot : tout Dakar, construit par tuiles de 400 m autour du joueur (scripts/quartier.gd),
# dans un fil a part pour ne pas bloquer le jeu. Ici : lumiere, sol, mer, voiture, avatar qui monte en voiture (F),
# trafic, mini-carte, qualite qui s'adapte a l'ordinateur.
# Lancer avec --capture=<fichier.png> [--vue=ville|ciel] pour enregistrer une image une fois les tuiles proches construites.
extends Node3D

const Quartier := preload("res://scripts/quartier.gd")
const RAYON := 1 # tuiles construites autour du joueur (1 = carre de 3 x 3 tuiles, 1,2 km)
var monde: Dictionary
var data := {"roads": [], "signals": [], "fuel": [], "coast": [], "coastClose": []} # tout ce qui est charge (trafic, carte)
var tiles := {} # "x_z" -> Quartier construit
var pending := {} # "x_z" -> true pendant la construction
var known := {} # tuiles qui existent dans les donnees
var building := false
var loading := {} # "x_z" -> chemin de la scene pre-construite en cours de chargement
var car: VehicleBody3D
var avatar: CharacterBody3D
var cam: Camera3D
var driving := false
var capture := ""
var view := "ville"
var lieu := ""
var carte
var missions
var frames := 0
var ready_frames := -1
var fps_label: Label
var hint: Label
var hint_box: PanelContainer
var trafic
var water: StandardMaterial3D
var clock := 0.0
var sun: DirectionalLight3D
var level := 2 # qualite auto : 0 tres bas ... 3 haut
var fps_acc := 0.0
var fps_n := 0
var outil # un Quartier hors scene, pour ses fonctions utilitaires (materiaux, personnages)
var ville # ville.gd du quartier sous le joueur (feux tricolores pour le trafic)
var ground: MeshInstance3D

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--capture="): capture = a.substr(10)
		if a.begins_with("--vue="): view = a.substr(6)
		if a.begins_with("--lieu="): lieu = a.substr(7)
	monde = JSON.parse_string(FileAccess.get_file_as_string("res://data/monde.json"))
	for k in monde.tiles: known[k] = true
	data.coast = monde.coast; data.coastClose = monde.coastClose
	outil = Quartier.new()
	_environment()
	_ground()
	var sea_maker = preload("res://scripts/ville.gd").new(self, data); sea_maker.sea()
	var sp := Vector2(monde.spawn[0], monde.spawn[1])
	if lieu != "": # --lieu=lat,lon : demarrer a un endroit precis (meme projection que data.js, origine 14.67, -17.44)
		var ll := lieu.split(","); var KX := 111320.0 * cos(deg_to_rad(14.67))
		sp = Vector2((float(ll[1]) + 17.44) * KX, -(float(ll[0]) - 14.67) * 110540.0)
	_load_now(_tile_of(sp)) # la tuile du depart tout de suite, les voisines en fond
	car = preload("res://scripts/car.gd").new(); add_child(car); car.setup("res://models/corolla_roues.glb", Color("f2c200"))
	var t := _spawn_point(sp); car.global_position = t.origin + Vector3(0, 0.6, 0); car.global_basis = t.basis
	avatar = preload("res://scripts/avatar.gd").new(); add_child(avatar)
	avatar.setup("res://models/mixamo/leonard.fbx", {"Idle": "res://models/mixamo/idle.fbx", "Run": "res://models/mixamo/running.fbx", "Enter": "res://models/mixamo/entering_car.fbx"})
	avatar.global_position = car.global_position + car.global_basis.x * 2.6
	trafic = preload("res://scripts/trafic.gd").new(); add_child(trafic); trafic.setup(self, data, 18)
	_passersby()
	cam = Camera3D.new(); cam.fov = 60; cam.far = 900; add_child(cam)
	var UI := preload("res://scripts/ui.gd")
	var hud := CanvasLayer.new(); add_child(hud); fps_label = UI.label("", 15, Color(1, 1, 1, 0.85)); fps_label.position = Vector2(14, 10); fps_label.visible = false; hud.add_child(fps_label) # F3 pour l'afficher
	var mini := preload("res://scripts/minimap.gd").new(); hud.add_child(mini); mini.setup(self, data)
	carte = preload("res://scripts/carte.gd").new(); hud.add_child(carte); carte.setup(self, monde)
	missions = preload("res://scripts/missions.gd").new(); add_child(missions); missions.setup(self, monde, hud)
	var credit: Label = UI.label("© OpenStreetMap · Google Open Buildings (CC BY 4.0)", 11, Color(1, 1, 1, 0.55))
	credit.anchor_left = 1; credit.anchor_right = 1; credit.anchor_top = 1; credit.anchor_bottom = 1; credit.offset_left = -330; credit.offset_top = -20; hud.add_child(credit)
	hint_box = UI.panel(0.72, 22, 18); hint_box.anchor_left = 0.5; hint_box.anchor_right = 0.5; hint_box.anchor_top = 1; hint_box.anchor_bottom = 1; hint_box.grow_horizontal = Control.GROW_DIRECTION_BOTH; hint_box.offset_top = -86; hint_box.visible = false
	hint = UI.label("", 20); hint_box.add_child(hint); hud.add_child(hint_box)

# ---------------------------------------------------------------- tuiles
func _tile_of(p: Vector2) -> String: return "%d_%d" % [floori(p.x / monde.tile), floori(p.y / monde.tile)]
func _read(k: String) -> Dictionary:
	if not known.has(k): return {}
	return JSON.parse_string(FileAccess.get_file_as_string("res://data/tuiles/%s.json" % k))

func _make(k: String, slow := false) -> Node3D: # construit la tuile k ; slow : etape par etape sur plusieurs images
	var d := _read(k); var xy := k.split("_"); var tx := int(xy[0]); var tz := int(xy[1]); var ctx := []; var near_b := []
	for a in range(-1, 2):
		for b in range(-1, 2):
			if a == 0 and b == 0: continue
			var nd := _read("%d_%d" % [tx + a, tz + b]); ctx.append_array(nd.get("roads", [])); near_b.append_array(nd.get("buildings", []))
	var q := Quartier.new(); q.key = k; q.neighbours = near_b; q.set_meta("data", d)
	if slow: await q.build(d, ctx, tx, tz, monde.tile, get_tree())
	else: q.build(d, ctx, tx, tz, monde.tile)
	return q

func _load_now(k: String) -> void:
	if not known.has(k): return
	var cuit := "res://cuit/%s.scn" % k
	if ResourceLoader.exists(cuit): # tuile du depart pre-construite : chargee tout de suite
		var q: Node3D = (load(cuit) as PackedScene).instantiate(); q.key = k; q.set_meta("data", _read(k)); _attach(q)
	else: _attach(await _make(k))

func _attach(q: Node3D) -> void:
	add_child(q); tiles[q.key] = q; pending.erase(q.key); building = false
	var feux := {} # materiaux des feux tricolores de la tuile : "Ar", "Bg"...
	for n in q.find_children("*", "MeshInstance3D", true, false):
		if n.has_meta("feu"): feux[n.material_override] = n.get_meta("feu")
	q.set_meta("feux", feux); _refresh_data()

func _refresh_data() -> void: # routes, feux, stations des tuiles chargees : pour le trafic et la mini-carte
	data.roads.clear(); data.signals.clear(); data.fuel.clear()
	for q in tiles.values():
		var d: Dictionary = q.get_meta("data")
		data.roads.append_array(d.get("roads", [])); data.signals.append_array(d.get("signals", [])); data.fuel.append_array(d.get("fuel", []))
	if trafic: trafic.rebuild()

func _stream() -> void:
	var pl: Node3D = car if driving else avatar
	if pl == null: return
	var c := Vector2(pl.global_position.x, pl.global_position.z); var me := _tile_of(c); var xy := me.split("_"); var tx := int(xy[0]); var tz := int(xy[1])
	if tiles.has(me): ville = tiles[me].ville
	for k in tiles.keys(): # tuiles trop loin : on les defait (marge d'une tuile pour ne pas clignoter)
		var kxy: PackedStringArray = k.split("_")
		if absi(int(kxy[0]) - tx) > RAYON + 1 or absi(int(kxy[1]) - tz) > RAYON + 1:
			tiles[k].queue_free(); tiles.erase(k); _refresh_data()
	if building: return
	var best := ""; var bd := 1e9
	for a in range(-RAYON, RAYON + 1): # la plus proche d'abord
		for b in range(-RAYON, RAYON + 1):
			var k := "%d_%d" % [tx + a, tz + b]
			if tiles.has(k) or pending.has(k) or not known.has(k): continue
			var d := Vector2(a, b).length()
			if d < bd: bd = d; best = k
	if best == "": return
	building = true; pending[best] = true
	var cuit := "res://cuit/%s.scn" % best
	if ResourceLoader.exists(cuit): # tuile pre-construite (tools/precuire.gd) : chargee en arriere-plan, sans calcul
		ResourceLoader.load_threaded_request(cuit, "PackedScene", true); loading[best] = cuit
	else: _attach(await _make(best, true)) # sinon construite ici, etape par etape (depuis un autre fil, chaque appel a Godot attend l'image suivante)

func _poll_loads() -> void: # tuiles pre-construites dont le chargement est fini : on les pose
	for k in loading.keys():
		var st := ResourceLoader.load_threaded_get_status(loading[k])
		if st == ResourceLoader.THREAD_LOAD_IN_PROGRESS: continue
		var path: String = loading[k]; loading.erase(k)
		if st != ResourceLoader.THREAD_LOAD_LOADED: print("tuile %s : chargement rate (%d)" % [k, st]); building = false; pending.erase(k); continue
		var q: Node3D = (ResourceLoader.load_threaded_get(path) as PackedScene).instantiate()
		q.key = k; q.set_meta("data", _read(k)); _attach(q)

# ---------------------------------------------------------------- lumiere, sol
func _environment() -> void:
	var env := Environment.new()
	var sky := Sky.new(); var pano := PanoramaSkyMaterial.new(); pano.panorama = load("res://textures/kloofendal_48d_partly_cloudy_puresky.hdr"); sky.sky_material = pano
	env.background_mode = Environment.BG_SKY; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY; env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.glow_enabled = true; env.glow_intensity = 0.4
	env.fog_enabled = true; env.fog_light_color = Color("e8dcc8"); env.fog_density = 0.0009; env.fog_aerial_perspective = 0.15 # la brume cache le bord des tuiles
	env.adjustment_enabled = true; env.adjustment_saturation = 1.18
	var we := WorldEnvironment.new(); we.environment = env; add_child(we)
	sun = DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-38, -35, 0); sun.light_energy = 2.2; sun.light_color = Color("fff2dc")
	sun.shadow_enabled = true; sun.directional_shadow_max_distance = 110; sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS; add_child(sun)

func _ground() -> void: # un grand sol qui suit le joueur (sable, herbe seche, terre melanges)
	var p := PlaneMesh.new(); p.size = Vector2(6000, 6000)
	var m := ShaderMaterial.new(); m.shader = load("res://shaders/sol.gdshader"); m.set_shader_parameter("sand_tex", load("res://textures/sand_02_diff.jpg"))
	var nt := NoiseTexture2D.new(); nt.width = 512; nt.height = 512; nt.seamless = true; var fn := FastNoiseLite.new(); fn.frequency = 0.012; fn.fractal_octaves = 4; nt.noise = fn
	m.set_shader_parameter("noise_tex", nt)
	ground = MeshInstance3D.new(); ground.mesh = p; ground.material_override = m; add_child(ground)
	var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); cs.shape = WorldBoundaryShape3D.new(); body.add_child(cs); add_child(body)

# utilitaires demandes par ville.gd pour la mer
func _area(p: PackedVector2Array) -> float: return outil._area(p)
func _mat(tex: String, col: Color, scale: float, rough := 0.9) -> StandardMaterial3D: return outil._mat(tex, col, scale, rough)

func _passersby() -> void:
	var rng := RandomNumberGenerator.new(); rng.seed = 3
	var roads: Array = data.roads.filter(func(r): return r.side > 1.0 and r.y == null and r.pts.size() > 1)
	if roads.is_empty(): return
	var tops := [Color("1f4fa0"), Color("8a1c2b"), Color("0f6b4a"), Color("f2f0ea"), Color("d9b44a"), Color("5b2a86"), Color("c96a1b")]
	for i in 6: # chaque passant Mixamo est lourd (65 os, 50 000 triangles)
		var r: Dictionary = roads[rng.randi() % roads.size()]
		var who: Node3D = outil._person({"Body": [Color(0.3, 0.18, 0.12), Color(0.36, 0.22, 0.15), Color(0.42, 0.27, 0.18)][i % 3], "Sweater": tops[rng.randi() % tops.size()], "Pants": [Color("2c4a73"), Color("222222"), Color("c8b27a"), Color("f2f0ea")][rng.randi() % 4], "Hair": Color(0.08, 0.06, 0.05)})
		var npc := preload("res://scripts/passant.gd").new(); add_child(npc); npc.setup_node(who, r, rng.randf(), 1 if rng.randf() < 0.5 else -1)

# ---------------------------------------------------------------- jeu
func _spawn_point(near: Vector2) -> Transform3D:
	var best := Transform3D(Basis(), Vector3(near.x, 0, near.y)); var bd := 1e9
	for r in data.roads:
		if r.t > 4 or r.y != null: continue
		for i in r.pts.size() - 1:
			var p := Vector2(r.pts[i][0], r.pts[i][1]); var d := p.distance_to(near)
			if d < bd:
				bd = d; var q := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var dir := (q - p).normalized(); var n := Vector2(-dir.y, dir.x)
				var c: Vector2 = p.lerp(q, 0.5) + n * (r.w / 2.0 - 1.2) # garee le long du trottoir, pas en travers de la voie
				best = Transform3D(Basis(Vector3.UP, atan2(dir.x, dir.y)), Vector3(c.x, 0, c.y))
	return best

var _f_held := false
func _unhandled_input(e: InputEvent) -> void:
	if e is InputEventKey and e.pressed and e.keycode == KEY_F3: fps_label.visible = not fps_label.visible
	if e is InputEventKey and e.pressed and not e.echo and (e.keycode == KEY_M or (e.keycode == KEY_ESCAPE and carte.visible)): carte.toggle()
func _physics_process(_dt: float) -> void:
	if Input.is_key_pressed(KEY_F) and not _f_held:
		_f_held = true
		if driving: _leave_car()
		elif avatar.global_position.distance_to(car.global_position) < 4.0: _enter_car()
	elif not Input.is_key_pressed(KEY_F): _f_held = false

func teleport(p: Vector2) -> void: # double-clic sur la grande carte : la voiture (ou le pieton) sur la rue la plus proche
	if not tiles.has(_tile_of(p)): await _load_now(_tile_of(p)) # la tuile d'arrivee d'abord, pour y trouver une rue
	var t := _spawn_point(p)
	if driving:
		car.global_transform = Transform3D(t.basis, t.origin + Vector3.UP * 1.0); car.linear_velocity = Vector3.ZERO; car.angular_velocity = Vector3.ZERO
	else: avatar.global_position = t.origin + Vector3.UP * 0.5

func _enter_car() -> void:
	driving = true; car.driven = false
	avatar.look_at(car.global_position, Vector3.UP, true)
	var t: float = avatar.enter_car() # il ouvre la portiere et s'assoit, puis on prend le volant
	await get_tree().create_timer(t).timeout
	if not driving: return
	avatar.visible = false; avatar.process_mode = Node.PROCESS_MODE_DISABLED; car.driven = true
func _leave_car() -> void:
	driving = false; car.driven = false; avatar.global_position = car.global_position + car.global_basis.x * 2.2 + Vector3.UP * 0.5
	avatar.visible = true; avatar.process_mode = Node.PROCESS_MODE_INHERIT

func _process(dt: float) -> void:
	_poll_loads()
	_stream()
	var target: Node3D = car if driving else avatar
	ground.global_position = Vector3(snappedf(target.global_position.x, 50), 0, snappedf(target.global_position.z, 50))
	var back := 9.0 if driving else 4.2; var up := 3.6 if driving else 2.0
	var fwd := target.global_basis.z; fwd.y = 0; fwd = fwd.normalized()
	var want := target.global_position - fwd * back + Vector3.UP * up
	var look := target.global_position + Vector3.UP * 1.2
	if capture != "":
		var v := _capture_view(); cam.global_position = v[0]; look = v[1]
	else:
		# un mur entre la voiture et la camera : la camera se rapproche (sinon elle passe dans les immeubles)
		var from := target.global_position + Vector3.UP * 1.5
		var q := PhysicsRayQueryParameters3D.create(from, want); q.exclude = [car.get_rid(), avatar.get_rid()]
		var hit := get_world_3d().direct_space_state.intersect_ray(q)
		if not hit.is_empty(): want = hit.position + (from - want).normalized() * 0.4
		if frames > 2 and hit.is_empty(): cam.global_position = cam.global_position.lerp(want, clamp(dt * 5.0, 0, 1))
		else: cam.global_position = want
	cam.look_at(look)
	frames += 1
	clock += dt
	var V := preload("res://scripts/ville.gd")
	for q in tiles.values(): # cycle des feux : groupe est-ouest et groupe nord-sud en alternance
		var feux: Dictionary = q.get_meta("feux", {})
		for mt in feux: mt.emission_energy_multiplier = 3.0 if V.light_state(clock, feux[mt][0]) == feux[mt][1] else 0.0
	if water: water.uv1_offset += Vector3(dt * 0.02, 0, dt * 0.012) # vagues qui glissent
	fps_label.text = "%d images/s · qualité %s · %d tuiles" % [Engine.get_frames_per_second(), ["très basse", "basse", "moyenne", "haute"][level], tiles.size()]
	if driving: hint.text = "[F]  Descendre de la voiture"
	elif avatar.global_position.distance_to(car.global_position) < 4.0: hint.text = "[F]  Monter dans la voiture"
	else: hint.text = ""
	hint_box.visible = hint.text != "" and not carte.visible
	_auto_quality(dt)
	if capture != "": # image quand les 9 tuiles proches sont la (ou au bout de 3 min)
		if ready_frames < 0 and ((pending.is_empty() and loading.is_empty() and not building and frames > 30) or frames > 9000): ready_frames = frames # toutes les tuiles existantes autour sont posees (pres de la mer il y en a moins de 9)
		if ready_frames >= 0 and frames == ready_frames + 60:
			print("tuiles ", tiles.size(), " FPS ", Engine.get_frames_per_second(), " pret en ", Time.get_ticks_msec() / 1000, " s")
			get_viewport().get_texture().get_image().save_png(capture); get_tree().quit()

# le jeu s'adapte a l'ordinateur : moyenne sur 3 s, on baisse sous 28 images/s, on remonte au-dessus de 50
func _auto_quality(dt: float) -> void:
	if capture != "" or frames < 200: return
	fps_acc += 1.0 / maxf(dt, 0.001); fps_n += 1
	if fps_n < int(3.0 / maxf(dt, 0.001)): return
	var avg := fps_acc / fps_n; fps_acc = 0.0; fps_n = 0
	var old := level
	if avg < 28 and level > 0: level -= 1
	elif avg > 50 and level < 3: level += 1
	if level != old: _apply_quality()

func _apply_quality() -> void:
	get_viewport().scaling_3d_scale = [0.5, 0.6, 0.7, 0.85][level]
	sun.shadow_enabled = level > 0
	sun.directional_shadow_max_distance = [0.0, 50.0, 110.0, 180.0][level]
	cam.far = [450.0, 600.0, 900.0, 1200.0][level]
	for q in tiles.values(): # objets dessines moins loin quand l'ordinateur peine
		for n in q.get_children():
			if n is MultiMeshInstance3D and n.visibility_range_end > 0:
				if not n.has_meta("vis0"): n.set_meta("vis0", n.visibility_range_end)
				n.visibility_range_end = n.get_meta("vis0") * [0.55, 0.75, 1.0, 1.25][level]

func _capture_view() -> Array:
	if view == "ciel": return [avatar.global_position + Vector3(0, 45, -70), avatar.global_position] # comme DOW.vue(45, 70) sur le site
	if view == "haut": return [avatar.global_position + Vector3(-160, 140, -160), avatar.global_position]
	return [avatar.global_position + Vector3(-2.2, 1.7, -3.2), avatar.global_position + Vector3.UP * 1.1]
