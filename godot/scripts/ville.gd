# Ce qui fait la ville comme dans la version web : maisons Blender selon le quartier, mosquees, mer et plages,
# marches, ecoles, places pavees, batiments administratifs. Appele par main.gd, qui garde le decor et le jeu.
extends RefCounted

const STYLES := {
	"plateau": {"pal": ["e9d7a8", "dcb47c", "f2ece0", "e3c48f", "c98f6a", "f0e6d2", "d7cfc0", "bfcfd6"], "h": [2, 9], "houses": ["immeuble_medina"]},
	"medina": {"pal": ["e6c15a", "7fb3cf", "e08a5b", "a9c98f", "f0e2c8", "dca3a0", "c9d3d6", "e8d4b0"], "h": [1, 4.6], "houses": ["immeuble_medina", "immeuble_medina", "maison_r1"]},
	"sicap": {"pal": ["f0dcb4", "e8cfa0", "dfe5d3", "f3e9d6", "e9c9b0", "d6e0e4"], "h": [1, 3], "houses": ["maison_r1", "maison_r1", "villa"]},
	"villa": {"pal": ["f6f2ea", "efe6d6", "e8dcc4", "f3ebe3", "dfd2bd", "e9e2d6"], "h": [1, 3.4], "houses": ["villa", "villa", "maison_r1"]},
	"banlieue": {"pal": ["b9a68a", "b9a68a", "e5d3b0", "d9a877", "c7d0c9", "e8d4b0", "c6b9a4"], "h": [1, 3.3], "houses": ["maison_r1", "maison", "maisonbasket"]},
}
var m: Node3D # main.gd
var data: Dictionary
var rng := RandomNumberGenerator.new()
var grid := {} # cellule de 40 m -> [route, indice de segment], pour les tests de proximite rapides
static var models := {} # nom -> {meshes, size, norm}, partage par toutes les tuiles
var placed := {} # nom -> [[Transform3D, Color]]
var skip_buildings := {} # indices de batiments remplaces par une mosquee

func _init(main: Node3D, d: Dictionary, ctx: Array = []) -> void:
	m = main; data = d; rng.seed = hash(str(d.get("roads", []).size()) + str(d.get("buildings", []).size()))
	for r in data.get("roads", []) + ctx:
		for i in r.pts.size() - 1:
			var c := Vector2i(floori((r.pts[i][0] + r.pts[i + 1][0]) / 80.0), floori((r.pts[i][1] + r.pts[i + 1][1]) / 80.0))
			if not grid.has(c): grid[c] = []
			grid[c].append([r, i])

# segments of road near p (3 x 3 cells of 40 m)
func near_segs(p: Vector2) -> Array:
	var out := []; var c := Vector2i(floori(p.x / 40.0), floori(p.y / 40.0))
	for a in range(-1, 2):
		for b in range(-1, 2): out.append_array(grid.get(c + Vector2i(a, b), []))
	return out

# true when p is within margin of a carriageway (other than `skip`)
func on_road(p: Vector2, margin: float, skip = null) -> bool:
	for s in near_segs(p):
		var r: Dictionary = s[0]
		if r == skip or r.t == 9: continue
		var a := Vector2(r.pts[s[1]][0], r.pts[s[1]][1]); var b := Vector2(r.pts[s[1] + 1][0], r.pts[s[1] + 1][1])
		if Geometry2D.get_closest_point_to_segment(p, a, b).distance_to(p) < r.w / 2.0 + margin: return true
	return false

func nearest(p: Vector2) -> Dictionary:
	var best := {}; var bd := 1e9
	for s in near_segs(p):
		var r: Dictionary = s[0]; var a := Vector2(r.pts[s[1]][0], r.pts[s[1]][1]); var b := Vector2(r.pts[s[1] + 1][0], r.pts[s[1] + 1][1])
		var q := Geometry2D.get_closest_point_to_segment(p, a, b)
		if q.distance_to(p) < bd: bd = q.distance_to(p); best = {"p": q, "d": bd, "r": r}
	return best

# ---------------------------------------------------------------- modeles Blender (maisons, mosquees)
func model(name: String) -> Dictionary:
	if models.has(name): return models[name]
	var scn: Node3D = load("res://models/%s.glb" % name).instantiate(); var list := []; var box := AABB(); var first := true
	for mi in scn.find_children("*", "MeshInstance3D", true, false):
		var t := _rel(scn, mi); list.append([mi.mesh, t])
		var bb: AABB = t * mi.get_aabb()
		box = bb if first else box.merge(bb); first = false
	scn.queue_free()
	var norm := Transform3D(Basis(), Vector3(-box.get_center().x, -box.position.y, -box.get_center().z)) # pied au centre, au sol
	models[name] = {"meshes": list, "size": box.size, "norm": norm}; return models[name]

func _rel(root: Node, n: Node3D) -> Transform3D:
	var t := n.transform; var p := n.get_parent()
	while p and p != root:
		if p is Node3D: t = p.transform * t
		p = p.get_parent()
	return t

