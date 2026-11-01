# Style commun de l'interface : panneaux sombres arrondis, accent jaune, textes avec ombre douce.
extends RefCounted

const ACCENT := Color("f2c14e")
const TEXT := Color("f4f1ea")

static func box(alpha := 0.78, radius := 14, pad := 14, border := false) -> StyleBoxFlat:
	var s := StyleBoxFlat.new(); s.bg_color = Color(0.07, 0.09, 0.12, alpha)
	s.set_corner_radius_all(radius); s.content_margin_left = pad; s.content_margin_right = pad; s.content_margin_top = pad * 0.6; s.content_margin_bottom = pad * 0.6
	s.shadow_color = Color(0, 0, 0, 0.35); s.shadow_size = 8
	if border: s.border_color = Color(ACCENT, 0.9); s.border_width_left = 4
	return s

static func panel(alpha := 0.78, radius := 14, pad := 14, border := false) -> PanelContainer:
	var p := PanelContainer.new(); p.add_theme_stylebox_override("panel", box(alpha, radius, pad, border)); return p

static func label(text := "", size := 20, color := TEXT, bold := false) -> Label:
	var l := Label.new(); l.text = text; l.add_theme_font_size_override("font_size", size); l.add_theme_color_override("font_color", color)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6)); l.add_theme_constant_override("shadow_offset_x", 1); l.add_theme_constant_override("shadow_offset_y", 2)
	if bold: l.add_theme_constant_override("outline_size", 1); l.add_theme_color_override("font_outline_color", color)
	return l
