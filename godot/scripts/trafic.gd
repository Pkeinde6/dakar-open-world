# Trafic de Dakar : taxis, clandos, cars rapides, Ndiaga Ndiaye qui suivent les vraies rues, tournent aux carrefours,
# s'arretent aux feux rouges et derriere la voiture de devant. Si le joueur percute des voitures, la police arrive
# et le poursuit ; elle abandonne quand il s'est eloigne assez longtemps.
extends Node3D

const MIX := [["taxisn", 4.3, 13.0], ["taxisn", 4.3, 13.0], ["clando", 4.4, 12.0], ["peugeot405", 4.4, 13.0], ["carrapide", 5.8, 9.0], ["ndiaga", 7.0, 8.0], ["mercedes", 4.5, 14.0]]
var main: Node3D
var data: Dictionary
var ends := {} # noeud arrondi -> [[route, 0 ou dernier indice], ...] pour tourner aux carrefours
var cars := []
var cops := []
const POLICE := false
var wanted := 0.0
var calm := 0.0
var stars: Label
var templates := {}

func setup(m: Node3D, d: Dictionary, n: int) -> void:
	main = m; data = d; rebuild()
	for i in n: cars.append(_new_car(MIX[i % MIX.size()]))
	stars = Label.new(); stars.anchor_left = 1.0; stars.anchor_right = 1.0; stars.offset_left = -230; stars.position.y = 10; stars.add_theme_font_size_override("font_size", 30); stars.add_theme_color_override("font_color", Color(1, 0.85, 0.2))
	var hud := CanvasLayer.new(); add_child(hud); hud.add_child(stars); stars.visible = POLICE

# carrefours et coupures de tuile : quels morceaux de rue partent de chaque point (refait quand une tuile arrive ou part)
func rebuild() -> void:
	ends.clear()
	for r in data.roads:
		if r.t > 6 or r.pts.size() < 2: continue
		for e in [0, r.pts.size() - 1]:
			var k := _key(r.pts[e])
			if not ends.has(k): ends[k] = []
			ends[k].append([r, e])
	for c in cars: # une voiture dont la rue a disparu repart ailleurs
		if c.r != null and not data.roads.has(c.r): c.r = null; c.body.visible = false

func _key(p) -> String: return "%d,%d" % [roundi(p[0]), roundi(p[1])]

func _visual(name: String, length: float) -> Node3D:
	if not templates.has(name): templates[name] = load("res://models/%s.glb" % name)
	var v: Node3D = templates[name].instantiate()
	var box := AABB(); var first := true
	for mi in v.find_children("*", "MeshInstance3D", true, false):
		if String(mi.name).contains("Collision") or String(mi.name).contains("Shadow"): mi.visible = false; continue
		var bb: AABB = mi.global_transform * mi.get_aabb() if mi.is_inside_tree() else _rel(v, mi) * mi.get_aabb()
		box = bb if first else box.merge(bb); first = false
	var k := length / maxf(box.size.x, box.size.z)
	var holder := Node3D.new(); holder.add_child(v)
	v.scale = Vector3(k, k, k); v.position = Vector3(-box.get_center().x * k, -box.position.y * k, -box.get_center().z * k)
	if name in ["taxisn", "ndiaga", "police"]: v.rotate_y(PI); v.position = Vector3(box.get_center().x * k, -box.position.y * k, box.get_center().z * k) # modeles dessines a l'envers
	if box.size.x > box.size.z: # axe long sur x : on tourne pour qu'il soit sur z (le sens de la marche)
		var piv := Node3D.new(); holder.remove_child(v); piv.add_child(v); piv.rotation.y = PI / 2; holder.add_child(piv)
	return holder

func _rel(root: Node, n: Node3D) -> Transform3D:
	var t := n.transform; var p := n.get_parent()
	while p and p != root:
		if p is Node3D: t = p.transform * t
		p = p.get_parent()
	return t

