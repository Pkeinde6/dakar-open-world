# Fabrique godot/textures/boutiques.png : 8 devantures de boutiques de Dakar cote a cote (comme shopTex dans game.js) :
# enseigne coloree avec le nom, puis vitrine ouverte (etageres de marchandises) ou rideau metallique ferme.
# usage : Godot --path godot --script res://tools/boutiques.gd
extends SceneTree

const SHOPS := [["ALIMENTATION", "1f6fb5"], ["BOUTIQUE", "c0392b"], ["Orange Money", "ff7900"], ["WAVE", "1dc8f2"], ["QUINCAILLERIE", "2c3e50"], ["TAILLEUR", "8e44ad"], ["PHARMACIE", "27ae60"], ["DIBITERIE", "a0522d"], ["TÉLÉCENTRE", "16a085"], ["COIFFURE", "d35400"], ["MULTISERVICES", "2980b9"], ["DÉPÔT GAZ", "7f8c8d"]]

func _init() -> void:
	var vp := SubViewport.new(); vp.size = Vector2i(1024, 128); vp.transparent_bg = false; vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	root.add_child(vp)
	var rng := RandomNumberGenerator.new(); rng.seed = 12
	var goods := [Color("e74c3c"), Color("f1c40f"), Color("3498db"), Color("ecf0f1"), Color("27ae60"), Color("e67e22")]
	for i in 8:
		var x := i * 128; var shop: Array = SHOPS[(i * 5 + 3) % SHOPS.size()]
		_rect(vp, Rect2(x, 0, 128, 128), [Color("e9dcc3"), Color("f1e6cf"), Color("d9c7a6"), Color("efe2c9")][i % 4]) # mur
		_rect(vp, Rect2(x + 4, 6, 120, 30), Color(shop[1])) # enseigne
		var lb := Label.new(); lb.text = shop[0]; lb.position = Vector2(x + 4, 6); lb.size = Vector2(120, 30); lb.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER; lb.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
		lb.add_theme_font_size_override("font_size", 14 if shop[0].length() > 10 else 17); lb.add_theme_color_override("font_color", Color.WHITE); vp.add_child(lb)
		if shop[0] == "PHARMACIE": _rect(vp, Rect2(x + 8, 10, 6, 22), Color("2ecc71")); _rect(vp, Rect2(x + 2, 18, 18, 6), Color("2ecc71")) # croix verte
		if i % 3 != 2: # boutique ouverte : interieur sombre et etageres
			_rect(vp, Rect2(x + 14, 44, 100, 84), Color("2a2420"))
			for r in 4:
				for k in 9: _rect(vp, Rect2(x + 18 + k * 11, 52 + r * 18, 8, 10), goods[rng.randi() % goods.size()])
		else: # rideau metallique baisse
			_rect(vp, Rect2(x + 14, 44, 100, 84), [Color("8a9399"), Color("5d7a8c"), Color("6e8f6a")][i % 3])
			for y in range(46, 128, 5): _rect(vp, Rect2(x + 14, y, 100, 1.5), Color(0, 0, 0, 0.18))
		_rect(vp, Rect2(x, 120, 128, 8), Color(0, 0, 0, 0.25)) # soubassement
	await process_frame; await process_frame; await RenderingServer.frame_post_draw
	var err := vp.get_texture().get_image().save_png("res://textures/boutiques.png")
	print("boutiques.png ", err)
	quit()

func _rect(vp: Node, r: Rect2, c: Color) -> void:
	var cr := ColorRect.new(); cr.position = r.position; cr.size = r.size; cr.color = c; vp.add_child(cr)
