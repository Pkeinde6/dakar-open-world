# Histoire et courses de clando (comme la version web) : Modou arrive de Diourbel, son cousin lui prete un clando,
# 5 courses dans Dakar pour gagner sa place. Un client attend au bord de la route (colonne jaune) ; on s'arrete pres de lui,
# il donne son quartier ; le GPS calcule l'itineraire sur les rues de tout Dakar et le marque au sol (bande violette a
# chevrons qui defilent). Paiement a l'arrivee : course au kilometre + pourboire, moins les degats.
extends Node3D

const GOAL := 5
const DLG := {
	"pickup": ["Salamaleikoum chauffeur ! Je vais à {d}.", "Asalaa maalekum. {d}, bu la neexee.", "Chauffeur, {d} c'est combien ? … Bon, waaw, on y va.", "Na nga def ? Yobbu ma ci {d}, gaawal !", "Bonjour tonton, {d} s'il te plaît."],
	"ride": ["Ndank ndank chauffeur, doucement !", "Ce bouchon de Dakar, dafa metti…", "Monte la radio, c'est Youssou Ndour !", "Il fait chaud hein… Dakar dafa tang !"],
	"arrive": ["Jërëjëf ! Voilà ton argent.", "Merci chauffeur, Yàlla na la Yàlla barkeel.", "Ba beneen yoon ! À la prochaine."],
}
var main: Node3D
var quartiers := [] # [nom, x, z]
var nodes := {} # "x,z" -> Vector2 ; graphe des rues principales pour le GPS
var adj := {} # "x,z" -> [[voisin, longueur]]
var ngrid := {} # carre de 100 m -> noeuds, pour trouver la rue la plus proche sans tout parcourir
var money := 2000
var done := 0
var stage := "none" # none, pickup, carry
var pick := {}
var drop := {}
var hp0 := 0.0
var marker: Node3D
var route_mi := MeshInstance3D.new()
var route_mat := StandardMaterial3D.new()
var route_t := 0.0
var talk_t := 0.0
var hud_money: Label
var hud_rides: Label
var subs_box: PanelContainer
var subs: RichTextLabel
var card: PanelContainer
var started := false
var path := PackedVector2Array() # dernier itineraire calcule (pour les cartes)

