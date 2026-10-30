# Mosquees de Dakar et de Touba, exportees en GLB pour le jeu (meme outillage que maisons_blender.py).
# usage: blender --background --python tools/mosquees_blender.py -- <dossier models/>
# Front (entrance, qibla wall behind) faces -Y in Blender = +Z in glTF.
import os, sys, math
from mathutils import Matrix
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, 'maisons_blender.py'), encoding='utf-8').read()
exec(src.rsplit('\nmaison_r1(); villa(); immeuble_medina()', 1)[0])  # mat, srgb, House, export, reset...

def cone(H, m, cx, cy, z0, r0, r1, h, n=12):
    bm = H.parts.setdefault(m.name, (m, bmesh.new()))[1]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=n, radius1=r0, radius2=r1, depth=h, matrix=Matrix.Translation((cx, cy, z0 + h / 2)))

def dome(H, m, cx, cy, z0, r, squash=1.0, seg=16):
    bm = H.parts.setdefault(m.name, (m, bmesh.new()))[1]
    ret = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r, matrix=Matrix.Translation((cx, cy, z0)) @ Matrix.Diagonal((1, 1, squash, 1)))
    bmesh.ops.delete(bm, geom=[v for v in ret['verts'] if v.co.z < z0 - 0.01], context='VERTS')  # half sphere

def arch(H, frame, dark, x, y, z, w, h, front=True):
    """arched opening on the wall plane y: green frame, dark opening, round top"""
    d = -1 if front else 1
    H.box(frame, x - w / 2 - 0.15, y + d * 0.05, z - 0.1, x + w / 2 + 0.15, y - d * 0.02, z + h)
    H.box(dark, x - w / 2, y + d * 0.08, z, x + w / 2, y + d * 0.03, z + h)
    for (mm, r, off) in ((frame, w / 2 + 0.15, 0.05), (dark, w / 2, 0.08)):
        bm = H.parts.setdefault(mm.name, (mm, bmesh.new()))[1]
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=r, radius2=r, depth=0.05,
                              matrix=Matrix.Translation((x, y + d * off, z + h)) @ Matrix.Rotation(math.pi / 2, 4, 'X'))

def crenels(H, m, W, D, z, h=0.6, step=1.0, t=0.25):
    """merlons along the roof edge (common on Dakar mosques)"""
    for k in range(int(W / step) + 1):
        x = -W / 2 + k * W / int(W / step)
        for y in (-D / 2, D / 2 - t): H.box(m, x - 0.22, y, z, x + 0.22, y + t, z + h)
    for k in range(int(D / step) + 1):
        y = -D / 2 + k * D / int(D / step)
        for x in (-W / 2, W / 2 - t): H.box(m, x, y - 0.22, z, x + t, y + 0.22, z + h)

def minaret_octo(H, white, green, cx, cy, h, r=1.0):
    """square base, octagonal shaft, balcony, upper shaft, green cone and finial"""
    H.box(white, cx - r * 1.2, cy - r * 1.2, 0, cx + r * 1.2, cy + r * 1.2, h * 0.3)
    cone(H, white, cx, cy, h * 0.3, r, r * 0.9, h * 0.48, 8)
    cone(H, green, cx, cy, h * 0.78, r * 1.6, r * 1.6, 0.35, 16)          # balcon
    cone(H, white, cx, cy, h * 0.78 + 0.35, r * 1.55, r * 1.55, 0.9, 16)   # garde-corps du balcon
    cone(H, white, cx, cy, h * 0.78, r * 0.75, r * 0.7, h * 0.16, 8)
    cone(H, green, cx, cy, h * 0.94, r * 0.85, 0.05, h * 0.09, 8)
    cone(H, mat('Gold', srgb(0xd4af37), 0.3, 0.9), cx, cy, h * 1.03, 0.05, 0.05, 1.2, 6)