func place(name: String, x: float, z: float, rot: float, sx: float, sy: float, sz: float, col: Color) -> void:
	var t := Transform3D(Basis(Vector3.UP, rot) * Basis.from_scale(Vector3(sx, sy, sz)), Vector3(x, 0, z))
	if not placed.has(name): placed[name] = []
	placed[name].append([t, col])
	var S: Vector3 = model(name).size # corps solide
	var body := StaticBody3D.new(); var cs := CollisionShape3D.new(); var bx := BoxShape3D.new(); bx.size = Vector3(S.x * sx, S.y * sy, S.z * sz) * 0.95; cs.shape = bx; cs.position.y = S.y * sy / 2.0
	body.add_child(cs); body.transform = Transform3D(Basis(Vector3.UP, rot), Vector3(x, 0, z)); m.add_child(body)

# one MultiMesh per model mesh; "Facade" materials take the per-house colour
func flush_models() -> void:
	print("modeles places : ", placed.keys().map(func(k): return "%s=%d" % [k, placed[k].size()]))
	for name in placed:
		var md: Dictionary = model(name)
		for pair in md.meshes:
			var mesh: Mesh = pair[0].duplicate()
			for i in mesh.get_surface_count():
				var sm := mesh.surface_get_material(i)
				if sm is StandardMaterial3D and sm.resource_name.begins_with("Facade"):
					var f: StandardMaterial3D = sm.duplicate(); f.vertex_color_use_as_albedo = true; mesh.surface_set_material(i, f)
			# voitures et petits objets tres detailles (20 000 a 40 000 triangles) : seulement de pres, par carres de 70 m
			var heavy: bool = CARS.has(name) or name in ["cafe", "fruitcart", "maisonbasket"]
			var cs: float = 70.0 if heavy else 200.0
			var cells := {} # un groupe par carre : chacun se cache au loin, et la zone visible reste juste
			for k in placed[name].size():
				var o: Vector3 = placed[name][k][0].origin; var key := Vector2i(floori(o.x / cs), floori(o.z / cs))
				if not cells.has(key): cells[key] = []
				cells[key].append(k)
			for key in cells:
				var ids: Array = cells[key]
				var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.use_colors = true; mm.mesh = mesh; mm.instance_count = ids.size()
				var centre := Vector3((key.x + 0.5) * cs, 0, (key.y + 0.5) * cs) # le groupe est pose au centre de son carre : la distance d'affichage se mesure de la
				for j in ids.size():
					var t: Transform3D = placed[name][ids[j]][0] * md.norm * pair[1]; t.origin -= centre
					mm.set_instance_transform(j, t); mm.set_instance_color(j, placed[name][ids[j]][1])
				mm.custom_aabb = AABB(Vector3(-cs / 2.0 - 30, -5, -cs / 2.0 - 30), Vector3(cs + 60, 80, cs + 60))
				var mi := MultiMeshInstance3D.new(); mi.multimesh = mm; mi.position = centre; mi.visibility_range_end = 130.0 if heavy else 380.0; m.add_child(mi)

# oriented box of a footprint: the edge direction giving the smallest rectangle
func obb(pts: PackedVector2Array) -> Dictionary:
	var best := {}
	for i in pts.size():
		var e := pts[(i + 1) % pts.size()] - pts[i]
		if e.length() < 1.0: continue
		var u := e.normalized(); var v := Vector2(-u.y, u.x); var u0 := 1e9; var u1 := -1e9; var v0 := 1e9; var v1 := -1e9
		for p in pts: u0 = minf(u0, p.dot(u)); u1 = maxf(u1, p.dot(u)); v0 = minf(v0, p.dot(v)); v1 = maxf(v1, p.dot(v))
		var A := (u1 - u0) * (v1 - v0)
		if best.is_empty() or A < best.A: best = {"A": A, "u": u, "v": v, "a": u1 - u0, "b": v1 - v0, "c": u * (u0 + u1) / 2.0 + v * (v0 + v1) / 2.0}
	return best

# fit model `name` on a footprint, entrance toward the nearest street; false if the shapes disagree too much
func fit(name: String, pts: PackedVector2Array, col: Color, kmin := 0.6, kmax := 1.6) -> bool:
	var o := obb(pts)
	if o.is_empty(): return false
	var S: Vector3 = model(name).size; var opts := []
	for f in [[o.v, o.a, o.b], [-o.v, o.a, o.b], [o.u, o.b, o.a], [-o.u, o.b, o.a]]:
		var kx: float = f[1] / S.x; var kz: float = f[2] / S.z
		if kx < kmin or kx > kmax or kz < kmin or kz > kmax: continue
		var nr := nearest(o.c + f[0] * f[2] / 2.0); opts.append([nr.get("d", 1e3), f[0], kx, kz])
	if opts.is_empty(): return false
	opts.sort_custom(func(p, q): return p[0] < q[0]); var b = opts[0]
	place(name, o.c.x, o.c.y, atan2(b[1].x, b[1].y), b[2], clampf(sqrt(b[2] * b[3]), 0.7, 1.4), b[3], col)
	return true

