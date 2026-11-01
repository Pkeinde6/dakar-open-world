# Voiture a vraie physique : caisse du modele Sketchfab, 4 roues separees (tools/voiture_godot_blender.py)
# montees sur VehicleWheel3D (suspension, braquage a l'avant, propulsion a l'arriere).
extends VehicleBody3D

var driven := false
var wheels: Array[VehicleWheel3D] = []

func setup(path: String, paint: Color) -> void:
	mass = 1150; center_of_mass_mode = CENTER_OF_MASS_MODE_CUSTOM; center_of_mass = Vector3(0, -0.15, 0) # bas : la voiture ne bascule plus dans les virages
	var scn: Node3D = load(path).instantiate()
	var body: MeshInstance3D = scn.find_child("Caisse", true, false)
	var aabb := body.get_aabb()
	for i in body.get_surface_override_material_count():
		var m := body.mesh.surface_get_material(i)
		if m is StandardMaterial3D and m.albedo_texture == null and m.albedo_color.v > 0.5: # peinture : la plus claire des teintes unies
			m = m.duplicate(); m.albedo_color = paint; m.metallic = 0.5; m.roughness = 0.3; m.clearcoat_enabled = true; body.set_surface_override_material(i, m)
	body.owner = null; body.get_parent().remove_child(body); add_child(body)
	var cs := CollisionShape3D.new(); var box := BoxShape3D.new()
	box.size = Vector3(aabb.size.x * 0.95, aabb.size.y * 0.6, aabb.size.z * 0.95); cs.shape = box; cs.position = aabb.get_center() + Vector3(0, aabb.size.y * 0.12, 0); add_child(cs)
	for name in ["Roue_AVG", "Roue_AVD", "Roue_ARG", "Roue_ARD"]:
		var wm: MeshInstance3D = scn.find_child(name, true, false); if wm == null: continue
		var c := wm.global_transform.origin if wm.is_inside_tree() else wm.transform.origin
		var radius := wm.get_aabb().size.y / 2.0
		var w := VehicleWheel3D.new(); w.name = name
		w.wheel_radius = radius; w.wheel_rest_length = 0.12; w.suspension_travel = 0.18; w.suspension_stiffness = 60; w.damping_compression = 0.9; w.damping_relaxation = 1.4
		w.wheel_friction_slip = 2.6; w.wheel_roll_influence = 0.03
		w.use_as_steering = name.begins_with("Roue_AV"); w.use_as_traction = name.begins_with("Roue_AR")
		w.position = c + Vector3(0, w.wheel_rest_length, 0); add_child(w)
		wm.owner = null; wm.get_parent().remove_child(wm); w.add_child(wm); wm.position = Vector3(0, -w.wheel_rest_length, 0) * 0; wm.transform.origin = Vector3.ZERO
		wheels.append(w)
	scn.queue_free()

var upside := 0.0
func _physics_process(dt: float) -> void:
	# renversee (ou touche R) : on la remet sur ses roues, dans le sens ou elle allait
	upside = upside + dt if global_basis.y.y < 0.4 else 0.0
	if upside > 2.0 or (driven and Input.is_key_pressed(KEY_R)):
		var f := global_basis.z; f.y = 0; f = f.normalized() if f.length() > 0.1 else Vector3.FORWARD
		global_transform = Transform3D(Basis.looking_at(-f, Vector3.UP), global_position + Vector3.UP * 1.2); linear_velocity = Vector3.ZERO; angular_velocity = Vector3.ZERO; upside = 0.0
	var thr := 0.0; var st := 0.0; var br := 0.0
	if driven:
		if Input.is_key_pressed(KEY_W) or Input.is_key_pressed(KEY_Z) or Input.is_key_pressed(KEY_UP): thr = 1.0
		if Input.is_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN): thr = -0.6
		if Input.is_key_pressed(KEY_A) or Input.is_key_pressed(KEY_Q) or Input.is_key_pressed(KEY_LEFT): st = 1.0
		if Input.is_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT): st = -1.0
		if Input.is_key_pressed(KEY_SPACE): br = 40.0
	else: br = 8.0
	var speed := linear_velocity.length()
	engine_force = thr * (2600.0 if speed < 28 else 600.0)
	steering = move_toward(steering, st * lerpf(0.55, 0.18, clamp(speed / 30.0, 0, 1)), dt * 2.5)
	brake = br
