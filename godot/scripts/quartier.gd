# Une tuile de Dakar (400 m) : routes et ponts, batiments, maisons Blender, arbres, mobilier, stations, panneaux,
# policiers. Construite hors de l'arbre de scene (dans un fil a part) puis ajoutee par main.gd quand le joueur approche.
extends Node3D

var key := ""
var rect := Rect2() # emprise de la tuile en metres
var glass_st: SurfaceTool
var shop_st: SurfaceTool
var awning_st: SurfaceTool
var neighbours := [] # batiments des tuiles voisines : leur terrain est pris, rien ne se pose dessus

# d : la tuile (godot/data/tuiles/x_z.json) ; ctx : les routes des 8 tuiles voisines (pour les tests de proximite au bord)
# coroutine : une etape par image, pour que le jeu ne se fige pas pendant qu'une tuile se construit
func build(d: Dictionary, ctx: Array, tx: int, tz: int, size: float, tree: SceneTree = null) -> void:
	data = d; rect = Rect2(tx * size, tz * size, size, size)
	concrete = _mat("res://textures/worn_plaster_wall_diff.jpg", Color(0.85, 0.83, 0.8), 3.0)
	for r in data.roads: # vrais bouts de rue seulement (les coupures de tuile ne sont pas des carrefours)
		for e in [[0, r.endA], [r.pts.size() - 1, r.endB]]:
			if not e[1]: continue
			var p = r.pts[e[0]]; var k := "%d,%d" % [roundi(p[0]), roundi(p[1])]; junctions[k] = junctions.get(k, 0) + 1
	for r in ctx:
		for e in [[0, r.endA], [r.pts.size() - 1, r.endB]]:
			if not e[1]: continue
			var p = r.pts[e[0]]; var k := "%d,%d" % [roundi(p[0]), roundi(p[1])]; junctions[k] = junctions.get(k, 0) + 1
	for b in neighbours: # au bord de la tuile, le terrain des batiments voisins est occupe
		var mn := Vector2(1e9, 1e9); var mx := Vector2(-1e9, -1e9)
		for p in b.pts: mn = mn.min(Vector2(p[0], p[1])); mx = mx.max(Vector2(p[0], p[1]))
		if mx.x < rect.position.x - 20 or mn.x > rect.end.x + 20 or mx.y < rect.position.y - 20 or mn.y > rect.end.y + 20: continue
		for x in range(floori(mn.x / 4), floori(mx.x / 4) + 1):
			for z in range(floori(mn.y / 4), floori(mx.y / 4) + 1): occupied[Vector2i(x, z)] = true
	for poly in data.parks + data.places.map(func(p): return p.pts): # parcs et places : terrain public, aucune maison dessus
		var pts := PackedVector2Array()
		for p in poly: pts.append(Vector2(p[0], p[1]))
		var mn := Vector2(1e9, 1e9); var mx := Vector2(-1e9, -1e9)
		for p in pts: mn = mn.min(p); mx = mx.max(p)
		for x in range(floori(mn.x / 4), floori(mx.x / 4) + 1):
			for z in range(floori(mn.y / 4), floori(mx.y / 4) + 1):
				if Geometry2D.is_point_in_polygon(Vector2(x * 4 + 2, z * 4 + 2), pts): occupied[Vector2i(x, z)] = true
	var t0 := Time.get_ticks_msec(); var tm := {}
	ville = preload("res://scripts/ville.gd").new(self, data, ctx)
	if tree: await tree.process_frame
	tm["ville = preload"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	_roads()
	if tree: await tree.process_frame
	tm["_roads"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.mosques()
	if tree: await tree.process_frame
	tm["ville.mosques"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	_buildings()
	if tree: await tree.process_frame
	tm["_buildings"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.squares()
	if tree: await tree.process_frame
	tm["ville.squares"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.markets()
	if tree: await tree.process_frame
	tm["ville.markets"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.schools()
	if tree: await tree.process_frame
	tm["ville.schools"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	_fuel_stations()
	if tree: await tree.process_frame
	tm["_fuel_stations"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	_billboards()
	if tree: await tree.process_frame
	tm["_billboards"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.furniture()
	if tree: await tree.process_frame
	tm["ville.furniture"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.street_life()
	if tree: await tree.process_frame
	tm["ville.street_life"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.infill()
	if tree: await tree.process_frame
	tm["ville.infill"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	_greenery()
	if tree: await tree.process_frame
	tm["_greenery"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	ville.flush_models()
	if tree: await tree.process_frame
	tm["ville.flush_models"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	# _police() : policiers aux carrefours, retires pour le moment
	if tree: await tree.process_frame
	tm["_police"] = Time.get_ticks_msec() - t0; t0 = Time.get_ticks_msec()
	if OS.has_environment("DAKAR_TEMPS"): print("tuile ", key, " batiments ", data.buildings.size(), " ", tm)

const PAL := [Color("e9d7a8"), Color("dcb47c"), Color("f2ece0"), Color("e3c48f"), Color("c98f6a"), Color("f0e6d2"), Color("d7cfc0"), Color("bfcfd6")]
const BRANDS := {"total": [Color("e2231a"), Color("1d4f91")], "shell": [Color("fbce07"), Color("dd1d21")], "oilibya": [Color("009a44"), Color("e2231a")], "lybia": [Color("009a44"), Color("e2231a")], "star": [Color("1d4f91"), Color("f2c200")]}
const MIXAMO := "res://models/mixamo/leonard.fbx"
var data: Dictionary
var occupied := {} # cellules de 4 m prises par un batiment, une station : pas d'arbre dedans
var junctions := {} # noeud (arrondi au metre) -> nombre de routes qui s'y croisent
var concrete: StandardMaterial3D
var lamp_glow: StandardMaterial3D
var ville

func _mat(tex: String, col: Color, scale: float, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new(); m.albedo_texture = load(tex); m.albedo_color = col; m.roughness = rough
	m.uv1_triplanar = true; m.uv1_world_triplanar = true; m.uv1_scale = Vector3.ONE / scale; m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m

func _static(mesh: Mesh, mat: Material, collide := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = mat; add_child(mi)
	if collide:
		var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); cs.shape = mesh.create_trimesh_shape(); body.add_child(cs); add_child(body)
	return mi

# ---------------------------------------------------------------- routes, ponts, passages pietons
func _p3(r: Dictionary, i: int, lift := 0.0) -> Vector3:
	var y: float = (r.y[i] if r.y != null else 0.0) + lift
	return Vector3(r.pts[i][0], y, r.pts[i][1])

# ribbon from offset o0 to o1 (metres from the centre line), at height dy above the road profile
func _band(st: SurfaceTool, r: Dictionary, o0: float, o1: float, dy: float, only_up := false, only_flat := false, up := true, clip := false) -> void:
	for i in r.pts.size() - 1:
		var a := _p3(r, i, dy); var b := _p3(r, i + 1, dy)
		var hi := maxf(a.y, b.y) - dy
		if only_up and hi < 0.5: continue
		if only_flat and hi > 0.3: continue
		var d := Vector3(b.x - a.x, 0, b.z - a.z); if d.length() < 0.01: continue
		var n := Vector3(-d.z, 0, d.x).normalized()
		if clip: # trottoir : rien sur la chaussee d'une autre rue (carrefours, rues paralleles)
			var mid := (a + b) / 2.0 + n * (o0 + o1) / 2.0
			if ville.on_road(Vector2(mid.x, mid.z), 0.2, r) or ville.on_road(Vector2(a.x + n.x * o1, a.z + n.z * o1), 0.0, r) or ville.on_road(Vector2(b.x + n.x * o1, b.z + n.z * o1), 0.0, r): continue
		var q := [a + n * o0, b + n * o0, b + n * o1, a + n * o1]
		for k in ([0, 1, 2, 0, 2, 3] if up else [0, 2, 1, 0, 3, 2]): st.add_vertex(q[k])

# vertical strip along offset o, from the road profile + y0 to + y1 (both faces)
func _wall(st: SurfaceTool, r: Dictionary, o: float, y0: float, y1: float, only_up := true, clip := false) -> void:
	for i in r.pts.size() - 1:
		var a := _p3(r, i); var b := _p3(r, i + 1)
		if only_up and maxf(a.y, b.y) < 0.5 and r.t != 0: continue
		var d := Vector3(b.x - a.x, 0, b.z - a.z); if d.length() < 0.01: continue
		var n := Vector3(-d.z, 0, d.x).normalized() * o
		if clip: # bordure de trottoir : pas en travers de la chaussee d'une autre rue
			var m0 := Vector2(a.x + n.x, a.z + n.z); var m1 := Vector2(b.x + n.x, b.z + n.z)
			if ville.on_road(m0.lerp(m1, 0.5), 0.3, r) or ville.on_road(m0, 0.0, r) or ville.on_road(m1, 0.0, r): continue
		var q := [a + n + Vector3.UP * y0, b + n + Vector3.UP * y0, b + n + Vector3.UP * y1, a + n + Vector3.UP * y1]
		for k in [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]: st.add_vertex(q[k])

func _roads() -> void:
	var road := SurfaceTool.new(); road.begin(Mesh.PRIMITIVE_TRIANGLES)
	var walk := SurfaceTool.new(); walk.begin(Mesh.PRIMITIVE_TRIANGLES)
	var white := SurfaceTool.new(); white.begin(Mesh.PRIMITIVE_TRIANGLES)
	var deck := SurfaceTool.new(); deck.begin(Mesh.PRIMITIVE_TRIANGLES)
	var pillar := CylinderMesh.new(); pillar.top_radius = 0.7; pillar.bottom_radius = 0.8; pillar.height = 1.0
	var pmm: Array[Transform3D] = []
	for r in data.roads:
		var hw: float = r.w / 2.0
		_band(road, r, -hw, hw, 0.05)
		# trottoirs (seulement au sol), bordure surelevee de 15 cm
		if r.side > 0.5 and r.t != 0:
			_band(walk, r, hw, hw + r.side, 0.2, false, true, true, true); _band(walk, r, -hw - r.side, -hw, 0.2, false, true, true, true)
			_wall(walk, r, hw, 0.05, 0.2, false, true); _wall(walk, r, -hw, 0.05, 0.2, false, true)
		# tablier : dessous et rives en beton, glissieres en beton (type New Jersey) sur les ponts et l'autoroute
		_band(deck, r, -hw - 0.4, hw + 0.4, -0.9, true, false, false)
		_wall(deck, r, hw + 0.4, -0.9, 0.05); _wall(deck, r, -hw - 0.4, -0.9, 0.05)
		_wall(deck, r, hw + 0.25, 0.05, 0.95); _wall(deck, r, -hw - 0.25, 0.05, 0.95)
		_band(deck, r, hw + 0.1, hw + 0.4, 0.95, true); _band(deck, r, -hw - 0.4, -hw - 0.1, 0.95, true)
		if r.t == 0:
			_band(deck, r, hw + 0.1, hw + 0.4, 0.95, false); _band(deck, r, -hw - 0.4, -hw - 0.1, 0.95, false)
		# piliers tous les 18 m sous les parties hautes
		if r.y != null:
			var acc := 0.0
			for i in r.pts.size() - 1:
				var a := _p3(r, i); var b := _p3(r, i + 1); acc += Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
				if acc < 18.0: continue
				acc = 0.0; var y := (a.y + b.y) / 2.0
				if y < 2.6: continue
				var c := (a + b) / 2.0; var d := Vector3(b.x - a.x, 0, b.z - a.z).normalized(); var n := Vector3(-d.z, 0, d.x)
				for s in ([-1.0, 1.0] if r.w > 9 else [0.0]):
					var p: Vector3 = c + n * s * hw * 0.55; pmm.append(Transform3D(Basis().scaled(Vector3(1, y - 0.9, 1)), Vector3(p.x, (y - 0.9) / 2.0, p.z)))
		# marquages : tirets au milieu (pas en sens unique), lignes de rive sur les grands axes
		if r.t <= 4:
			_dashes(white, r, 0.0, 3.0, 9.0, 0.07)
			if r.t <= 1:
				_dashes(white, r, hw - 0.4, 1000.0, 0.0, 0.09); _dashes(white, r, -hw + 0.4, 1000.0, 0.0, 0.09)
		_crossings(white, r)
	for st in [road, walk, white, deck]: st.generate_normals()
	_static(road.commit(), _mat("res://textures/worn_asphalt_diff.jpg", Color(1.25, 1.32, 1.45), 5.0, 0.85))
	_static(walk.commit(), _mat("res://textures/interlocking_concrete_pavers_diff.jpg", Color(1.25, 1.55, 1.75), 2.5))
	var wm := StandardMaterial3D.new(); wm.albedo_color = Color(0.95, 0.95, 0.92); wm.roughness = 0.6; _static(white.commit(), wm, false)
	_static(deck.commit(), concrete)
	if pmm.size() > 0:
		var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.mesh = pillar; mm.instance_count = pmm.size()
		for i in pmm.size(): mm.set_instance_transform(i, pmm[i])
		var mi := MultiMeshInstance3D.new(); mi.multimesh = mm; mi.material_override = concrete; add_child(mi)
		for t in pmm: # piliers solides
			var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); var sh := CylinderShape3D.new(); sh.radius = 0.75; sh.height = t.basis.get_scale().y; cs.shape = sh; body.add_child(cs); body.position = t.origin; add_child(body)

# dashes (or a continuous line when gap is 0) at offset o along the road, just above the asphalt
func _dashes(st: SurfaceTool, r: Dictionary, o: float, dash: float, gap: float, hw: float) -> void:
	if r.ow and o == 0.0: return
	var run := 0.0
	for i in r.pts.size() - 1:
		var a := _p3(r, i, 0.065); var b := _p3(r, i + 1, 0.065); var L := Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
		if L < 0.01: continue
		var d := Vector3(b.x - a.x, 0, b.z - a.z) / L; var n := Vector3(-d.z, 0, d.x)
		var s := 0.0
		while s < L:
			var on := gap == 0.0 or fmod(run + s, dash + gap) < dash
			var e := minf(L, s + (L if gap == 0.0 else 1.0))
			if on:
				var p0 := a.lerp(b, s / L) + n * o; var p1 := a.lerp(b, e / L) + n * o
				for v in [p0 - n * hw, p1 - n * hw, p1 + n * hw, p0 - n * hw, p1 + n * hw, p0 + n * hw]: st.add_vertex(v)
			s = e
		run += L

# passage pieton (zebra) a 3 m de chaque carrefour au sol, sur les rues assez larges
func _crossings(st: SurfaceTool, r: Dictionary) -> void:
	if r.t < 1 or r.t > 6 or r.w < 6: return
	for end in [0, r.pts.size() - 1]:
		var e = r.pts[end]
		if junctions.get("%d,%d" % [roundi(e[0]), roundi(e[1])], 0) < 3: continue
		if r.y != null and r.y[end] > 0.1: continue
		var nb: int = 1 if end == 0 else end - 1
		var a := _p3(r, end, 0.066); var b := _p3(r, nb, 0.066); var L := Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
		if L < 9: continue
		var d := Vector3(b.x - a.x, 0, b.z - a.z) / L; var n := Vector3(-d.z, 0, d.x); var c: Vector3 = a + d * (r.w / 2.0 + 3.5)
		var o: float = -r.w / 2.0 + 0.5
		while o < r.w / 2.0 - 0.4:
			var p: Vector3 = c + n * (o + 0.25)
			for v in [p - n * 0.25 - d * 1.5, p + n * 0.25 - d * 1.5, p + n * 0.25 + d * 1.5, p - n * 0.25 - d * 1.5, p + n * 0.25 + d * 1.5, p - n * 0.25 + d * 1.5]: st.add_vertex(v)
			o += 1.0

# ---------------------------------------------------------------- batiments (fusionnes par quartier de 250 m)
func _buildings() -> void:
	var m := ShaderMaterial.new(); m.shader = load("res://shaders/facade.gdshader"); m.set_shader_parameter("plaster", load("res://textures/worn_plaster_wall_diff.jpg"))
	var cells := {}; var rng := RandomNumberGenerator.new(); rng.seed = 221
	for bi in data.buildings.size():
		var b: Dictionary = data.buildings[bi]
		var pts := PackedVector2Array()
		for p in b.pts: pts.append(Vector2(p[0], p[1]))
		if pts.size() < 3 or absf(_area(pts)) < 15: continue
		if not b.mosque and not _pull_back(pts): continue # comme le site : murs ramenes derriere le trottoir, sinon pas de batiment
		var bb0 := Rect2(pts[0], Vector2.ZERO)
		for p in pts: bb0 = bb0.expand(p)
		for x in range(floori(bb0.position.x / 4), floori(bb0.end.x / 4) + 1):
			for z in range(floori(bb0.position.y / 4), floori(bb0.end.y / 4) + 1): occupied[Vector2i(x, z)] = true
		var look: Dictionary = ville.building_look(bi, b, pts)
		if look.get("skip", false): continue
		var h: float = look.h
		var col: Color = Color("f4f1ea") if b.mosque else look.col; col.a = rng.randf()
		var key := Vector2i(floori(pts[0].x / 250.0), floori(pts[0].y / 250.0))
		if not cells.has(key):
			var nst := SurfaceTool.new(); nst.begin(Mesh.PRIMITIVE_TRIANGLES); cells[key] = nst
		var glass_tower: bool = b.get("style", "") == "plateau" and b.h >= 18 and b.get("src", "") != "gob" and absf(_area(pts)) < 2500 and not b.mosque and rng.randf() < 0.25 # tours de verre : vraies tours OSM du Plateau seulement
		if glass_tower:
			if glass_st == null: glass_st = SurfaceTool.new(); glass_st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var st: SurfaceTool = glass_st if glass_tower else cells[key]; st.set_color(col); st.set_smooth_group(-1) # aretes vives : sinon les tours paraissent fondues
		if not b.mosque and b.get("use", "") == "" and rng.randf() < 0.45:
			var cc := Vector2.ZERO
			for p in pts: cc += p
			ville.roofs.append([cc / pts.size(), h])
		var cw := _area(pts) > 0
		var shops: bool = not b.mosque and b.get("use", "") == "" and pts.size() <= 10 and rng.randf() < {"plateau": 0.85, "medina": 0.65, "sicap": 0.3, "villa": 0.08}.get(b.get("style", ""), 0.5) # rez-de-chaussee commercant, comme le site
		for i in pts.size():
			var a := pts[i]; var c := pts[(i + 1) % pts.size()]
			var v := [Vector3(a.x, 0, a.y), Vector3(c.x, 0, c.y), Vector3(c.x, h, c.y), Vector3(a.x, h, a.y)]
			for k in ([0, 2, 1, 0, 3, 2] if cw else [0, 1, 2, 0, 2, 3]): st.add_vertex(v[k])
			var w := [Vector3(a.x, h, a.y), Vector3(c.x, h, c.y), Vector3(c.x, h + 0.6, c.y), Vector3(a.x, h + 0.6, a.y)] # acrotere
			for k in [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]: st.add_vertex(w[k])
			if shops and not glass_tower and h >= 3 and a.distance_to(c) > 3.5: _shopfront(pts, a, c, rng)
		var tri := Geometry2D.triangulate_polygon(pts)
		for k in range(0, tri.size(), 3):
			for j in ([tri[k], tri[k + 1], tri[k + 2]] if cw else [tri[k], tri[k + 2], tri[k + 1]]): st.add_vertex(Vector3(pts[j].x, h, pts[j].y))
		if b.mosque: _mosque_tops(pts, h)
		var bb := Rect2(pts[0], Vector2.ZERO)
		for p in pts: bb = bb.expand(p)
		for x in range(floori(bb.position.x / 4), floori(bb.end.x / 4) + 1):
			for z in range(floori(bb.position.y / 4), floori(bb.end.y / 4) + 1): occupied[Vector2i(x, z)] = true
	for st in cells.values():
		st.generate_normals(); _static(st.commit(), m)
	if shop_st: # devantures (textures/boutiques.png) et baches colorees
		var sm := StandardMaterial3D.new(); sm.albedo_texture = load("res://textures/boutiques.png"); sm.roughness = 0.8; sm.cull_mode = BaseMaterial3D.CULL_DISABLED; sm.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		shop_st.generate_normals(); _static(shop_st.commit(), sm, false)
		var am := StandardMaterial3D.new(); am.vertex_color_use_as_albedo = true; am.roughness = 0.9; am.cull_mode = BaseMaterial3D.CULL_DISABLED
		awning_st.generate_normals(); _static(awning_st.commit(), am, false)
	if glass_st: # mur-rideau bleu-vert qui reflete le ciel
		var gm := StandardMaterial3D.new(); gm.albedo_color = Color(0.32, 0.45, 0.5); gm.metallic = 0.85; gm.roughness = 0.08; gm.cull_mode = BaseMaterial3D.CULL_DISABLED
		glass_st.generate_normals(); _static(glass_st.commit(), gm)

# OSM et largeurs de rue ne s'accordent pas toujours : chaque coin qui mord sur une rue (chaussee + trottoir) est
# repousse dehors ; un batiment enfonce de plus de 6 m dans la rue est abandonne (false)
# devanture de boutique sur le rez-de-chaussee du mur a -> c (4 m environ par boutique), bache au-dessus une fois sur deux.
# Le u de la texture croit vers la droite vu de la rue : les enseignes ne sont jamais ecrites a l'envers.
const TARPS := [Color("d8432f"), Color("2a7fd4"), Color("f2b01e"), Color("2f9e54"), Color("e8e2d4"), Color("9b4fc4")]
func _shopfront(pts: PackedVector2Array, a: Vector2, c: Vector2, rng: RandomNumberGenerator) -> void:
	if shop_st == null:
		shop_st = SurfaceTool.new(); shop_st.begin(Mesh.PRIMITIVE_TRIANGLES); awning_st = SurfaceTool.new(); awning_st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var e := c - a; var L := e.length(); var n := Vector2(e.y, -e.x).normalized()
	if Geometry2D.is_point_in_polygon((a + c) / 2.0 + n * 0.3, pts): n = -n # n sort du batiment
	var right := Vector2(n.y, -n.x) # vu de la rue (on regarde vers -n), la droite
	var p0 := a; var p1 := c
	if e.dot(right) < 0: p0 = c; p1 = a
	var off := n * 0.04; var u0 := rng.randf(); var u1 := u0 + L / 32.0 # 1/8 de texture = une boutique de 4 m
	var q := [[p0 + off, 0.0, u0, 1.0], [p1 + off, 0.0, u1, 1.0], [p1 + off, 3.1, u1, 0.0], [p0 + off, 3.1, u0, 0.0]]
	for k in [0, 1, 2, 0, 2, 3]: shop_st.set_uv(Vector2(q[k][2], q[k][3])); shop_st.add_vertex(Vector3(q[k][0].x, q[k][1], q[k][0].y))
	if rng.randf() < 0.5: # bache : toile tendue a 3 m et lambrequin qui pend
		var col: Color = TARPS[rng.randi() % TARPS.size()]; awning_st.set_color(col)
		var s0 := p0 + (p1 - p0).normalized() * 0.3; var s1 := p1 - (p1 - p0).normalized() * 0.3
		var t := [Vector3(s0.x, 3.0, s0.y), Vector3(s1.x, 3.0, s1.y), Vector3(s1.x + n.x * 0.9, 2.75, s1.y + n.y * 0.9), Vector3(s0.x + n.x * 0.9, 2.75, s0.y + n.y * 0.9)]
		for k in [0, 1, 2, 0, 2, 3]: awning_st.add_vertex(t[k])
		var f := [t[3], t[2], t[2] + Vector3.DOWN * 0.35, t[3] + Vector3.DOWN * 0.35]
		for k in [0, 1, 2, 0, 2, 3]: awning_st.add_vertex(f[k])

# mosquee OSM (contour seulement) : minaret blanc a pointe verte au coin, coupole verte sur le toit (comme addMinaret du site)
func _mosque_tops(pts: PackedVector2Array, h: float) -> void:
	var A := absf(_area(pts)); var c := Vector2.ZERO
	for p in pts: c += p
	c /= pts.size()
	var white := _plain(Color("f2ece0"), 0.7); var green := _plain(Color("2f8f5a"), 0.4); green.metallic = 0.2
	var dome := SphereMesh.new(); var r := clampf(sqrt(A) * 0.22, 2.5, 9.0); dome.radius = r; dome.height = r * 1.1; dome.is_hemisphere = true
	var dm := MeshInstance3D.new(); dm.mesh = dome; dm.material_override = green; dm.position = Vector3(c.x, h + 0.6, c.y); add_child(dm)
	if A < 120: return
	var mh := clampf(sqrt(A) * 0.9, 18.0, 60.0); var corner := pts[0].lerp(c, 0.12) # minaret pres d'un coin
	var shaft := CylinderMesh.new(); shaft.top_radius = mh * 0.035; shaft.bottom_radius = mh * 0.045; shaft.height = mh
	var sm := MeshInstance3D.new(); sm.mesh = shaft; sm.material_override = white; sm.position = Vector3(corner.x, mh / 2.0, corner.y); add_child(sm)
	var ring := CylinderMesh.new(); ring.top_radius = mh * 0.065; ring.bottom_radius = mh * 0.065; ring.height = mh * 0.025
	var rm := MeshInstance3D.new(); rm.mesh = ring; rm.material_override = white; rm.position = Vector3(corner.x, mh * 0.82, corner.y); add_child(rm)
	var cone := CylinderMesh.new(); cone.top_radius = 0.0; cone.bottom_radius = mh * 0.045; cone.height = mh * 0.09
	var cm := MeshInstance3D.new(); cm.mesh = cone; cm.material_override = green; cm.position = Vector3(corner.x, mh + mh * 0.045, corner.y); add_child(cm)

func _pull_back(pts: PackedVector2Array) -> bool:
	var c := Vector2.ZERO
	for p in pts: c += p
	c /= pts.size()
	for sg in ville.near_segs(c): # un batiment que l'axe d'une rue traverse barre la rue : on l'abandonne
		var r: Dictionary = sg[0]
		if r.t == 9 or r.y != null: continue
		var seg := PackedVector2Array([Vector2(r.pts[sg[1]][0], r.pts[sg[1]][1]), Vector2(r.pts[sg[1] + 1][0], r.pts[sg[1] + 1][1])])
		if not Geometry2D.intersect_polyline_with_polygon(seg, pts).is_empty(): return false
	for i in pts.size():
		for it in 3:
			var nr: Dictionary = ville.nearest(pts[i])
			if nr.is_empty(): break
			var band: float = nr.r.w / 2.0 + maxf(0.3, nr.r.side) + 0.3
			var over: float = band - nr.d
			if over <= 0: break
			if nr.r.y != null: break # sous un pont : rien a repousser
			if over > 6.0: return false
			var out: Vector2 = (pts[i] - nr.p).normalized() if nr.d > 0.01 else Vector2(1, 0)
			pts[i] += out * (over + 0.05)
	return absf(_area(pts)) >= 12

func _area(p: PackedVector2Array) -> float:
	var s := 0.0
	for i in p.size(): s += p[i].x * p[(i + 1) % p.size()].y - p[(i + 1) % p.size()].x * p[i].y
	return s / 2.0

func _free(x: float, z: float) -> bool: return not occupied.has(Vector2i(floori(x / 4), floori(z / 4)))
func _take(x: float, z: float, r: float) -> void:
	for a in range(floori((x - r) / 4), floori((x + r) / 4) + 1):
		for b in range(floori((z - r) / 4), floori((z + r) / 4) + 1): occupied[Vector2i(a, b)] = true

# ---------------------------------------------------------------- stations-service
func _fuel_stations() -> void:
	var pump := BoxMesh.new(); pump.size = Vector3(0.6, 1.8, 0.4)
	for f in data.fuel:
		var nr := _nearest_road(Vector2(f.x, f.z))
		if nr.is_empty(): continue
		var dir: Vector2 = nr.dir; var n := Vector2(-dir.y, dir.x); var side := 1.0 if (Vector2(f.x, f.z) - nr.p).dot(n) >= 0 else -1.0
		var c: Vector2 = nr.p + n * side * (nr.w / 2.0 + 10.0)
		var key := "station"
		for k in BRANDS:
			if String(f.name).to_lower().contains(k): key = k
		var cols: Array = BRANDS.get(key, [Color("1d4f91"), Color("f2c200")])
		var g := Node3D.new(); g.position = Vector3(c.x, 0, c.y); g.rotation.y = atan2(dir.x, dir.y); add_child(g)
		var slab := BoxMesh.new(); slab.size = Vector3(26, 0.2, 20); _part(g, slab, Vector3(0, 0.1, 0), concrete, true)
		var roof := BoxMesh.new(); roof.size = Vector3(16, 0.5, 10); _part(g, roof, Vector3(0, 5.2, 0), _plain(Color(0.96, 0.96, 0.95)), false)
		var band := BoxMesh.new(); band.size = Vector3(16.1, 0.6, 10.1); _part(g, band, Vector3(0, 5.0, 0), _plain(cols[0], 0.4), false) # bandeau aux couleurs de la marque
		var col := CylinderMesh.new(); col.top_radius = 0.25; col.bottom_radius = 0.25; col.height = 5.0
		for s in [Vector3(-6, 2.5, -3), Vector3(6, 2.5, -3), Vector3(-6, 2.5, 3), Vector3(6, 2.5, 3)]: _part(g, col, s, _plain(Color(0.9, 0.9, 0.9)), true)
		for x in [-4.0, 0.0, 4.0]: # ilots de pompes
			var isl := BoxMesh.new(); isl.size = Vector3(1.2, 0.25, 4.5); _part(g, isl, Vector3(x, 0.32, 0), concrete, true)
			for z in [-1.2, 1.2]: _part(g, pump, Vector3(x, 1.35, z), _plain(cols[1], 0.4), true)
		var shop := BoxMesh.new(); shop.size = Vector3(12, 3.6, 5); _part(g, shop, Vector3(0, 1.9, -7.5), _plain(Color("f2efe8")), true)
		var sign := BoxMesh.new(); sign.size = Vector3(0.4, 7, 1.8); _part(g, sign, Vector3(11, 3.6, 8), _plain(cols[0], 0.4), true) # totem
		var lb := Label3D.new(); lb.text = String(f.name).to_upper(); lb.font_size = 72; lb.outline_size = 8; lb.position = Vector3(11.25, 6.0, 8); lb.rotation.y = PI / 2; lb.pixel_size = 0.008; g.add_child(lb)
		var lb2 := Label3D.new(); lb2.text = String(f.name).to_upper(); lb2.font_size = 96; lb2.position = Vector3(0, 5.0, 5.08); lb2.pixel_size = 0.01; g.add_child(lb2)
		_take(c.x, c.y, 14)

# ---------------------------------------------------------------- panneaux publicitaires (annonces fictives + Rangu)
const ADS := [["RANGU", "Gère ta boutique de téléphones", Color("0f6b4a"), Color("f2c200")], ["CAFÉ TOUBA DIALLO", "Le vrai goût du djar", Color("4a2c1d"), Color("f2d48a")],
	["LAIT CAILLÉ SOW", "Frais chaque matin", Color("1d4f91"), Color("ffffff")], ["TERANGA MONEY", "Envoie, reçois, paie", Color("e85d1a"), Color("ffffff")],
	["THIOF ASSURANCES", "Votre voiture protégée", Color("8a1c2b"), Color("ffffff")], ["BISSAP NDAW", "100 % naturel", Color("6b1f4f"), Color("f6a5c0")]]
func _billboards() -> void:
	var rng := RandomNumberGenerator.new(); rng.seed = 5; var n := 0
	for r in data.roads:
		if r.t > 2 or r.y != null: continue
		var acc := rng.randf_range(60, 200)
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 0.5: continue
			acc -= L
			if acc > 0: continue
			acc = rng.randf_range(180, 320)
			var d := (b - a) / L; var nn := Vector2(-d.y, d.x) * (1.0 if rng.randf() < 0.5 else -1.0)
			var p: Vector2 = a + nn * (r.w / 2.0 + r.side + 4.0)
			if not _free(p.x, p.y) or not _clear_of_roads(p, 2.0): continue
			_billboard(p, atan2(-nn.x, -nn.y), ADS[0] if n % 2 == 0 else ADS[1 + (n / 2) % (ADS.size() - 1)]); n += 1 # Rangu en priorite : un panneau sur deux; _take(p.x, p.y, 5)

func _billboard(p: Vector2, rot: float, ad: Array) -> void:
	var g := Node3D.new(); g.position = Vector3(p.x, 0, p.y); g.rotation.y = rot; g.set_meta("pub", true); add_child(g)
	var pole := CylinderMesh.new(); pole.top_radius = 0.18; pole.bottom_radius = 0.22; pole.height = 6.5
	for x in [-2.6, 2.6]: _part(g, pole, Vector3(x, 3.25, -0.2), _plain(Color(0.55, 0.56, 0.58), 0.4), true)
	var frame := BoxMesh.new(); frame.size = Vector3(8.4, 4.4, 0.25); _part(g, frame, Vector3(0, 8.2, -0.25), _plain(Color(0.2, 0.2, 0.22), 0.5), false)
	var face := BoxMesh.new(); face.size = Vector3(8.0, 4.0, 0.05); _part(g, face, Vector3(0, 8.2, -0.1), _plain(ad[2], 0.6), false)
	var stripe := BoxMesh.new(); stripe.size = Vector3(8.0, 0.5, 0.06); _part(g, stripe, Vector3(0, 6.45, -0.09), _plain(ad[3], 0.6), false)
	var t := Label3D.new(); t.text = ad[0]; t.font_size = 150; t.outline_size = 0; t.modulate = ad[3]; t.position = Vector3(0, 8.9, -0.05); t.pixel_size = 0.01; t.width = 760; t.autowrap_mode = TextServer.AUTOWRAP_WORD; t.double_sided = false; g.add_child(t)
	var s2 := Label3D.new(); s2.text = ad[1]; s2.font_size = 80; s2.outline_size = 0; s2.modulate = Color.WHITE; s2.position = Vector3(0, 7.5, -0.05); s2.pixel_size = 0.01; s2.double_sided = false; g.add_child(s2)

func _plain(c: Color, rough := 0.7) -> StandardMaterial3D:
	var m := StandardMaterial3D.new(); m.albedo_color = c; m.roughness = rough; return m
func _part(g: Node3D, mesh: Mesh, pos: Vector3, mat: Material, collide: bool) -> void:
	var mi := MeshInstance3D.new(); mi.mesh = mesh; mi.material_override = mat; mi.position = pos; g.add_child(mi)
	if collide:
		var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); cs.shape = mesh.create_convex_shape(); body.add_child(cs); body.position = pos; g.add_child(body)

func _nearest_road(p: Vector2, max_t := 6) -> Dictionary:
	var best := {}; var bd := 1e9
	for r in data.roads:
		if r.t > max_t or r.y != null: continue
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1])
			var q := Geometry2D.get_closest_point_to_segment(p, a, b); var d := q.distance_to(p)
			if d < bd and a.distance_to(b) > 0.5:
				bd = d; best = {"p": q, "dir": (b - a).normalized(), "w": r.w, "r": r, "d": d}
	return best

# ---------------------------------------------------------------- arbres et jardins
func _greenery() -> void:
	var gm := StandardMaterial3D.new(); gm.albedo_texture = load("res://textures/sand_02_diff.jpg"); gm.albedo_color = Color(0.5, 0.66, 0.3); gm.uv1_triplanar = true; gm.uv1_world_triplanar = true; gm.uv1_scale = Vector3.ONE / 5
	var spots := {"neem": [], "palmier": [], "baobab": []}
	var rng := RandomNumberGenerator.new(); rng.seed = 7
	for poly in data.parks + data.places.map(func(p): return p.pts):
		var pts := PackedVector2Array()
		for p in poly: pts.append(Vector2(p[0], p[1]))
		var tri := Geometry2D.triangulate_polygon(pts)
		if tri.is_empty(): continue
		if poly in data.parks:
			var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); var flip := _area(pts) > 0
			for k in range(0, tri.size(), 3):
				for j in ([tri[k], tri[k + 2], tri[k + 1]] if flip else [tri[k], tri[k + 1], tri[k + 2]]): st.add_vertex(Vector3(pts[j].x, 0.04, pts[j].y))
			st.generate_normals(); _static(st.commit(), gm, false)
		var bb := Rect2(pts[0], Vector2.ZERO)
		for p in pts: bb = bb.expand(p)
		for n in int(clamp(absf(_area(pts)) / 120.0, 2, 120)):
			var q := Vector2(rng.randf_range(bb.position.x, bb.end.x), rng.randf_range(bb.position.y, bb.end.y))
			if Geometry2D.is_point_in_polygon(q, pts) and _free(q.x, q.y):
				spots["palmier" if rng.randf() < 0.3 else "neem"].append(q); _take(q.x, q.y, 3)
	# alignements le long des rues : neems sur les trottoirs larges, palmiers sur les grands boulevards
	for r in data.roads:
		if r.t < 1 or r.t > 5 or r.y != null or r.side < 1.5: continue
		var acc := rng.randf_range(0, 14.0)
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 0.5: continue
			var d := (b - a) / L; var n := Vector2(-d.y, d.x); var s := acc
			while s < L:
				for side in [-1.0, 1.0]:
					var q: Vector2 = a + d * s + n * side * (r.w / 2.0 + r.side * 0.6)
					if _free(q.x, q.y) and _clear_of_roads(q, 1.2):
						spots["palmier" if r.t <= 2 else "neem"].append(q); _take(q.x, q.y, 3)
				s += 14.0
			acc = s - L
	# baobabs isoles sur les terrains libres en peripherie
	for n in 3:
		var q := Vector2(rng.randf_range(rect.position.x, rect.end.x), rng.randf_range(rect.position.y, rect.end.y))
		if _free(q.x, q.y) and _clear_of_roads(q, 8.0):
			spots.baobab.append(q); _take(q.x, q.y, 8)
	var models := {"neem": ["arbre_neem1", "arbre_neem2", "arbre_neem3"], "palmier": ["arbre_palmier1", "arbre_palmier2"], "baobab": ["arbre_baobab1"]}
	for kind in spots:
		var groups := {}
		for q in spots[kind]:
			var mname: String = models[kind][rng.randi() % models[kind].size()]
			if not groups.has(mname): groups[mname] = []
			groups[mname].append(q)
		for mname in groups: _forest("res://models/%s.glb" % mname, groups[mname], rng, 1.6 if kind == "baobab" else 0.4)

# one MultiMesh per tree model, plus a solid trunk collider each
func _forest(path: String, spots: Array, rng: RandomNumberGenerator, trunk_r: float) -> void:
	var scn: Node3D = load(path).instantiate(); var src: MeshInstance3D = scn.find_children("*", "MeshInstance3D", true, false)[0]
	if not tree_meshes.has(path): # un seul maillage par modele d'arbre, partage par toutes les tuiles (et enregistre une fois a la pre-construction)
		var mesh0: Mesh = src.mesh.duplicate()
		for i in mesh0.get_surface_count(): # feuilles : texture decoupee (alpha), visibles des deux cotes
			var sm := mesh0.surface_get_material(i)
			if sm and sm.resource_name.begins_with("Feuilles"): mesh0.surface_set_material(i, _leaf_mat())
		tree_meshes[path] = mesh0
	var mesh: Mesh = tree_meshes[path]
	var cells := {} # arbres groupes par carre de 200 m : seuls les proches sont dessines (feuilles = beaucoup de triangles)
	for q in spots:
		var key := Vector2i(floori(q.x / 200.0), floori(q.y / 200.0))
		if not cells.has(key): cells[key] = []
		cells[key].append(q)
	for key in cells:
		var list: Array = cells[key]
		var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.mesh = mesh; mm.instance_count = list.size()
		var centre := Vector3((key.x + 0.5) * 200.0, 0, (key.y + 0.5) * 200.0) # distance d'affichage mesuree depuis le carre
		for j2 in list.size():
			var s := rng.randf_range(0.8, 1.25) * (0.62 if path.contains("neem") else 1.0); var q: Vector2 = list[j2] # neems de rue : 6-7 m
			mm.set_instance_transform(j2, Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s, s)), Vector3(q.x, 0, q.y) - centre))
			var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); var sh := CylinderShape3D.new(); sh.radius = trunk_r * s; sh.height = 3; cs.shape = sh; cs.position.y = 1.5; body.add_child(cs); body.position = Vector3(q.x, 0, q.y); add_child(body)
		mm.custom_aabb = AABB(Vector3(-120, -2, -120), Vector3(240, 30, 240))
		var mi := MultiMeshInstance3D.new(); mi.multimesh = mm; mi.position = centre; mi.visibility_range_end = 280.0; mi.visibility_range_end_margin = 30.0; mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF; add_child(mi)
	scn.queue_free()

static var _leaf: StandardMaterial3D # partage par toutes les tuiles
static var tree_meshes := {}
func _leaf_mat() -> StandardMaterial3D:
	if _leaf: return _leaf
	var img := Image.create(128, 128, true, Image.FORMAT_RGBA8); img.fill(Color(0, 0, 0, 0))
	var rng := RandomNumberGenerator.new(); rng.seed = 11
	for k in 9: # petites feuilles ovales de neem autour d'une nervure
		var c := Vector2(rng.randf_range(24, 104), rng.randf_range(24, 104)); var ang := rng.randf() * TAU; var col := Color(0.22, 0.4, 0.1).lerp(Color(0.42, 0.55, 0.16), rng.randf())
		for y in 128:
			for x in 128:
				var d := (Vector2(x, y) - c).rotated(-ang)
				if pow(d.x / 22.0, 2) + pow(d.y / 8.0, 2) < 1.0: img.set_pixel(x, y, col * (0.85 + 0.15 * absf(d.y) / 8.0) if absf(d.y) > 0.8 else col * 0.7)
	img.generate_mipmaps()
	_leaf = StandardMaterial3D.new(); _leaf.albedo_texture = ImageTexture.create_from_image(img); _leaf.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR; _leaf.alpha_scissor_threshold = 0.5
	_leaf.cull_mode = BaseMaterial3D.CULL_DISABLED; _leaf.roughness = 0.75; _leaf.backlight_enabled = true; _leaf.backlight = Color(0.25, 0.35, 0.1)
	return _leaf

func _clear_of_roads(q: Vector2, margin: float) -> bool:
	for r in data.roads:
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1])
			if absf(a.x - q.x) > 60 and absf(b.x - q.x) > 60: continue
			if Geometry2D.get_closest_point_to_segment(q, a, b).distance_to(q) < r.w / 2.0 + margin: return false
	return true

# ---------------------------------------------------------------- gens : policiers, passants
func _person(colors: Dictionary, cap: Color = Color(0, 0, 0, 0)) -> Node3D:
	var model: Node3D = load(MIXAMO).instantiate()
	for m in model.find_children("*", "MeshInstance3D", true, false):
		for i in m.mesh.get_surface_count():
			var mat: Material = m.get_active_material(i)
			if not (mat is StandardMaterial3D): continue
			var nm := (mat.duplicate() as StandardMaterial3D)
			for part in colors:
				if String(m.name).ends_with(part): nm.albedo_color = colors[part]
			m.set_surface_override_material(i, nm)
	if cap.a > 0: # casquette de policier fixee a la tete
		var sk: Skeleton3D = model.find_child("Skeleton3D", true, false); var ba := BoneAttachment3D.new(); sk.add_child(ba)
		for bi in sk.get_bone_count():
			if sk.get_bone_name(bi).ends_with("Head"): ba.bone_idx = bi
		var c := CylinderMesh.new(); c.top_radius = 0.12; c.bottom_radius = 0.105; c.height = 0.09
		var mi := MeshInstance3D.new(); mi.mesh = c; mi.material_override = _plain(cap, 0.5); mi.position = Vector3(0, 0.19, 0.0); ba.add_child(mi)
		var visor := BoxMesh.new(); visor.size = Vector3(0.18, 0.015, 0.09); var vm := MeshInstance3D.new(); vm.mesh = visor; vm.material_override = _plain(Color(0.05, 0.05, 0.05), 0.3); vm.position = Vector3(0, 0.15, 0.12); ba.add_child(vm)
	return model

func _police() -> void:
	# policiers de la circulation aux grands carrefours au sol : uniforme bleu marine, casquette blanche
	var idle: AnimationPlayer = load("res://models/mixamo/idle.fbx").instantiate().find_child("AnimationPlayer", true, false)
	var count := 0
	for k in junctions:
		if junctions[k] < 4 or count >= 1: continue # un policier par tuile au plus (modele lourd)
		var xy := String(k).split(","); var p := Vector2(float(xy[0]), float(xy[1]))
		var big := false
		for r in data.roads:
			if r.t <= 3 and r.y == null and (Vector2(r.pts[0][0], r.pts[0][1]).distance_to(p) < 1.5 or Vector2(r.pts[-1][0], r.pts[-1][1]).distance_to(p) < 1.5): big = true
		if not big: continue
		var cop := _person({"Body": Color(0.36, 0.22, 0.15), "Sweater": Color("1f2a44"), "Pants": Color("1f2a44"), "Hair": Color(0.08, 0.06, 0.05), "Shoes": Color(0.03, 0.03, 0.03)}, Color(0.97, 0.97, 0.97))
		var nr := _nearest_road(p, 3); var off := Vector2.ZERO
		if not nr.is_empty(): off = Vector2(-nr.dir.y, nr.dir.x) * (nr.w / 2.0 + 1.2)
		cop.position = Vector3(p.x + off.x, 0.2, p.y + off.y); cop.rotation.y = atan2(-off.x, -off.y); cop.name = "Policier%d" % count; add_child(cop)
		var ap: AnimationPlayer = cop.find_child("AnimationPlayer", true, false)
		if ap and idle:
			var lib := AnimationLibrary.new(); var an: Animation = idle.get_animation("mixamo_com").duplicate(); an.loop_mode = Animation.LOOP_LINEAR; lib.add_animation("Idle", an); ap.add_animation_library("p", lib); ap.play("p/Idle"); ap.seek(randf() * 3)
		count += 1
