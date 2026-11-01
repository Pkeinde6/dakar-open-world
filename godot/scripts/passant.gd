# Passant qui marche sur le trottoir le long d'une rue reelle, fait demi-tour au bout.
extends Node3D

var pts: Array[Vector2] = []
var cum: Array[float] = []
var s := 0.0
var dir := 1
var off := 0.0
var speed := 1.2

func setup(path: String, road: Dictionary, f: float, d: int) -> void:
	var model: Node3D = load(path).instantiate(); add_child(model)
	var anim: AnimationPlayer = model.find_child("AnimationPlayer", true, false)
	if anim and anim.has_animation("Walk"):
		anim.get_animation("Walk").loop_mode = Animation.LOOP_LINEAR; anim.play("Walk"); anim.seek(randf())
	for p in road.pts: pts.append(Vector2(p[0], p[1]))
	cum.append(0.0)
	for i in range(1, pts.size()): cum.append(cum[i - 1] + pts[i].distance_to(pts[i - 1]))
	s = f * cum[-1]; dir = d; off = (road.w / 2.0 + road.side * 0.55) * (1 if randf() < 0.5 else -1); speed = randf_range(1.0, 1.4)

func _process(dt: float) -> void:
	s += dir * speed * dt
	if s < 0 or s > cum[-1]: dir = -dir; s = clamp(s, 0, cum[-1])
	var i := 0
	while i < cum.size() - 2 and cum[i + 1] < s: i += 1
	var a := pts[i]; var b := pts[i + 1]; var t := (s - cum[i]) / maxf(0.01, cum[i + 1] - cum[i])
	var p := a.lerp(b, t); var d := (b - a).normalized(); var n := Vector2(-d.y, d.x)
	position = Vector3(p.x + n.x * off, 0.03, p.y + n.y * off)
	rotation.y = atan2(d.x, d.y) if dir > 0 else atan2(-d.x, -d.y)