func setup(m: Node3D, monde: Dictionary, hud: CanvasLayer) -> void:
	main = m
	quartiers = JSON.parse_string(FileAccess.get_file_as_string("res://data/quartiers.json"))
	for r in monde.get("carte", []): # graphe : chaque point de rue est un noeud, relie a ses voisins
		var prev := ""
		for i in range(1, r.size(), 2):
			var k := "%d,%d" % [r[i], r[i + 1]]; nodes[k] = Vector2(r[i], r[i + 1])
			var gk := Vector2i(floori(r[i] / 100.0), floori(r[i + 1] / 100.0)); if not ngrid.has(gk): ngrid[gk] = []
			ngrid[gk].append(k)
			if not adj.has(k): adj[k] = []
			if prev != "": var L: float = nodes[k].distance_to(nodes[prev]); adj[k].append([prev, L]); adj[prev].append([k, L])
			prev = k
	# colonne jaune lumineuse du client ou de la destination
	marker = Node3D.new(); add_child(marker); marker.visible = false
	var col := CylinderMesh.new(); col.top_radius = 4.5; col.bottom_radius = 4.5; col.height = 40; col.cap_top = false; col.cap_bottom = false
	var cm := StandardMaterial3D.new(); cm.albedo_color = Color(1, 0.82, 0.25, 0.25); cm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; cm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; cm.cull_mode = BaseMaterial3D.CULL_DISABLED; cm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	var cmi := MeshInstance3D.new(); cmi.mesh = col; cmi.material_override = cm; cmi.position.y = 20; marker.add_child(cmi)
	# marquage au sol : chevrons violets qui defilent dans le sens de la marche
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8); img.fill(Color(0, 0, 0, 0))
	for y in 64:
		for x in 64:
			var v := absf(x - 32) / 32.0; var row := fmod(y + v * 22.0, 32.0)
			if row < 11: img.set_pixel(x, y, Color(0.8, 0.3, 1.0, 0.95))
			elif absf(x - 32) > 28: img.set_pixel(x, y, Color(0.75, 0.3, 1.0, 0.6))
	route_mat.albedo_texture = ImageTexture.create_from_image(img); route_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA; route_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	route_mat.emission_enabled = true; route_mat.emission = Color(0.6, 0.2, 0.9); route_mat.cull_mode = BaseMaterial3D.CULL_DISABLED; route_mat.no_depth_test = false
	add_child(route_mi); route_mi.material_override = route_mat
	# interface : argent, sous-titres, carte de chapitre
	var UI := preload("res://scripts/ui.gd")
	var money_box := UI.panel(0.72, 14, 16, true); money_box.anchor_left = 1; money_box.anchor_right = 1; money_box.grow_horizontal = Control.GROW_DIRECTION_BEGIN; money_box.offset_right = -18; money_box.offset_top = 16
	var vb := VBoxContainer.new(); money_box.add_child(vb); hud_money = UI.label("", 26, Color("7ee081"), true); vb.add_child(hud_money); hud_rides = UI.label("", 15, Color(1, 1, 1, 0.8)); vb.add_child(hud_rides); hud.add_child(money_box)
	subs_box = UI.panel(0.7, 12, 20); subs_box.anchor_left = 0.5; subs_box.anchor_right = 0.5; subs_box.anchor_top = 1; subs_box.anchor_bottom = 1; subs_box.grow_horizontal = Control.GROW_DIRECTION_BOTH; subs_box.offset_top = -160; subs_box.visible = false
	subs = RichTextLabel.new(); subs.bbcode_enabled = true; subs.fit_content = true; subs.autowrap_mode = TextServer.AUTOWRAP_OFF; subs.scroll_active = false; subs.add_theme_font_size_override("normal_font_size", 20); subs.add_theme_font_size_override("bold_font_size", 20); subs_box.add_child(subs); hud.add_child(subs_box)
	card = UI.panel(0.9, 18, 34, true); card.set_anchors_preset(Control.PRESET_CENTER); card.grow_horizontal = Control.GROW_DIRECTION_BOTH; card.grow_vertical = Control.GROW_DIRECTION_BOTH
	var cv := VBoxContainer.new(); cv.add_theme_constant_override("separation", 14); card.add_child(cv)
	cv.add_child(UI.label("CHAPITRE 1", 15, UI.ACCENT)); cv.add_child(UI.label("Le clando", 40, UI.TEXT, true))
	var body: Label = UI.label("Tu t'appelles Modou. Tu arrives de Diourbel avec un rêve : avoir ta propre affaire de transport. Ton cousin Pape te prête son vieux clando. Fais %d courses dans Dakar pour gagner ta place." % GOAL, 19, Color(1, 1, 1, 0.88))
	body.autowrap_mode = TextServer.AUTOWRAP_WORD; body.custom_minimum_size = Vector2(560, 0); cv.add_child(body)
	cv.add_child(UI.label("Argent : " + fmt(money), 18, Color("7ee081")))
	var go := UI.panel(1.0, 10, 18); go.get_theme_stylebox("panel").bg_color = UI.ACCENT; go.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	go.add_child(UI.label("Entrée  ·  Commencer", 19, Color("1b1f27"))); cv.add_child(go); hud.add_child(card)
	if main.capture != "": card.visible = false # pas sur les captures de controle

func fmt(n: float) -> String: # 12 500 FCFA
	var s := str(int(n)); var out := ""
	while s.length() > 3: out = " " + s.substr(s.length() - 3) + out; s = s.substr(0, s.length() - 3)
	return s + out + " FCFA"

func say(who: String, txt: String) -> void:
	subs.text = ("[color=#f2c14e][b]%s[/b][/color]  %s" % [who.trim_suffix(" :"), txt]) if who != "" else txt; subs_box.visible = true; talk_t = 5.0

