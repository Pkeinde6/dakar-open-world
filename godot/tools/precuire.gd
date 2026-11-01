# Pre-construction de la ville : chaque tuile est construite une fois et enregistree en scene Godot (godot/cuit/<x_z>.scn).
# Le jeu les charge ensuite en arriere-plan, sans rien calculer : plus de saccades en roulant.
# Les maillages communs (maisons, arbres, voitures) sont enregistres une seule fois dans godot/cuit/communs/.
# Reprend la ou il s'est arrete. Commence pres du Plateau et s'eloigne.
# usage (avec affichage, le rendu doit tourner pour enregistrer les maillages) :
#   Godot --path godot --script res://tools/precuire.gd -- [max_tuiles]
extends SceneTree

func _init() -> void:
	DirAccess.make_dir_recursive_absolute("res://cuit/communs")
	var main = load("res://scripts/main.gd").new()
	main.monde = JSON.parse_string(FileAccess.get_file_as_string("res://data/monde.json"))
	for k in main.monde.tiles: main.known[k] = true
	var limit := 100000
	for a in OS.get_cmdline_user_args():
		if a.is_valid_int(): limit = int(a)
	var sp := Vector2(main.monde.spawn[0], main.monde.spawn[1]); var t0: float = main.monde.tile
	var keys: Array = main.monde.tiles.duplicate()
	keys.sort_custom(func(p, q): return _dist(p, sp, t0) < _dist(q, sp, t0)) # les plus proches du Plateau d'abord
	var done := 0; var start := Time.get_ticks_msec()
	for k in keys:
		if done >= limit: break
		var out := "res://cuit/%s.scn" % k
		if FileAccess.file_exists(out): continue
		var q: Node3D = main._make(k)
		_externalise()
		_own(q, q)
		var ps := PackedScene.new(); var err := ps.pack(q)
		if err == OK: err = ResourceSaver.save(ps, out, ResourceSaver.FLAG_COMPRESS)
		q.free(); done += 1
		if done % 10 == 0 or err != OK: print("tuile %s (%d faites, %.1f s par tuile) %s" % [k, done, (Time.get_ticks_msec() - start) / 1000.0 / done, "" if err == OK else "ERREUR %d" % err])
	print("termine : %d tuiles cuites" % done)
	quit()

func _dist(k: String, sp: Vector2, t: float) -> float:
	var xy := k.split("_"); return Vector2((int(xy[0]) + 0.5) * t, (int(xy[1]) + 0.5) * t).distance_to(sp)

# chaque noeud doit appartenir a la racine pour etre enregistre
func _own(n: Node, root: Node) -> void:
	for c in n.get_children():
		c.owner = root; _own(c, root)

# maillages et materiaux partages : un fichier chacun, les tuiles y font reference au lieu de les recopier
func _externalise() -> void:
	var V = load("res://scripts/ville.gd"); var Q = load("res://scripts/quartier.gd")
	for mk in V.shared_meshes: _save_once(V.shared_meshes[mk], "res://cuit/communs/%s.res" % mk)
	for p in Q.tree_meshes: _save_once(Q.tree_meshes[p], "res://cuit/communs/%s.res" % p.get_file().get_basename())

func _save_once(r: Resource, path: String) -> void:
	if r.resource_path == path: return
	if not FileAccess.file_exists(path): ResourceSaver.save(r, path, ResourceSaver.FLAG_COMPRESS)
	r.take_over_path(path)