# ---------------------------------------------------------------- mosquees
func mosques() -> void:
	for mq in data.mosques:
		var nm: String = mq.name
		var mod := "mosquee_divinite" if nm.to_lower().contains("divinit") else ("mosquee_grande" if mq.area > 5000 or nm.to_lower().contains("massalik") else "mosquee_quartier")
		var col: Color = Color("f4f1ea") if mod != "mosquee_quartier" else [Color("f4f1ea"), Color("eee6cf"), Color("e3efe2")][rng.randi() % 3]
		if mq.pts != null:
			var pts := PackedVector2Array(); for p in mq.pts: pts.append(Vector2(p[0], p[1]))
			if fit(mod, pts, col, 0.35, 3.5):
				for i in data.buildings.size(): # le batiment OSM sous la mosquee disparait
					var b = data.buildings[i]; var c := Vector2.ZERO
					for p in b.pts: c += Vector2(p[0], p[1])
					c /= b.pts.size()
					if Geometry2D.is_point_in_polygon(c, pts): skip_buildings[i] = true
				continue
		# mosquee connue seulement par un point : mosquee de quartier tournee vers sa rue, si le terrain est libre
		var p := Vector2(mq.x, mq.z); var nr := nearest(p)
		if nr.is_empty() or on_road(p, 6.0) or not m._free(p.x, p.y): continue
		place("mosquee_quartier", p.x, p.y, atan2(nr.p.x - p.x, nr.p.y - p.y), 1, 1, 1, col); m._take(p.x, p.y, 9)

# ---------------------------------------------------------------- batiments : maisons selon le quartier, administratifs
func building_look(i: int, b: Dictionary, pts: PackedVector2Array) -> Dictionary:
	if skip_buildings.has(i): return {"skip": true}
	var st: Dictionary = STYLES.get(b.get("style", "banlieue"), STYLES.banlieue)
	var col := Color(st.pal[rng.randi() % st.pal.size()])
	if b.get("use", "") != "": # ministere, mairie, hopital, hotel, bureaux : enduit clair, plus haut, drapeau et nom
		var h: float = maxf(b.h, 12.0 if b.use == "admin" else 9.0)
		col = {"admin": Color("f2ece0"), "hopital": Color("f4f4f2"), "hotel": Color("e8eef0"), "bureau": Color("dfe6ea")}[b.use]
		var c := Vector2.ZERO; for p in pts: c += p
		c /= pts.size(); _flag(Vector3(c.x, h + 0.6, c.y))
		if b.name != "":
			var lb := Label3D.new(); lb.text = b.name; lb.font_size = 56; lb.outline_size = 10; lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED; lb.position = Vector3(c.x, h + 3.5, c.y); lb.pixel_size = 0.02; lb.visibility_range_end = 180.0; m.add_child(lb)
		return {"h": h, "col": col}
	var h2: float = b.h if b.h > 0 else 3.1 * maxf(1.0, floorf(rng.randf_range(st.h[0], st.h[1])))
	if b.h == 0 and pts.size() == 4 and rng.randf() < 0.6: # maison type du quartier, modelisee dans Blender
		var names: Array = st.houses
		if fit(names[rng.randi() % names.size()], pts, col):
			if b.get("style", "") != "plateau" and rng.randf() < 0.6: compounds.append(pts)
			return {"skip": true}
	return {"h": h2, "col": col}

var _flagmat: StandardMaterial3D
func _flag(at: Vector3) -> void:
	if _flagmat == null: # drapeau du Senegal : vert, jaune a etoile verte, rouge
		var img := Image.create(96, 64, false, Image.FORMAT_RGBA8)
		for y in 64:
			for x in 96:
				var c := Color("00853f") if x < 32 else (Color("fdef42") if x < 64 else Color("e31b23"))
				if x >= 32 and x < 64 and Vector2(x - 48, y - 32).length() < 6: c = Color("00853f") # etoile verte (simplifiee en disque)
				img.set_pixel(x, y, c)
		_flagmat = StandardMaterial3D.new(); _flagmat.albedo_texture = ImageTexture.create_from_image(img); _flagmat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var pole := CylinderMesh.new(); pole.top_radius = 0.04; pole.bottom_radius = 0.05; pole.height = 6
	var pm := MeshInstance3D.new(); pm.mesh = pole; pm.position = at + Vector3(0, 3, 0); m.add_child(pm)
	var q := QuadMesh.new(); q.size = Vector2(1.8, 1.2); var fm := MeshInstance3D.new(); fm.mesh = q; fm.material_override = _flagmat; fm.position = at + Vector3(0.92, 5.3, 0); m.add_child(fm)