func _unhandled_input(e: InputEvent) -> void:
	if not started and e is InputEventKey and e.pressed and e.keycode in [KEY_ENTER, KEY_KP_ENTER]: started = true; card.visible = false; _new_mission()

func _nearest_node(p: Vector2) -> String:
	var best := ""; var bd := 1e18; var c := Vector2i(floori(p.x / 100.0), floori(p.y / 100.0))
	for ring in 6: # on elargit jusqu'a trouver une rue
		for a in range(-ring, ring + 1):
			for b in range(-ring, ring + 1):
				if maxi(absi(a), absi(b)) != ring: continue
				for k in ngrid.get(c + Vector2i(a, b), []):
					var d: float = nodes[k].distance_squared_to(p)
					if d < bd: bd = d; best = k
		if best != "": return best
	return best

func _spot(from: Vector2, dmin: float, dmax: float) -> Dictionary: # un point de rue (et son quartier) a bonne distance
	for t in 40:
		var q: Array = quartiers[randi() % quartiers.size()]; var p := Vector2(q[1], q[2]) + Vector2(randf_range(-150, 150), randf_range(-150, 150))
		var d := p.distance_to(from)
		if d < dmin or d > dmax: continue
		var k := _nearest_node(p); if k == "": continue
		return {"p": nodes[k], "name": q[0]}
	return {}

func _new_mission() -> void:
	var pl := _player_pos(); var pk := {}
	var best := 1e9 # client tout pres, sur une rue deja construite
	for r in main.data.roads:
		if r.t < 2 or r.t > 7: continue
		var p := Vector2(r.pts[0][0], r.pts[0][1]); var d := p.distance_to(pl)
		if d > 150 and d < 700 and absf(d - 350) < best: best = absf(d - 350); pk = {"p": p}
	if pk.is_empty(): return
	var nm := ""; var bd := 1e9
	for q in quartiers:
		var d := Vector2(q[1], q[2]).distance_to(pk.p)
		if d < bd: bd = d; nm = q[0]
	pick = {"p": pk.p, "name": nm}; stage = "pickup"; _target(pick.p)
	say("", "Client à %s — suis le marquage violet" % pick.name)

func _target(p: Vector2) -> void: marker.visible = true; marker.global_position = Vector3(p.x, 0, p.y); route_t = 0.0; path = PackedVector2Array()

func _player_pos() -> Vector2:
	var pl: Node3D = main.car if main.driving else main.avatar
	return Vector2(pl.global_position.x, pl.global_position.z)

# A* sur les rues principales : liste de points du joueur jusqu'a la cible
func _route(a: Vector2, b: Vector2) -> PackedVector2Array:
	var s := _nearest_node(a); var g := _nearest_node(b); var out := PackedVector2Array()
	if s == "" or g == "": return out
	var heap := [[nodes[s].distance_to(nodes[g]), s]]; var came := {}; var gs := {s: 0.0}; var shut := {}; var it := 0
	while not heap.is_empty() and it < 60000: # tas binaire : le noeud le plus prometteur en tete
		it += 1; var top: Array = _pop(heap); var cur: String = top[1]
		if shut.has(cur): continue
		if cur == g: break
		shut[cur] = true
		for e in adj.get(cur, []):
			var ng: float = gs[cur] + e[1]
			if ng < gs.get(e[0], 1e18): came[e[0]] = cur; gs[e[0]] = ng; _push(heap, [ng + nodes[e[0]].distance_to(nodes[g]), e[0]])
	if not came.has(g) and s != g: out.append(a); out.append(b); return out
	var k := g
	while k != s: out.insert(0, nodes[k]); k = came[k]
	out.insert(0, a); out.append(b)
	return out

func _push(h: Array, e: Array) -> void:
	h.append(e); var i := h.size() - 1
	while i > 0:
		var p := (i - 1) >> 1
		if h[p][0] <= h[i][0]: break
		var t = h[p]; h[p] = h[i]; h[i] = t; i = p
