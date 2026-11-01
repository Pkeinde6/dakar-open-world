# Avatar a pied, comme dans GTA : ZQSD / fleches pour marcher, Maj pour courir, F pres de la voiture pour monter.
# Modele Mixamo (realiste) : la marche vient avec le personnage, les autres animations (attendre, courir,
# monter en voiture) sont des fichiers "sans peau" sur le meme squelette, ajoutees au lecteur d'animations.
extends CharacterBody3D

const SKIN := Color(0.36, 0.22, 0.15) # peau noire : multiplie la texture claire du modele
var anim: AnimationPlayer
var heading := 0.0
var busy := 0.0 # pendant l animation "monter en voiture", plus de controle
var speed := 0.0

func setup(path: String, extra := {}) -> void:
	var model: Node3D = load(path).instantiate(); add_child(model)
	anim = model.find_child("AnimationPlayer", true, false)
	if anim:
		var lib := AnimationLibrary.new()
		if anim.has_animation("mixamo_com"): lib.add_animation("Walk", anim.get_animation("mixamo_com"))
		for n in extra:
			var src: AnimationPlayer = load(extra[n]).instantiate().find_child("AnimationPlayer", true, false)
			if src and src.has_animation("mixamo_com"): lib.add_animation(n, src.get_animation("mixamo_com"))
		if not lib.get_animation_list().is_empty(): anim.add_animation_library("dakar", lib)
		for n in ["Walk", "Idle", "Run", "dakar/Walk", "dakar/Idle", "dakar/Run"]:
			if anim.has_animation(n): anim.get_animation(n).loop_mode = Animation.LOOP_LINEAR
	for m in model.find_children("*", "MeshInstance3D", true, false):
		for i in m.mesh.get_surface_count():
			var mat: Material = m.get_active_material(i)
			if not (mat is StandardMaterial3D): continue
			mat = mat.duplicate() as StandardMaterial3D
			if m.name.ends_with("Body"): mat.albedo_color = SKIN
			elif m.name.ends_with("Hair") or m.name.ends_with("Eyelashes"): mat.albedo_color = Color(0.08, 0.06, 0.05)
			m.set_surface_override_material(i, mat)
	floor_snap_length = 0.4 # redescend du trottoir sans sauter
	var cs := CollisionShape3D.new(); var cap := CapsuleShape3D.new(); cap.radius = 0.3; cap.height = 1.75; cs.shape = cap; cs.position.y = 0.88; add_child(cs)
	_play("Idle")

func _name(n: String) -> String:
	if anim == null: return ""
	if anim.has_animation("dakar/" + n): return "dakar/" + n
	return n if anim.has_animation(n) else ""

func _play(n: String, blend := 0.25) -> void:
	var a := _name(n)
	if a != "" and anim.current_animation != a: anim.play(a, blend)

# joue l'animation de montee en voiture, rend sa duree (0 si absente)
func enter_car() -> float:
	var a := _name("Enter")
	if a == "": return 0.0
	anim.play(a, 0.2); busy = minf(anim.get_animation(a).length, 3.0); return busy

func _physics_process(dt: float) -> void:
	if busy > 0.0: busy -= dt; return
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
	var run := Input.is_key_pressed(KEY_SHIFT); var target := (5.5 if run else 1.6) if dir != Vector3.ZERO else 0.0
	speed = move_toward(speed, target, (9.0 if target > speed else 12.0) * dt) # on prend de l'elan, on s'arrete vite
	if dir != Vector3.ZERO: heading = lerp_angle(heading, atan2(dir.x, dir.z), dt * (7.0 if run else 10.0))
	var fwd := Vector3(sin(heading), 0, cos(heading)) # on avance la ou on regarde : virages en courbe, pas en angle droit
	velocity.x = fwd.x * speed; velocity.z = fwd.z * speed
	velocity.y = 0.0 if is_on_floor() else velocity.y - 20.0 * dt
	rotation.y = heading # models face +z
	var before := global_position
	move_and_slide()
	_step_up(before, dt)
	if speed < 0.2: _play("Idle"); anim.speed_scale = 1.0
	elif speed > 3.0 and _name("Run") != "": _play("Run", 0.2); anim.speed_scale = speed / 5.5
	else: _play("Walk", 0.2); anim.speed_scale = clampf(speed / 1.6, 0.6, 1.6)

# trottoirs, marches : bloque par une petite hauteur (< 35 cm), on monte dessus au lieu de s'arreter
func _step_up(before: Vector3, dt: float) -> void:
	if speed < 0.3 or not is_on_wall(): return
	var hv := Vector3(velocity.x, 0, velocity.z) * dt * 1.5
	for h in [0.12, 0.24, 0.36]:
		var t := global_transform.translated(Vector3.UP * h)
		if not test_move(t, hv): # la voie est libre un peu plus haut : on y passe, la gravite nous repose dessus
			global_position = before + Vector3.UP * h + hv; return