# ---------------------------------------------------------------- mer et plages
func sea() -> void:
	var poly := PackedVector2Array()
	for p in data.coast: poly.append(Vector2(p[0], p[1]))
	for p in data.coastClose: poly.append(Vector2(p[0], p[1]))
	var tri := Geometry2D.triangulate_polygon(poly)
	if tri.is_empty(): push_warning("mer : triangulation impossible"); return
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); var cw: bool = m._area(poly) > 0
	for k in range(0, tri.size(), 3):
		for j in ([tri[k], tri[k + 1], tri[k + 2]] if cw else [tri[k], tri[k + 2], tri[k + 1]]): st.add_vertex(Vector3(poly[j].x, 0.08, poly[j].y))
	st.generate_normals()
	var w := StandardMaterial3D.new(); w.albedo_color = Color(0.06, 0.32, 0.4); w.roughness = 0.06; w.metallic = 0.35
	var nt := NoiseTexture2D.new(); nt.seamless = true; nt.as_normal_map = true; nt.bump_strength = 6; var fn := FastNoiseLite.new(); fn.frequency = 0.03; nt.noise = fn
	w.normal_enabled = true; w.normal_texture = nt; w.uv1_triplanar = true; w.uv1_world_triplanar = true; w.uv1_scale = Vector3.ONE / 14.0
	m.water = w
	var sm := MeshInstance3D.new(); sm.mesh = st.commit(); sm.material_override = w; m.add_child(sm)
	# plage : bande de sable clair le long de la cote (le cote mer est cache par l'eau), ecume blanche au bord
	var beach := SurfaceTool.new(); beach.begin(Mesh.PRIMITIVE_TRIANGLES); var foam := SurfaceTool.new(); foam.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in data.coast.size() - 1:
		var a := Vector2(data.coast[i][0], data.coast[i][1]); var b := Vector2(data.coast[i + 1][0], data.coast[i + 1][1])
		if a.length() > 2600 or a.distance_to(b) < 0.5: continue
		var n := (b - a).normalized(); n = Vector2(-n.y, n.x)
		for side in [-1.0, 1.0]:
			var q := [a, b, b + n * side * 45.0, a + n * side * 45.0]
			for k in [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]: beach.add_vertex(Vector3(q[k].x, 0.035, q[k].y))
			var f := [a, b, b + n * side * 2.5, a + n * side * 2.5]
			for k in [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]: foam.add_vertex(Vector3(f[k].x, 0.09, f[k].y))
	beach.generate_normals(); foam.generate_normals()
	var bm := MeshInstance3D.new(); bm.mesh = beach.commit(); bm.material_override = m._mat("res://textures/sand_02_diff.jpg", Color(1.35, 1.25, 1.05), 4.0); m.add_child(bm)
	var fm := StandardMaterial3D.new(); fm.albedo_color = Color(0.95, 0.97, 0.97, 0.75); fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var fmi := MeshInstance3D.new(); fmi.mesh = foam.commit(); fmi.material_override = fm; m.add_child(fmi)

# ---------------------------------------------------------------- marches (Sandaga, Kermel, Tilene...)
func markets() -> void:
	var table := BoxMesh.new(); table.size = Vector3(2.0, 0.9, 1.2)
	var roof := BoxMesh.new(); roof.size = Vector3(2.6, 0.05, 2.0)
	var pole := CylinderMesh.new(); pole.top_radius = 0.04; pole.bottom_radius = 0.04; pole.height = 2.4
	var wood: StandardMaterial3D = m._plain(Color("7a5a3a"), 1.0)
	var tarps := [Color("d8432f"), Color("2a7fd4"), Color("f2b01e"), Color("2f9e54"), Color("e8e2d4"), Color("9b4fc4")]
	var goods := [Color("f0a020"), Color("c0392b"), Color("27ae60"), Color("f4d03f"), Color("8e44ad"), Color("e67e22")]
	for mk in data.markets:
		var pts := PackedVector2Array(); for p in mk.pts: pts.append(Vector2(p[0], p[1]))
		var spots := []
		if pts.size() >= 3: # etals en rangees serrees, allees de 2 m
			var bb := Rect2(pts[0], Vector2.ZERO); for p in pts: bb = bb.expand(p)
			var x := bb.position.x + 1.5
			while x < bb.end.x:
				var z := bb.position.y + 1.5
				while z < bb.end.y:
					if Geometry2D.is_point_in_polygon(Vector2(x, z), pts) and rng.randf() < 0.85: spots.append(Vector2(x, z))
					z += 3.0
				x += 4.4
		else: # marche connu par un point : un carre d'etals autour
			for k in 40: spots.append(pts[0] + Vector2(rng.randf_range(-22, 22), rng.randf_range(-22, 22)))
		for p in spots:
			if on_road(p, 0.5): continue
			var g := Node3D.new(); g.position = Vector3(p.x, 0, p.y); g.rotation.y = rng.randf() * 0.2; m.add_child(g)
			m._part(g, table, Vector3(0, 0.45, 0), wood, true)
			var gm := BoxMesh.new(); gm.size = Vector3(1.8, 0.18, 1.0); m._part(g, gm, Vector3(0, 0.99, 0), m._plain(goods[rng.randi() % goods.size()], 0.8), false) # marchandises
			var tr := MeshInstance3D.new(); tr.mesh = roof; tr.material_override = m._plain(tarps[rng.randi() % tarps.size()], 0.8); tr.position = Vector3(0, 2.4, 0); tr.rotation.x = 0.12; g.add_child(tr)
			for c in [Vector3(-1.2, 1.2, -0.9), Vector3(1.2, 1.2, -0.9), Vector3(-1.2, 1.2, 0.9), Vector3(1.2, 1.2, 0.9)]:
				var pm := MeshInstance3D.new(); pm.mesh = pole; pm.material_override = wood; pm.position = c; g.add_child(pm)
			m._take(p.x, p.y, 2)
		if mk.name != "" and pts.size() > 0:
			var lb := Label3D.new(); lb.text = mk.name; lb.font_size = 64; lb.outline_size = 10; lb.billboard = BaseMaterial3D.BILLBOARD_ENABLED; lb.position = Vector3(pts[0].x, 7, pts[0].y); lb.pixel_size = 0.02; lb.visibility_range_end = 200.0; m.add_child(lb)

