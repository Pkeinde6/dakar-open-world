# Grande carte de tout Dakar (touche M), comme celle du site : mer bleue, presqu'ile pleine, rues (grands axes en jaune),
# noms des quartiers, itineraire GPS violet, joueur.
# Molette : zoom · glisser : deplacer · clic : poser un repere GPS · double-clic : s'y teleporter · M ou Echap : fermer.
extends Control

var main: Node3D
var roads := [] # [type, PackedVector2Array]
var sea := PackedVector2Array() # triangles de la mer (cote + fermeture vers l'ouest), calcules une fois
var coast := PackedVector2Array()
var quartiers := []
var centre := Vector2.ZERO
var zoom := 0.04 # pixels par metre
var dragging := false
var moved := 0.0

func setup(m: Node3D, monde: Dictionary) -> void:
	main = m; visible = false; set_anchors_preset(Control.PRESET_FULL_RECT); mouse_filter = Control.MOUSE_FILTER_STOP
	for r in monde.get("carte", []):
		var pts := PackedVector2Array()
		for i in range(1, r.size(), 2): pts.append(Vector2(r[i], r[i + 1]))
		roads.append([r[0], pts])
	for p in monde.coast: coast.append(Vector2(p[0], p[1]))
	var poly := coast.duplicate()
	for p in monde.coastClose: poly.append(Vector2(p[0], p[1]))
	var tri := Geometry2D.triangulate_polygon(poly)
	for i in tri: sea.append(poly[i])
	quartiers = JSON.parse_string(FileAccess.get_file_as_string("res://data/quartiers.json"))

func toggle() -> void:
	visible = not visible
	if visible:
		var pl: Node3D = main.car if main.driving else main.avatar
		centre = Vector2(pl.global_position.x, pl.global_position.z)

func _world(screen: Vector2) -> Vector2: return centre + (screen - size / 2.0) / zoom

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP and e.pressed: zoom = minf(zoom * 1.2, 1.5)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN and e.pressed: zoom = maxf(zoom / 1.2, 0.006)
		elif e.button_index == MOUSE_BUTTON_LEFT:
			if e.double_click: main.teleport(_world(e.position)); visible = false # double-clic : on y va
			elif e.pressed: dragging = true; moved = 0.0
			else:
				dragging = false
				if moved < 4.0: main.missions.set_waypoint(_world(e.position)) # simple clic : repere GPS
		queue_redraw()
	elif e is InputEventMouseMotion and dragging:
		centre -= e.relative / zoom; moved += e.relative.length(); queue_redraw()

func _process(_dt: float) -> void:
	if visible: queue_redraw()

func _draw() -> void:
	var sz := size
	draw_rect(Rect2(Vector2.ZERO, sz), Color("1c2633")) # la terre
	draw_set_transform(sz / 2.0 - centre * zoom, 0.0, Vector2(zoom, zoom)) # on dessine en metres
	if sea.size() >= 3:
		for i in range(0, sea.size(), 3): draw_colored_polygon(PackedVector2Array([sea[i], sea[i + 1], sea[i + 2]]), Color("2b5f8e"))
	draw_polyline(coast, Color("4f8fc4"), 2.0 / zoom, true)
	var view := Rect2(centre - sz / 2.0 / zoom, sz / zoom).grow(300)
	for r in roads:
		var t: int = r[0]; var pts: PackedVector2Array = r[1]
		if zoom < 0.025 and t > 3: continue # de loin : seulement les grands axes
		if not view.has_point(pts[0]) and not view.has_point(pts[pts.size() - 1]): continue
		var w: float = (4.0 if t <= 1 else (2.6 if t <= 3 else 1.3)) / zoom * clampf(zoom / 0.04, 0.7, 2.0)
		draw_polyline(pts, Color("f2c14e") if t <= 1 else (Color("c9ced8") if t <= 3 else Color("6f7b8f")), w, true)
	var ms = main.missions
	if ms and ms.path.size() > 1: draw_polyline(ms.path, Color("c86bff"), 5.0 / zoom, true)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var to := func(p: Vector2) -> Vector2: return sz / 2.0 + (p - centre) * zoom
	var font := ThemeDB.fallback_font
	if zoom > 0.012: # noms des quartiers
		for q in quartiers:
			var sp: Vector2 = to.call(Vector2(q[1], q[2]))
			if Rect2(Vector2.ZERO, sz).has_point(sp): draw_string_outline(font, sp + Vector2(-30, 0), q[0], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, 4, Color(0, 0, 0, 0.6)); draw_string(font, sp + Vector2(-30, 0), q[0], HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(1, 1, 1, 0.85))
	if ms and ms.stage != "none": var tp: Vector2 = to.call(ms.pick.p if ms.stage == "pickup" else ms.drop.p); draw_circle(tp, 9, Color.BLACK); draw_circle(tp, 7, Color("ffd23f"))
	if ms and ms.waypoint != Vector2.INF: var wp: Vector2 = to.call(ms.waypoint); draw_circle(wp, 9, Color.BLACK); draw_circle(wp, 7, Color("c86bff"))
	var pl: Node3D = main.car if main.driving else main.avatar
	var p0: Vector2 = to.call(Vector2(pl.global_position.x, pl.global_position.z)); var f := pl.global_basis.z; var a := atan2(f.x, f.z)
	var tri := PackedVector2Array([Vector2(0, 14), Vector2(-9, -9), Vector2(0, -4), Vector2(9, -9)])
	for i in tri.size(): tri[i] = p0 + tri[i].rotated(-a)
	draw_colored_polygon(tri, Color.WHITE); draw_polyline(tri + PackedVector2Array([tri[0]]), Color.BLACK, 2.0, true)
	var box := Rect2(24, 24, 560, 150); draw_style_box(preload("res://scripts/ui.gd").box(0.85), box)
	var lines := ["CARTE — Dakar", "Molette : zoom · Glisser : déplacer", "Clic : poser un repère GPS · Double-clic : s'y téléporter", "M ou Échap : fermer"]
	for i in lines.size(): draw_string(font, box.position + Vector2(18, 34 + i * 30), lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, 20 if i == 0 else 17, Color("f2c14e") if i == 0 else Color(1, 1, 1, 0.9))
