// Sol naturel : sable, plaques d'herbe seche, terre plus sombre, melanges en douceur par un bruit a plusieurs echelles
shader_type spatial;
uniform sampler2D sand_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D noise_tex : filter_linear_mipmap, repeat_enable;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	vec3 sand = texture(sand_tex, wpos.xz / 5.0).rgb * vec3(1.05, 0.98, 0.88);
	float n1 = texture(noise_tex, wpos.xz / 160.0).r, n2 = texture(noise_tex, wpos.xz / 37.0).r, n3 = texture(noise_tex, wpos.xz / 9.0).r;
	float grass = smoothstep(0.52, 0.7, n1 * 0.65 + n2 * 0.35);          // herbe seche par plaques
	float soil = smoothstep(0.55, 0.75, n2 * 0.6 + n3 * 0.4) * (1.0 - grass); // terre battue
	vec3 g = mix(vec3(0.3, 0.38, 0.14), vec3(0.45, 0.46, 0.2), n3) * (0.8 + 0.4 * texture(sand_tex, wpos.xz / 2.0).r);
	vec3 col = mix(sand, g, grass * 0.85);
	col = mix(col, sand * vec3(0.72, 0.62, 0.5), soil * 0.6);
	ALBEDO = col; ROUGHNESS = 0.95;
}
