# Avatar a pied, comme dans GTA : ZQSD / fleches pour marcher, Maj pour courir, F pres de la voiture pour monter.
extends CharacterBody3D

var anim: AnimationPlayer
var heading := 0.0

func setup(path: String) -> void:
	var model: Node3D = load(path).instantiate(); add_child(model)
	anim = model.find_child("AnimationPlayer", true, false)
	for n in ["Walk", "Idle"]:
		if anim and anim.has_animation(n): anim.get_animation(n).loop_mode = Animation.LOOP_LINEAR
	var cs := CollisionShape3D.new(); var cap := CapsuleShape3D.new(); cap.radius = 0.3; cap.height = 1.75; cs.shape = cap; cs.position.y = 0.88; add_child(cs)
	if anim: anim.play("Idle")

func _physics_process(dt: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var inp := Vector2.ZERO
	if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_Z) or Input.is_key_pressed(KEY_UP): inp.y += 1
	if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN): inp.y -= 1
	if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_Q) or Input.is_key_pressed(KEY_LEFT): inp.x -= 1
	if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT): inp.x += 1
	var dir := Vector3.ZERO
	if cam and inp != Vector2.ZERO:
		var f := -cam.global_basis.z; f.y = 0; f = f.normalized(); var r := cam.global_basis.x; r.y = 0; r = r.normalized()
		dir = (f * inp.y + r * inp.x).normalized()
	var run := Input.is_key_pressed(KEY_SHIFT); var spd := 4.5 if run else 1.5
	velocity.x = dir.x * spd; velocity.z = dir.z * spd
	velocity.y = 0.0 if is_on_floor() else velocity.y - 20.0 * dt
	if dir != Vector3.ZERO: heading = lerp_angle(heading, atan2(dir.x, dir.z), dt * 10.0)
	rotation.y = heading # models face +z
	move_and_slide()
	if anim:
		var want := "Walk" if dir != Vector3.ZERO else "Idle"
		if anim.current_animation != want: anim.play(want, 0.2)
		anim.speed_scale = 2.4 if run and want == "Walk" else 1.0