# ---------------------------------------------------------------- ecoles : mur peint, bandeau, drapeau dans la cour
func schools() -> void:
	for sc in data.schools:
		var pts := PackedVector2Array(); for p in sc.pts: pts.append(Vector2(p[0], p[1]))
		if pts.size() < 3 or pts.size() > 80: continue
		var wall := SurfaceTool.new(); wall.begin(Mesh.PRIMITIVE_TRIANGLES)
		for i in pts.size():
			var a := pts[i]; var b := pts[(i + 1) % pts.size()]
			if on_road((a + b) / 2.0, 0.3): continue
			for v in [[a, 0.0], [b, 0.0], [b, 2.3], [a, 0.0], [b, 2.3], [a, 2.3], [a, 0.0], [b, 2.3], [b, 0.0], [a, 0.0], [a, 2.3], [b, 2.3]]: wall.add_vertex(Vector3(v[0].x, v[1], v[0].y))
		wall.generate_normals()
		var wm := MeshInstance3D.new(); wm.mesh = wall.commit(); wm.material_override = m._plain([Color("f2e6c8"), Color("f4efe6"), Color("efd9a8")][rng.randi() % 3]); m.add_child(wm)
		var c := Vector2.ZERO; for p in pts: c += p
		_flag(Vector3(c.x / pts.size(), 0, c.y / pts.size()))

# ---------------------------------------------------------------- places publiques : pavees, bancs, pas de maison
func squares() -> void:
	var bench := BoxMesh.new(); bench.size = Vector3(1.9, 0.45, 0.5)
	var stone: StandardMaterial3D = m._plain(Color("cfc6b4"), 0.85)
	for pl in data.places:
		var pts := PackedVector2Array(); for p in pl.pts: pts.append(Vector2(p[0], p[1]))
		var tri := Geometry2D.triangulate_polygon(pts)
		if tri.is_empty(): continue
		var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); var flip: bool = m._area(pts) > 0
		for k in range(0, tri.size(), 3):
			for j in ([tri[k], tri[k + 2], tri[k + 1]] if flip else [tri[k], tri[k + 1], tri[k + 2]]): st.add_vertex(Vector3(pts[j].x, 0.07, pts[j].y))
		st.generate_normals()
		var mi := MeshInstance3D.new(); mi.mesh = st.commit(); mi.material_override = m._mat("res://textures/interlocking_concrete_pavers_diff.jpg", Color(1.3, 1.5, 1.6), 2.5); m.add_child(mi)
		for i in pts.size(): # bancs le long du bord, tournes vers l'interieur
			var a := pts[i]; var b := pts[(i + 1) % pts.size()]; var L := a.distance_to(b)
			if L < 6: continue
			var u := (b - a) / L; var n := Vector2(-u.y, u.x)
			if not Geometry2D.is_point_in_polygon((a + b) / 2.0 + n * 2.0, pts): n = -n
			var d := 4.0
			while d < L - 3:
				var p := a + u * d + n * 1.6
				var bg := Node3D.new(); bg.position = Vector3(p.x, 0, p.y); bg.rotation.y = atan2(n.x, n.y); m.add_child(bg); m._part(bg, bench, Vector3(0, 0.25, 0), stone, true)
				d += 8.0
		for p in pts: m._take(p.x, p.y, 2)

# ---------------------------------------------------------------- mobilier urbain : lampadaires, feux, poteaux Senelec
func _merge(parts: Array) -> Mesh: # [[PrimitiveMesh, Transform3D], ...] -> un seul maillage
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for p in parts: st.append_from(p[0], 0, p[1])
	st.generate_normals(); return st.commit()

func _multi(mesh: Mesh, mat: Material, xf: Array) -> void:
	if xf.is_empty(): return
	var mm := MultiMesh.new(); mm.transform_format = MultiMesh.TRANSFORM_3D; mm.mesh = mesh; mm.instance_count = xf.size()
	for i in xf.size(): mm.set_instance_transform(i, xf[i])
	var mi := MultiMeshInstance3D.new(); mi.multimesh = mm; mi.material_override = mat; m.add_child(mi)

