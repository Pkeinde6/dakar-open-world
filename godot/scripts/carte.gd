# Grande carte de tout Dakar (touche M) : rues principales, mer, position et direction du joueur, police.
# Molette pour zoomer, glisser avec la souris pour se deplacer, M ou Echap pour fermer.
extends Control

var main: Node3D
var roads := [] # [type, PackedVector2Array]
var coast := PackedVector2Array()
var centre := Vector2.ZERO
var zoom := 0.04 # pixels par metre
var dragging := false

func setup(m: Node3D, monde: Dictionary) -> void:
	main = m; visible = false; set_anchors_preset(Control.PRESET_FULL_RECT); mouse_filter = Control.MOUSE_FILTER_STOP
	for r in monde.get("carte", []):
		var pts := PackedVector2Array()
		for i in range(1, r.size(), 2): pts.append(Vector2(r[i], r[i + 1]))
		roads.append([r[0], pts])
	for p in monde.coast: coast.append(Vector2(p[0], p[1]))

func toggle() -> void:
	visible = not visible
	if visible:
		var pl: Node3D = main.car if main.driving else main.avatar
		centre = Vector2(pl.global_position.x, pl.global_position.z)

func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_WHEEL_UP: zoom = minf(zoom * 1.25, 1.5)
		elif e.button_index == MOUSE_BUTTON_WHEEL_DOWN: zoom = maxf(zoom * 0.8, 0.008)
		elif e.button_index == MOUSE_BUTTON_LEFT: dragging = e.pressed
		queue_redraw()
	elif e is InputEventMouseMotion and dragging:
		centre -= e.relative / zoom; queue_redraw()

func _process(_dt: float) -> void:
	if visible: queue_redraw()

func _draw() -> void:
	var sz := size; var mid := sz / 2.0
	var to := func(p: Vector2) -> Vector2: return mid + (p - centre) * zoom
	draw_rect(Rect2(Vector2.ZERO, sz), Color(0.82, 0.76, 0.64)) # le sable de la presqu'ile
	var view := Rect2(centre - mid / zoom, sz / zoom).grow(200)
	if coast.size() > 1: # la mer : bande bleue du cote ouest de la cote
		var line := PackedVector2Array()
		for p in coast: line.append(to.call(p))
		draw_polyline(line, Color(0.2, 0.45, 0.7), maxf(3.0, 60.0 * zoom))
	for r in roads:
		var t: int = r[0]; var pts: PackedVector2Array = r[1]
		if zoom < 0.03 and t > 3: continue # vue de loin : seulement les grands axes
		if not view.has_point(pts[0]) and not view.has_point(pts[pts.size() - 1]): continue
		var screen := PackedVector2Array()
		for p in pts: screen.append(to.call(p))
		var col := Color(0.95, 0.7, 0.2) if t <= 1 else (Color(1, 1, 1) if t <= 3 else Color(0.92, 0.9, 0.86))
		draw_polyline(screen, col, (5.0 if t <= 1 else (3.0 if t <= 3 else 1.5)) * clampf(zoom / 0.04, 0.6, 2.5))
	for cop in main.trafic.cops: draw_circle(to.call(Vector2(cop.pos.x, cop.pos.z)), 6, Color(1, 0.2, 0.2))
	var pl: Node3D = main.car if main.driving else main.avatar
	var p0: Vector2 = to.call(Vector2(pl.global_position.x, pl.global_position.z)); var f := pl.global_basis.z; var a := atan2(f.x, f.z)
	var tri := PackedVector2Array([Vector2(0, 12), Vector2(-8, -8), Vector2(8, -8)])
	for i in tri.size(): tri[i] = p0 + tri[i].rotated(-a)
	draw_colored_polygon(tri, Color(0.85, 0.1, 0.1))
	draw_string(ThemeDB.fallback_font, Vector2(20, 40), "DAKAR — molette : zoom · glisser : déplacer · M : fermer", HORIZONTAL_ALIGNMENT_LEFT, -1, 22, Color(0.1, 0.1, 0.1))