func _new_car(spec: Array) -> Dictionary:
	var body := AnimatableBody3D.new(); body.sync_to_physics = false; add_child(body)
	var vis := _visual(spec[0], spec[1]); body.add_child(vis)
	var cs := CollisionShape3D.new(); var bx := BoxShape3D.new(); bx.size = Vector3(1.8, 1.5, spec[1]); cs.shape = bx; cs.position.y = 0.8; body.add_child(cs)
	body.visible = false
	return {"body": body, "len": spec[1], "vmax": spec[2], "r": null, "s": 0.0, "dir": 1, "v": 0.0, "pos": Vector3.ZERO, "hit": 0.0}

func _spawn(c: Dictionary, around: Vector3) -> void:
	for tries in 8:
		if data.roads.is_empty(): return
		var r: Dictionary = data.roads[randi() % data.roads.size()]
		if r.t > 5 or r.pts.size() < 2: continue
		var i: int = randi() % (r.pts.size() - 1); var p := Vector3(r.pts[i][0], 0, r.pts[i][1])
		var dd := p.distance_to(around)
		if dd < 70 or dd > 260 or _seen(p, 150.0): continue # jamais sous les yeux du joueur : derriere lui ou loin
		c.r = r; c.dir = 1 if randf() < 0.5 else -1; c.s = _cum(r, i); c.v = c.vmax * 0.6; c.body.visible = true; return

# le point est-il dans le champ de la camera (et pas trop loin) ?
func _seen(p: Vector3, far: float) -> bool:
	var cam := get_viewport().get_camera_3d()
	if cam == null: return false
	if cam.global_position.distance_to(p) > far: return false
	return not cam.is_position_behind(p + Vector3.UP) and cam.is_position_in_frustum(p + Vector3.UP)

func _cum(r: Dictionary, upto: int) -> float:
	if not r.has("cum"):
		var cum := [0.0]
		for i in range(1, r.pts.size()): cum.append(cum[i - 1] + Vector2(r.pts[i][0], r.pts[i][1]).distance_to(Vector2(r.pts[i - 1][0], r.pts[i - 1][1])))
		r["cum"] = cum
	return r.cum[upto]

# point, direction and deck height at distance s along r
func _at(r: Dictionary, s: float) -> Array:
	_cum(r, 0); var cum: Array = r.cum; var i := 0
	while i < cum.size() - 2 and cum[i + 1] < s: i += 1
	var a := Vector2(r.pts[i][0], r.pts[i][1]); var b := Vector2(r.pts[i + 1][0], r.pts[i + 1][1]); var L: float = maxf(0.01, cum[i + 1] - cum[i]); var t := clampf((s - cum[i]) / L, 0, 1)
	var y := 0.0
	if r.y != null: y = lerpf(r.y[i], r.y[i + 1], t)
	return [a.lerp(b, t), (b - a).normalized(), y]

func _turn(c: Dictionary) -> void: # au bout de la rue : une autre rue qui part du meme carrefour, sinon demi-tour
	var r: Dictionary = c.r; var e: int = r.pts.size() - 1 if c.dir > 0 else 0
	var opts: Array = ends.get(_key(r.pts[e]), []).filter(func(o): return o[0] != r and o[0].t <= 5)
	if opts.is_empty(): # impasse ou tuile voisine pas encore construite
		if not _seen(c.pos, 400.0): c.r = null; c.body.visible = false; return # hors de vue : elle repart ailleurs
		c.dir = -c.dir; c.v = 0.0; c.s = clampf(c.s, 0.0, _cum(r, r.pts.size() - 1)); return # sous les yeux : arret puis demi-tour
	var o: Array = opts[randi() % opts.size()]; c.r = o[0]
	if o[1] == 0: c.dir = 1; c.s = 0.0
	else: c.dir = -1; c.s = _cum(c.r, c.r.pts.size() - 1)

func _red_ahead(p: Vector2, d: Vector2) -> bool:
	var grp := "A" if absf(d.x) > absf(d.y) else "B" # meme groupe que le feu de sa direction
	if preload("res://scripts/ville.gd").light_state(main.clock, grp) == "g": return false
	for sg in data.signals:
		var q := Vector2(sg[0], sg[1]) - p
		if q.length() < 16 and q.length() > 4 and q.normalized().dot(d) > 0.7: return true
	return false