var tl_mats := {} # feux : un materiau par couleur, allume ou eteint selon le cycle (main.gd appelle tick_lights)
func furniture() -> void:
	var cyl: Callable = func(r0: float, r1: float, h: float) -> CylinderMesh: var c := CylinderMesh.new(); c.top_radius = r0; c.bottom_radius = r1; c.height = h; c.radial_segments = 8; return c
	var box: Callable = func(x: float, y: float, z: float) -> BoxMesh: var b := BoxMesh.new(); b.size = Vector3(x, y, z); return b
	# lampadaire : mat gris, bras de 2,2 m vers la chaussee, tete qui eclaire
	var lamp_pole := _merge([[cyl.call(0.09, 0.13, 8.0), Transform3D(Basis(), Vector3(0, 4, 0))], [box.call(0.08, 0.08, 2.4), Transform3D(Basis(), Vector3(0, 7.9, 1.1))]])
	var lamp_head: Mesh = box.call(0.35, 0.12, 0.8)
	var poles := []; var heads := []
	for r in data.roads:
		if r.t > 3 or r.y != null: continue
		var off: float = r.w / 2.0 + maxf(0.6, r.side - 0.5); var acc := 15.0; var k := 0
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 0.5: continue
			var d := (b - a) / L; var n := Vector2(-d.y, d.x); var s := acc
			while s < L:
				var side := 1.0 if (k % 2 == 0 or r.w < 11) else -1.0; k += 1
				var p: Vector2 = a + d * s + n * off * side
				if not on_road(p, 3.0, r) and m._free(p.x, p.y):
					var rot := atan2(-n.x * side, -n.y * side) # bras vers la route
					poles.append(Transform3D(Basis(Vector3.UP, rot), Vector3(p.x, 0, p.y))); heads.append(Transform3D(Basis(Vector3.UP, rot), Vector3(p.x, 0, p.y)).translated_local(Vector3(0, 7.82, 2.2)))
					m._take(p.x, p.y, 1)
				s += 30.0
			acc = s - L
	var steel: StandardMaterial3D = m._plain(Color(0.47, 0.49, 0.52), 0.45); steel.metallic = 0.6
	var glow := StandardMaterial3D.new(); glow.albedo_color = Color(0.2, 0.2, 0.2); glow.emission_enabled = true; glow.emission = Color("ffd9a0"); glow.emission_energy_multiplier = 0.0
	m.lamp_glow = glow
	_multi(lamp_pole, steel, poles); _multi(lamp_head, glow, heads)
	# poteaux Senelec en bois avec trois cables qui pendent, d'un cote des rues de quartier
	var wpole := _merge([[cyl.call(0.11, 0.16, 9.4), Transform3D(Basis(), Vector3(0, 4.7, 0))], [box.call(1.8, 0.12, 0.12), Transform3D(Basis(), Vector3(0, 8.55, 0))]])
	var wp := []; var wire := SurfaceTool.new(); wire.begin(Mesh.PRIMITIVE_LINES)
	for r in data.roads:
		if r.t < 3 or r.t > 7 or r.w > 14 or r.y != null: continue
		var side := 1.0 if (r.pts.size() % 2 == 0) else -1.0; var off: float = r.w / 2.0 + maxf(0.6, r.side - 0.4); var acc := 0.0; var prev = null
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 0.5: continue
			var d := (b - a) / L; var n := Vector2(-d.y, d.x); var s := acc
			while s < L:
				var p: Vector2 = a + d * s + n * off * side
				if on_road(p, -0.4, r) or not m._free(p.x, p.y): prev = null
				else:
					wp.append(Transform3D(Basis(Vector3.UP, atan2(d.x, d.y)), Vector3(p.x, 0, p.y))); m._take(p.x, p.y, 1)
					if prev != null and p.distance_to(prev[0]) < 45:
						for kk in [-0.75, 0.75]: # deux cables de phase, flechissant de 0,9 m au milieu
							var p0: Vector2 = prev[0] + prev[1] * kk; var p1: Vector2 = p + n * kk
							for t in 8:
								for tt in [t / 8.0, (t + 1) / 8.0]: wire.add_vertex(Vector3(lerpf(p0.x, p1.x, tt), 8.6 - 3.6 * tt * (1.0 - tt), lerpf(p0.y, p1.y, tt)))
					prev = [p, n]
				s += 32.0
			acc = s - L
	_multi(wpole, m._plain(Color("6b5440"), 1.0), wp)
	var wm := MeshInstance3D.new(); wm.mesh = wire.commit(); wm.material_override = m._plain(Color(0.08, 0.08, 0.08)); m.add_child(wm)
	# feux tricolores aux vrais carrefours OSM : mat, boitier, trois feux qui changent
	for c in ["r", "y", "g"]:
		var mt := StandardMaterial3D.new(); mt.albedo_color = Color(0.1, 0.1, 0.1); mt.emission_enabled = true
		mt.emission = {"r": Color(1, 0.1, 0.05), "y": Color(1, 0.7, 0.05), "g": Color(0.1, 1, 0.3)}[c]; tl_mats[c] = mt
	var dark: StandardMaterial3D = m._plain(Color(0.12, 0.12, 0.12), 0.5); var bulb := SphereMesh.new(); bulb.radius = 0.12; bulb.height = 0.24
	for sgn in data.signals:
		var p := Vector2(sgn[0], sgn[1]); var nr := nearest(p)
		if nr.is_empty(): continue
		var r: Dictionary = nr.r; var dir := Vector2.ZERO
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1])
			if Geometry2D.get_closest_point_to_segment(p, a, b).distance_to(nr.p) < 0.5: dir = (b - a).normalized()
		var n := Vector2(-dir.y, dir.x); var q: Vector2 = nr.p + n * (r.w / 2.0 + 0.8)
		var g := Node3D.new(); g.position = Vector3(q.x, 0, q.y); g.rotation.y = atan2(-dir.x, -dir.y); m.add_child(g)
		m._part(g, cyl.call(0.06, 0.08, 3.6), Vector3(0, 1.8, 0), dark, true); m._part(g, box.call(0.35, 1.0, 0.3), Vector3(0, 3.9, 0), dark, false)
		for k in 3:
			var c: String = ["r", "y", "g"][k]; var bm := MeshInstance3D.new(); bm.mesh = bulb; bm.material_override = tl_mats[c]; bm.position = Vector3(0, 4.25 - k * 0.33, 0.14); g.add_child(bm)

