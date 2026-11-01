# Mini-carte en bas a gauche : vraies rues autour du joueur (tournee dans son sens de marche), mer, stations-service,
# police en rouge, fleche du joueur au centre.
extends Control

const SIZE := 230.0
const RANGE := 260.0 # metres du centre au bord
var main: Node3D
var data: Dictionary

func setup(m: Node3D, d: Dictionary) -> void:
	main = m; data = d
	anchor_top = 1.0; anchor_bottom = 1.0; offset_left = 16; offset_top = -SIZE - 16; offset_right = 16 + SIZE; offset_bottom = -16
	custom_minimum_size = Vector2(SIZE, SIZE)

func _process(_dt: float) -> void: queue_redraw()

func _draw() -> void:
	var pl: Node3D = main.car if main.driving else main.avatar
	var c := Vector2(pl.global_position.x, pl.global_position.z)
	var f := pl.global_basis.z; var ang := atan2(f.x, f.z) # le haut de la carte = devant le joueur
	var k := SIZE / 2.0 / RANGE; var mid := Vector2(SIZE, SIZE) / 2.0
	var to := func(p: Vector2) -> Vector2: return mid + (p - c).rotated(ang + PI) * k * Vector2(-1, 1)
	draw_rect(Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)), Color(0.13, 0.15, 0.18, 0.88))
	if data.coast.size() > 1: # cote
		var line := PackedVector2Array()
		for p in data.coast:
			var q := Vector2(p[0], p[1])
			if q.distance_to(c) < RANGE * 1.6: line.append(to.call(q))
			elif line.size() > 1: draw_polyline(line, Color(0.25, 0.55, 0.75), 3.0); line = PackedVector2Array()
			else: line = PackedVector2Array()
		if line.size() > 1: draw_polyline(line, Color(0.25, 0.55, 0.75), 3.0)
	for r in data.roads:
		var a0 := Vector2(r.pts[0][0], r.pts[0][1])
		if a0.distance_to(c) > RANGE * 3: continue
		var pts := PackedVector2Array()
		for p in r.pts: pts.append(to.call(Vector2(p[0], p[1])))
		var w: float = 4.0 if r.t <= 1 else (3.0 if r.t <= 3 else 1.6)
		var col := Color(0.95, 0.8, 0.35) if r.t <= 1 else (Color(0.85, 0.85, 0.85) if r.t <= 4 else Color(0.55, 0.57, 0.6))
		draw_polyline(pts, col, w)
	for fu in data.fuel:
		var q: Vector2 = to.call(Vector2(fu.x, fu.z))
		if Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)).has_point(q): draw_circle(q, 4, Color(0.2, 0.75, 0.3))
	for cop in main.trafic.cops:
		var q: Vector2 = to.call(Vector2(cop.pos.x, cop.pos.z))
		draw_circle(q.clamp(Vector2(6, 6), Vector2(SIZE - 6, SIZE - 6)), 5, Color(1, 0.2, 0.2) if Engine.get_frames_drawn() % 20 < 10 else Color(0.2, 0.4, 1))
	draw_colored_polygon(PackedVector2Array([mid + Vector2(0, -9), mid + Vector2(6, 7), mid + Vector2(-6, 7)]), Color(1, 1, 1)) # le joueur
	draw_rect(Rect2(Vector2.ZERO, Vector2(SIZE, SIZE)), Color(1, 1, 1, 0.5), false, 2.0)