func _pop(h: Array) -> Array:
	var top: Array = h[0]; var last: Array = h.pop_back()
	if not h.is_empty():
		h[0] = last; var i := 0
		while true:
			var l := 2 * i + 1; var r := l + 1; var m := i
			if l < h.size() and h[l][0] < h[m][0]: m = l
			if r < h.size() and h[r][0] < h[m][0]: m = r
			if m == i: break
			var t = h[m]; h[m] = h[i]; h[i] = t; i = m
	return top

func _draw_route(path: PackedVector2Array) -> void: # bande de 1,6 m au milieu de la route, sur les 700 premiers metres
	var st := SurfaceTool.new(); st.begin(Mesh.PRIMITIVE_TRIANGLES); var run := 0.0
	for i in path.size() - 1:
		var a := path[i]; var b := path[i + 1]; var L := a.distance_to(b)
		if L < 0.3: continue
		var d := (b - a) / L; var n := Vector2(-d.y, d.x) * 0.8
		var v := [[a - n, run], [b - n, run + L], [b + n, run + L], [a + n, run]]
		for k in [0, 1, 2, 0, 2, 3]:
			st.set_uv(Vector2(0.0 if k in [0, 1] else 1.0, -v[k][1] / 2.5)); st.add_vertex(Vector3(v[k][0].x, 0.26, v[k][0].y))
		run += L
		if run > 700: break
	route_mi.mesh = st.commit() if run > 0 else null

func _process(dt: float) -> void:
	hud_money.text = "%s\nCourses %d/%d" % [fmt(money), done, GOAL]
	talk_t -= dt
	if talk_t < 0: subs_box.visible = false
	if not started or stage == "none": return
	route_mat.uv1_offset.y -= dt * 0.8 # les chevrons avancent
	var pl := _player_pos(); var tgt: Vector2 = pick.p if stage == "pickup" else drop.p
	route_t -= dt
	if route_t <= 0: # itineraire calcule une fois ; on efface ce qui est parcouru ; nouveau calcul seulement hors route
		route_t = 1.0
		var off := 1e9; var cut := 0
		for i in mini(path.size() - 1, 60):
			var d := Geometry2D.get_closest_point_to_segment(pl, path[i], path[i + 1]).distance_to(pl)
			if d < off: off = d; cut = i
		if path.size() < 2 or off > 40.0: path = _route(pl, tgt)
		else:
			path = path.slice(cut); path[0] = pl
		_draw_route(path)
	var slow: bool = main.driving and main.car.linear_velocity.length() < 3.0
	if pl.distance_to(tgt) < 9.0 and slow:
		if stage == "pickup":
			drop = _spot(pick.p, 700, 3200)
			if drop.is_empty(): drop = {"p": pick.p + Vector2(800, 0), "name": "le quartier"}
			stage = "carry"; hp0 = main.car.get("hp") if main.car.get("hp") != null else 100.0; _target(drop.p)
			say("Client :", DLG.pickup[randi() % DLG.pickup.size()].replace("{d}", drop.name))
		else:
			var km: float = pick.p.distance_to(drop.p) / 1000.0; var base := roundi((500 + km * 400) / 25.0) * 25; var tip := roundi(base * 0.3 / 25.0) * 25
			money += base + tip; done += 1
			say("Client :", "%s   +%s (pourboire %s)" % [DLG.arrive[randi() % DLG.arrive.size()], fmt(base + tip), fmt(tip)])
			stage = "none"; marker.visible = false; route_mi.mesh = null; path = PackedVector2Array()
			if done >= GOAL: say("", "Bravo Modou ! Pape est fier de toi : le clando est à toi. (Prochain chapitre : le car rapide)")
			await get_tree().create_timer(4.0).timeout
			_new_mission()
	elif stage == "carry" and talk_t < -12 and randf() < dt * 0.05: say("Client :", DLG.ride[randi() % DLG.ride.size()])