# cycle des feux : vert 12 s, orange 3 s, rouge 15 s
func tick_lights(t: float) -> void:
	if tl_mats.is_empty(): return
	var ph := fmod(t, 30.0); var on := "g" if ph < 12 else ("y" if ph < 15 else "r")
	for c in tl_mats: tl_mats[c].emission_energy_multiplier = 3.0 if c == on else 0.0

# ---------------------------------------------------------------- vie de rue : voitures garees, kiosques, toits, murs de concession
const CARS := {"taxisn": 4.3, "peugeot405": 4.4, "clando": 4.4, "mercedes": 4.5, "carrapide": 5.8, "ndiaga": 7.0}
var roofs := [] # [centre Vector2, hauteur] des toits-terrasses (rempli par main.gd)
var compounds := [] # empreintes des maisons qui recoivent un mur de cloture

func _car_xf(name: String, p: Vector2, heading: float) -> Transform3D: # modele a sa vraie longueur, axe long sur la rue
	var S: Vector3 = model(name).size; var k: float = CARS[name] / maxf(S.x, S.z)
	var rot := heading + (PI / 2.0 if S.x > S.z else 0.0)
	if name in ["taxisn", "ndiaga"]: rot += PI # modeles dessines a l'envers
	return Transform3D(Basis(Vector3.UP, rot) * Basis.from_scale(Vector3(k, k, k)), Vector3(p.x, 0.05, p.y))

