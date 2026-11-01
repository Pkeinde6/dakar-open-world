// Facades de Dakar : enduit (texture scannee) teinte par batiment, fenetres a grille et volets tous les 3,5 m x 3,1 m
shader_type spatial;
render_mode cull_disabled; // les contours OSM tournent dans les deux sens : murs et toit visibles quoi qu'il arrive
uniform sampler2D plaster : source_color, filter_linear_mipmap, repeat_enable;
varying vec3 wpos;
varying vec3 wnorm;
varying vec3 tint;
varying vec3 shutter;
void vertex() { tint = pow(COLOR.rgb, vec3(2.2)); // couleur de sommet en sRGB -> lineaire, sinon tout parait delave
	 shutter = mix(vec3(0.18, 0.42, 0.28), vec3(0.17, 0.32, 0.55), step(0.5, fract(COLOR.a * 7.0))); wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; wnorm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz); }
void fragment() {
	float along = abs(wnorm.x) > abs(wnorm.z) ? wpos.z : wpos.x;
	vec3 tx = texture(plaster, vec2(along, wpos.y) / 2.0).rgb;
	vec3 base = tint * mix(1.0, dot(tx, vec3(0.33)) * 2.2, 0.35); // enduit : la texture ne donne que le grain, la couleur vient de la teinte
	vec3 col = base; float rough = 0.9; float metal = 0.0;
	if (abs(wnorm.y) < 0.5 && wpos.y > 0.4) {
		vec2 cell = vec2(fract(along / 3.5), fract(wpos.y / 3.1));
		float floor_i = floor(wpos.y / 3.1);
		bool win = cell.x > 0.3 && cell.x < 0.7 && cell.y > 0.3 && cell.y < 0.78;
		if (floor_i < 0.5) win = cell.x > 0.15 && cell.x < 0.85 && cell.y > 0.12 && cell.y < 0.85; // rez-de-chaussee : boutique a rideau
		if (win) {
			if (floor_i < 0.5) { col = vec3(0.32, 0.33, 0.34) * (0.8 + 0.2 * step(0.5, fract(wpos.y * 12.0))); metal = 0.5; rough = 0.5; }
			else {
				col = vec3(0.05, 0.07, 0.09); rough = 0.15; metal = 0.3;
				if (fract(along * 7.0) < 0.12 || fract(wpos.y * 7.0) < 0.1) { col = vec3(0.08); rough = 0.6; } // grille en fer forge
				if (cell.x < 0.36 || cell.x > 0.64) col = shutter; // volets ouverts
			}
		}
		if (cell.y > 0.27 && cell.y < 0.3 && cell.x > 0.25 && cell.x < 0.75) col = base * 1.15; // appui
		float bay = floor(along / 3.5); bool balcon = floor_i > 0.5 && mod(bay + floor_i, 3.0) < 0.5; // un balcon sur trois, en quinconce
		if (balcon && cell.y < 0.3 && cell.y > 0.06 && cell.x > 0.2 && cell.x < 0.8) { col = vec3(0.07); rough = 0.5; if (fract(along * 9.0) > 0.25 && cell.y > 0.1) col = base * 0.6; } // garde-corps en fer
		if (cell.y < 0.05 && floor_i > 0.5) col = base * 1.25; // corniche claire a chaque etage
		if (wpos.y < 0.6) col = base * 0.55; // soubassement plus fonce (poussiere, eclaboussures)
		col = mix(col, col * vec3(0.85, 0.78, 0.68), smoothstep(1.5, 0.0, wpos.y) * 0.5); // salissure de sable en bas
	}
	ALBEDO = col; ROUGHNESS = rough; METALLIC = metal;
}