def mosquee_quartier():
    reset(); MATS.clear()
    Wt = mat('Facade', srgb(0xf4f1ea)); Gr = mat('Green', srgb(0x2f8f5a), 0.5, 0.1); Dk = mat('Dark', srgb(0x1f2a24), 0.6); C = mat('Concrete', srgb(0xbdb6a8))
    H = House('mosquee_quartier'); W, D, h = 12, 16, 6
    H.box(Wt, -W / 2, -D / 2, 0, W / 2, D / 2, h); H.box(C, -W / 2 + .1, -D / 2 + .1, h, W / 2 - .1, D / 2 - .1, h + .05)
    H.box(Gr, -W / 2 - .05, -D / 2 - .05, h - 0.5, W / 2 + .05, D / 2 + .05, h - 0.2)  # bandeau vert
    H.box(Gr, -W / 2 - .05, -D / 2 - .05, 0, W / 2 + .05, D / 2 + .05, 0.5)           # soubassement vert
    crenels(H, Wt, W, D, h)
    for x in (-3.5, 3.5): arch(H, Gr, Dk, x, -D / 2, 1.2, 1.4, 2.4)
    arch(H, Gr, Dk, 0, -D / 2, 0.5, 2.0, 2.9)                                        # porte
    for y in (-4.5, 0, 4.5):
        for side in (-1, 1):
            x = side * W / 2; H.box(Gr, x - 0.05 * side, y - 0.85, 1.1, x + 0.05 * side, y + 0.85, 3.9); H.box(Dk, x + 0.0 * side, y - 0.65, 1.2, x + 0.08 * side, y + 0.65, 3.6)
    cone(H, Wt, 0, 1, h, 2.6, 2.6, 1.2, 16); dome(H, Gr, 0, 1, h + 1.2, 2.6, 1.1)       # tambour + coupole
    cone(H, mat('Gold', srgb(0xd4af37), 0.3, 0.9), 0, 1, h + 4.0, 0.05, 0.05, 1.0, 6)
    minaret_octo(H, Wt, Gr, W / 2 - 1.3, -D / 2 + 1.3, 19, 1.0)
    return export(H.build(), 'mosquee_quartier')

def mosquee_grande():
    """style marocain (Grande Mosquee de Dakar) : minaret carre, toits de tuiles vertes, arcades"""
    reset(); MATS.clear()
    Wt = mat('Facade', srgb(0xf1ece0)); Gr = mat('Green', srgb(0x1f7a4c), 0.45, 0.1); Dk = mat('Dark', srgb(0x26302b), 0.6); C = mat('Concrete', srgb(0xc9c2b4)); Z = mat('Zellige', srgb(0x2d6e8e), 0.4)
    H = House('mosquee_grande'); W, D, h = 44, 48, 9
    H.box(Wt, -W / 2, -D / 2 + 14, 0, W / 2, D / 2, h)                  # salle de priere
    for (x0, x1) in ((-W / 2, -W / 2 + 6), (W / 2 - 6, W / 2)): H.box(Wt, x0, -D / 2, 0, x1, -D / 2 + 14, h - 2)  # galeries de la cour
    H.box(C, -W / 2 + 6, -D / 2, 0, W / 2 - 6, -D / 2 + 14, 0.2)         # cour
    for k in range(9): arch(H, Gr, Dk, -W / 2 + 4.9 + k * ((W - 9.8) / 8), -D / 2 + 14, 0.2, 2.2, 3.8)
    for side in (-1, 1):
        for k in range(4): arch(H, Gr, Dk, side * (W / 2 - 3), -D / 2, 0.2, 2.0, 3.6)
    # toits en tuiles vertes : longs pans inclines
    for k in range(5):
        y0 = -D / 2 + 14 + k * (D - 14) / 5; y1 = y0 + (D - 14) / 5
        bm = H.parts.setdefault('Green', (Gr, bmesh.new()))[1]
        v = [bm.verts.new(p) for p in ((-W / 2, y0, h), (W / 2, y0, h), (W / 2, (y0 + y1) / 2, h + 2.5), (-W / 2, (y0 + y1) / 2, h + 2.5), (-W / 2, y1, h), (W / 2, y1, h))]
        bm.faces.new([v[0], v[1], v[2], v[3]]); bm.faces.new([v[3], v[2], v[5], v[4]]); bm.faces.new([v[0], v[3], v[4]]); bm.faces.new([v[1], v[5], v[2]])
    # minaret carre (67 m a Dakar ; ici 48 m), bandeaux de zellige, lanterne et pyramide verte
    mx, my, s = W / 2 - 4, -D / 2 + 4, 3.2
    H.box(Wt, mx - s, my - s, 0, mx + s, my + s, 44)
    for z in (14, 28, 40): H.box(Z, mx - s - .05, my - s - .05, z, mx + s + .05, my + s + .05, z + 1.2)
    for z in (8, 20, 33): arch(H, Gr, Dk, mx, my - s, z, 1.0, 2.0)
    H.box(Gr, mx - s - .2, my - s - .2, 44, mx + s + .2, my + s + .2, 44.6)
    H.box(Wt, mx - 1.5, my - 1.5, 44.6, mx + 1.5, my + 1.5, 49)
    cone(H, Gr, mx, my, 49, 2.3, 0.1, 3.5, 4)
    cone(H, mat('Gold', srgb(0xd4af37), 0.3, 0.9), mx, my, 52.5, 0.08, 0.08, 2.0, 6)
    return export(H.build(), 'mosquee_grande')