func street_life() -> void:
	var weights := ["taxisn", "taxisn", "taxisn", "peugeot405", "clando", "clando", "mercedes", "carrapide", "ndiaga"]
	var props := ["kiosque_om", "kiosque_om", "cafe", "fruitcart"]
	for r in data.roads:
		if r.t < 3 or r.t > 7 or r.y != null: continue
		var acc := rng.randf_range(4, 12)
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 0.5: continue
			var d := (b - a) / L; var n := Vector2(-d.y, d.x); var s := acc
			while s < L:
				var side := 1.0 if rng.randf() < 0.5 else -1.0; var roll := rng.randf()
				if roll < 0.16 and r.t >= 4: # voiture garee le long du trottoir
					var p: Vector2 = a + d * s + n * side * (r.w / 2.0 - 1.1)
					if not on_road(p, 1.0, r):
						var name: String = weights[rng.randi() % weights.size()]
						var xf := _car_xf(name, p, atan2(d.x, d.y) + (0.0 if rng.randf() < 0.5 else PI))
						if not placed.has(name): placed[name] = []
						placed[name].append([xf, Color.WHITE])
				elif roll < 0.21: # kiosque Orange Money, cafe Touba, charrette de fruits sur le trottoir
					var p2: Vector2 = a + d * s + n * side * (r.w / 2.0 + r.side * 0.6 + 0.6)
					if m._free(p2.x, p2.y) and not on_road(p2, 0.5, r):
						var pn: String = props[rng.randi() % props.size()]; var S: Vector3 = model(pn).size; var k := 2.6 / maxf(S.x, S.z)
						place(pn, p2.x, p2.y, atan2(-n.x * side, -n.y * side), k, k, k, Color.WHITE); m._take(p2.x, p2.y, 2)
				s += rng.randf_range(7, 15)
			acc = s - L
	# toits : citernes noires (Polytank), paraboles
	var tank := CylinderMesh.new(); tank.top_radius = 0.55; tank.bottom_radius = 0.5; tank.height = 1.25
	var dish := SphereMesh.new(); dish.radius = 0.42; dish.height = 0.3
	var tx := []; var dx := []
	for rf in roofs:
		var c: Vector2 = rf[0]; var h: float = rf[1]
		tx.append(Transform3D(Basis(), Vector3(c.x + rng.randf_range(-2, 2), h + 0.62, c.y + rng.randf_range(-2, 2))))
		if rng.randf() < 0.5: dx.append(Transform3D(Basis(Vector3.RIGHT, -1.0), Vector3(c.x + 2.5, h + 0.9, c.y - 1.5)))
	_multi(tank, m._plain(Color(0.11, 0.11, 0.12), 0.6), tx); _multi(dish, m._plain(Color(0.85, 0.85, 0.85), 0.4), dx)
	# murs de cloture autour des maisons de quartier, portail du cote de la rue
	var wall := SurfaceTool.new(); wall.begin(Mesh.PRIMITIVE_TRIANGLES)
	for pts in compounds:
		var o := obb(pts)
		if o.is_empty(): continue
		var hu: float = o.a / 2.0 + 1.8; var hv: float = o.b / 2.0 + 1.8
		var cs := [o.c + o.u * -hu + o.v * -hv, o.c + o.u * hu + o.v * -hv, o.c + o.u * hu + o.v * hv, o.c + o.u * -hu + o.v * hv]
		var gate := 0; var gd := 1e9
		for i in 4:
			var nr := nearest((cs[i] + cs[(i + 1) % 4]) / 2.0)
			if not nr.is_empty() and nr.d < gd: gd = nr.d; gate = i
		for i in 4:
			var a: Vector2 = cs[i]; var b: Vector2 = cs[(i + 1) % 4]
			var parts := [[a, b]] if i != gate else [[a, a.lerp(b, 0.4)], [a.lerp(b, 0.6), b]]
			for pr in parts:
				var p0: Vector2 = pr[0]; var p1: Vector2 = pr[1]
				if on_road((p0 + p1) / 2.0, 0.2): continue
				for v in [[p0, 0.0], [p1, 0.0], [p1, 2.2], [p0, 0.0], [p1, 2.2], [p0, 2.2], [p0, 0.0], [p1, 2.2], [p1, 0.0], [p0, 0.0], [p0, 2.2], [p1, 2.2]]: wall.add_vertex(Vector3(v[0].x, v[1], v[0].y))
	wall.generate_normals()
	var wmi := MeshInstance3D.new(); wmi.mesh = wall.commit(); wmi.material_override = m._mat("res://textures/worn_plaster_wall_diff.jpg", Color(1.05, 1.0, 0.92), 3.0); m.add_child(wmi)

# ---------------------------------------------------------------- remplissage : OSM n'a pas tous les batiments de Dakar.
# Comme la version web, on construit des maisons du quartier le long des rues la ou le terrain est libre.
func infill() -> void:
	var n := 0
	for r in data.roads:
		if r.t < 2 or r.t > 7 or r.y != null: continue
		var st: Dictionary = STYLES.get(r.get("style", "banlieue"), STYLES.banlieue)
		var acc := rng.randf_range(2, 6)
		for i in r.pts.size() - 1:
			var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L := a.distance_to(b)
			if L < 4: continue
			var d := (b - a) / L; var nn := Vector2(-d.y, d.x); var s := acc
			while s < L - 3:
				for side in [-1.0, 1.0]:
					if rng.randf() < 0.15: continue # une parcelle vide de temps en temps
					var name: String = st.houses[rng.randi() % st.houses.size()]; var S: Vector3 = model(name).size
					var depth := S.z; var off: float = r.w / 2.0 + r.side + 1.0 + depth / 2.0
					var c: Vector2 = a + d * s + nn * side * off
					var ok := true
					for corner in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1), Vector2.ZERO]:
						var q: Vector2 = c + d * corner.x * S.x / 2.0 + nn * corner.y * depth / 2.0
						if not m._free(q.x, q.y) or on_road(q, 0.8): ok = false; break
					if not ok: continue
					var rot := atan2(-nn.x * side, -nn.y * side) # facade vers la rue
					place(name, c.x, c.y, rot, 1, 1, 1, Color(st.pal[rng.randi() % st.pal.size()])); m._take(c.x, c.y, maxf(S.x, depth) / 2.0 + 0.5); n += 1
					if r.get("style", "") != "plateau" and rng.randf() < 0.4:
						compounds.append(PackedVector2Array([c + d * -S.x / 2.0 + nn * -depth / 2.0, c + d * S.x / 2.0 + nn * -depth / 2.0, c + d * S.x / 2.0 + nn * depth / 2.0, c + d * -S.x / 2.0 + nn * depth / 2.0]))
				s += rng.randf_range(11, 15)
			acc = s - L
	print("maisons ajoutees le long des rues : ", n)