func _physics_process(dt: float) -> void:
	var pl: Node3D = main.car if main.driving else main.avatar
	var ppos := pl.global_position
	for c in cars:
		if c.r == null or (c.pos.distance_to(ppos) > 280 and not _seen(c.pos, 400.0)):
			c.body.visible = false; c.r = null; _spawn(c, ppos)
			if c.r == null: continue
		var r: Dictionary = c.r; var total: float = _cum(r, r.pts.size() - 1)
		var cur := _at(r, c.s); var p: Vector2 = cur[0]; var d: Vector2 = cur[1] * c.dir
		# vitesse voulue : limite du type, freinage derriere une voiture, au feu rouge, devant le joueur
		var want: float = c.vmax * (1.3 if r.t <= 1 else 1.0)
		var lane0: float = r.w / 4.0 if not r.ow else 0.0; var me := p + Vector2(-d.y, d.x) * lane0 # le centre de ma voie
		for o in cars + cops: # on ne freine que pour ce qui est devant, dans ma voie (pas sur l'autre voie ni garee au bord)
			if o == c or not o.body.visible: continue
			var q: Vector2 = Vector2(o.pos.x, o.pos.z) - me; var ahead := q.dot(d); var side := absf(q.dot(Vector2(-d.y, d.x)))
			if ahead > 0 and ahead < 16 and side < 1.6: want = minf(want, maxf(0, (ahead - c.len - 2.0) * 1.2))
		var qp := Vector2(ppos.x, ppos.z) - me; var pa := qp.dot(d); var ps := absf(qp.dot(Vector2(-d.y, d.x)))
		if pa > 0 and pa < 16 and ps < 1.8: want = minf(want, maxf(0, (pa - 6.0) * 1.0))
		if _red_ahead(p, d): want = 0.0
		c.v = move_toward(c.v, want, (8.0 if want < c.v else 3.0) * dt)
		c.s += c.v * c.dir * dt
		if c.s > total or c.s < 0: _turn(c); continue
		var lane: float = r.w / 4.0 if not r.ow else 0.0 # on roule a droite
		var n := Vector2(-d.y, d.x)
		var pos := Vector3(p.x + n.x * lane, cur[2] + 0.05, p.y + n.y * lane) # n = droite de la voiture : on roule a droite, comme au Senegal
		c.pos = pos; c.body.global_transform = Transform3D(Basis(Vector3.UP, atan2(d.x, d.y)), pos)
		# choc avec la voiture du joueur : plus d'etoiles de police
		c.hit -= dt
		if main.driving and c.hit <= 0 and pos.distance_to(ppos) < c.len / 2.0 + 2.0 and main.car.linear_velocity.length() > 6:
			c.hit = 2.0 # police desactivee pour le moment (POLICE = true pour la remettre)
			if POLICE: wanted = minf(5, wanted + 1); calm = 0.0
	_police(dt, ppos)

func _police(dt: float, ppos: Vector3) -> void:
	while cops.size() < int(ceil(wanted)) and cops.size() < 3:
		var c := _new_car(["police", 4.9, 22.0]); c.body.visible = true
		var a := randf() * TAU; c.pos = ppos + Vector3(cos(a), 0, sin(a)) * 90.0; cops.append(c)
	for c in cops: # la police fonce droit vers le joueur, et ralentit a 6 m
		var to: Vector3 = ppos - c.pos; to.y = 0
		var want: float = 0.0 if to.length() < 6 else c.vmax
		c.v = move_toward(c.v, want, 10.0 * dt)
		if to.length() > 0.1: c.pos += to.normalized() * c.v * dt
		c.body.global_transform = Transform3D(Basis(Vector3.UP, atan2(to.x, to.z)), Vector3(c.pos.x, 0.05, c.pos.z))
	# on se calme : loin de la police pendant 25 s
	var near := cops.any(func(c): return c.pos.distance_to(ppos) < 60)
	calm = 0.0 if near else calm + dt
	if wanted > 0 and calm > 25: wanted = 0.0; calm = 0.0
	if wanted == 0 and not cops.is_empty():
		for c in cops: c.body.queue_free()
		cops.clear()
	stars.text = "★".repeat(int(ceil(wanted))) + "☆".repeat(5 - int(ceil(wanted)))