def mosquee_divinite():
    """Mosquee de la Divinite (Ouakam) : blanche, grande coupole, deux minarets"""
    reset(); MATS.clear()
    Wt = mat('Facade', srgb(0xf7f5ef)); Gr = mat('Green', srgb(0x2f8f5a), 0.45, 0.1); Dk = mat('Dark', srgb(0x23302b), 0.6); C = mat('Concrete', srgb(0xcfc8ba))
    H = House('mosquee_divinite'); W, D, h = 30, 36, 10
    H.box(Wt, -W / 2, -D / 2, 0, W / 2, D / 2, h); H.box(C, -W / 2 + .1, -D / 2 + .1, h, W / 2 - .1, D / 2 - .1, h + .05)
    crenels(H, Wt, W, D, h, 0.8, 1.4, 0.3)
    for k in range(5): arch(H, Gr, Dk, -10 + k * 5, -D / 2, 1.0, 2.4, 4.5)
    cone(H, Wt, 0, 2, h, 8, 8, 3, 24); dome(H, Wt, 0, 2, h + 3, 8, 1.05, 24)
    cone(H, Gr, 0, 2, h + 11.2, 0.6, 0.05, 2.2, 8)
    for x in (-W / 2 + 2.5, W / 2 - 2.5): minaret_octo(H, Wt, Gr, x, -D / 2 + 2.5, 45, 1.4)
    return export(H.build(), 'mosquee_divinite')

def mosquee_touba():
    """Grande Mosquee de Touba : marbre rose, coupoles vertes, cinq minarets dont Lamp Fall (87 m)"""
    reset(); MATS.clear()
    Pk = mat('Facade', srgb(0xe8cfc0)); Gr = mat('Green', srgb(0x2b7a52), 0.45, 0.1); Dk = mat('Dark', srgb(0x3a2f2b), 0.6); C = mat('Concrete', srgb(0xd8c8bb)); Wt = mat('White', srgb(0xf4efe8))
    H = House('mosquee_touba'); W, D, h = 96, 84, 14
    H.box(Pk, -W / 2, -D / 2, 0, W / 2, D / 2, h); H.box(C, -W / 2 + .2, -D / 2 + .2, h, W / 2 - .2, D / 2 - .2, h + .1)
    H.box(Wt, -W / 2 - .1, -D / 2 - .1, h - 1.2, W / 2 + .1, D / 2 + .1, h - 0.6)
    crenels(H, Pk, W, D, h, 0.9, 2.4, 0.4)
    for k in range(15): arch(H, Wt, Dk, -W / 2 + 6 + k * (W - 12) / 14, -D / 2, 1.0, 3.2, 6.5)
    for (x, y, r) in ((0, 6, 11), (-24, 12, 7), (24, 12, 7), (-24, -14, 6), (24, -14, 6), (0, -22, 6)):
        cone(H, Pk, x, y, h, r, r, r * 0.5, 24); dome(H, Gr, x, y, h + r * 0.5, r, 1.15, 24)
        cone(H, mat('Gold', srgb(0xd4af37), 0.3, 0.9), x, y, h + r * 1.65, 0.12, 0.12, 2.5, 6)
    minaret_octo(H, Pk, Gr, 0, -D / 2 - 6, 87, 3.4)                          # Lamp Fall
    H.box(Pk, -4.5, -D / 2 - 10.5, 0, 4.5, -D / 2, 14)
    for (x, y) in ((-W / 2 + 4, -D / 2 + 4), (W / 2 - 4, -D / 2 + 4), (-W / 2 + 4, D / 2 - 4), (W / 2 - 4, D / 2 - 4)): minaret_octo(H, Pk, Gr, x, y, 52, 2.2)
    return export(H.build(), 'mosquee_touba')

mosquee_quartier(); mosquee_grande(); mosquee_divinite(); mosquee_touba()
