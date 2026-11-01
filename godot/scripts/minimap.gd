# Mini-carte en bas a gauche, dans le style du site : fond bleu nuit, mer bleue, rues avec contour (grands axes plus
# larges), itineraire GPS violet, cible jaune, police clignotante, fleche du joueur, N qui montre le nord.
extends Control

const SIZE := 240.0
const RANGE := 280.0 # metres du centre au bord
var main: Node3D
var data: Dictionary

func setup(m: Node3D, d: Dictionary) -> void:
	main = m; data = d
	anchor_top = 1.0; anchor_bottom = 1.0; offset_left = 16; offset_top = -SIZE - 16; offset_right = 16 + SIZE; offset_bottom = -16
	custom_minimum_size = Vector2(SIZE, SIZE); clip_contents = true # rien ne deborde du cadre

func _process(_dt: float) -> void: queue_redraw()

func _draw() -> void:
	var pl: Node3D = main.car if main.driving else main.avatar
	var c := Vector2(pl.global_position.x, pl.global_position.z)
	var f := pl.global_basis.z; var ang := atan2(f.x, f.z) # le haut de la carte = devant le joueur
	var k := SIZE / 2.0 / RANGE; var mid := Vector2(SIZE, SIZE) / 2.0
	var to := func(p: Vector2) -> Vector2: return mid + (p - c).rotated(ang + PI) * k * Vector2(-1, 1)
	var box := Rect2(Vector2.ZERO, Vector2(SIZE, SIZE))
	draw_rect(box, Color("1b2330"))
	if data.coast.size() > 1: # mer : bande large du cote de l'eau, puis le trait de cote
		var line := PackedVector2Array()
		for p in data.coast:
			var q := Vector2(p[0], p[1])
			if q.distance_to(c) < RANGE * 2.2: line.append(to.call(q))
			elif line.size() > 1: _coast(line); line = PackedVector2Array()
			else: line = PackedVector2Array()
		if line.size() > 1: _coast(line)
	var lines := [[], [], []] # petites rues, rues, grands axes : dessinees dans cet ordre
	for r in data.roads:
		if Vector2(r.pts[0][0], r.pts[0][1]).distance_to(c) > RANGE * 3: continue
		var pts := PackedVector2Array()
		for p in r.pts: pts.append(to.call(Vector2(p[0], p[1])))
		lines[0 if r.t > 4 else (1 if r.t > 1 else 2)].append(pts)
	var style := [[2.2, 1.2, Color("3a4558"), Color("6f7b8f")], [4.0, 2.4, Color("2d3646"), Color("c9ced8")], [6.0, 3.8, Color("6b4f12"), Color("f2c14e")]]
	for lvl in 3:
		for pts in lines[lvl]: draw_polyline(pts, style[lvl][2], style[lvl][0], true) # contour
		for pts in lines[lvl]: draw_polyline(pts, style[lvl][3], style[lvl][1], true) # remplissage
	var ms = main.missions
	if ms and ms.path.size() > 1: # itineraire GPS
		var rp := PackedVector2Array()
		for p in ms.path: rp.append(to.call(p))
		draw_polyline(rp, Color(0.25, 0.05, 0.35), 6.0, true); draw_polyline(rp, Color("c86bff"), 3.5, true)
	if ms and ms.stage != "none": # cible : rond jaune, colle au bord si elle est loin
		var tq: Vector2 = to.call(ms.pick.p if ms.stage == "pickup" else ms.drop.p)
		tq = tq.clamp(Vector2(10, 10), Vector2(SIZE - 10, SIZE - 10)); draw_circle(tq, 7, Color.BLACK); draw_circle(tq, 5.5, Color("ffd23f"))
	for fu in data.fuel:
		var q: Vector2 = to.call(Vector2(fu.x, fu.z))
		if box.has_point(q): draw_circle(q, 4, Color("2ecc71"))
	for cop in main.trafic.cops:
		var q: Vector2 = to.call(Vector2(cop.pos.x, cop.pos.z))
		draw_circle(q.clamp(Vector2(6, 6), Vector2(SIZE - 6, SIZE - 6)), 5, Color(1, 0.2, 0.2) if Engine.get_frames_drawn() % 20 < 10 else Color(0.2, 0.4, 1))
	var arrow := PackedVector2Array([mid + Vector2(0, -11), mid + Vector2(7, 8), mid + Vector2(0, 4), mid + Vector2(-7, 8)])
	draw_colored_polygon(arrow, Color.WHITE); draw_polyline(arrow + PackedVector2Array([arrow[0]]), Color.BLACK, 1.5, true)
	var n_pos: Vector2 = mid + (Vector2(0, -1)).rotated(ang + PI) * Vector2(-1, 1) * (SIZE / 2.0 - 14)
	draw_circle(n_pos, 10, Color(0, 0, 0, 0.6)); draw_string(ThemeDB.fallback_font, n_pos + Vector2(-5, 6), "N", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Color.WHITE)
	draw_rect(box, Color(1, 1, 1, 0.55), false, 2.0)

func _coast(line: PackedVector2Array) -> void:
	draw_polyline(line, Color("1f5f8f"), 26.0, true); draw_polyline(line, Color("3f8fcf"), 3.0, true)
