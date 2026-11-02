# Logo Teranga (methode logo-brand-design / Carazan) : une route qui file vers l'horizon forme la lettre T ;
# au bout, l'etoile du Senegal est la destination. Grille 96, module 8, aplats, decoupes en evenodd.
# usage : python marque/fabriquer.py -> marque/*.svg + marque/presentation.html
import math, os
D = os.path.dirname(os.path.abspath(__file__))
GREEN, SUN, DARK, LIGHT, RED = '#00573A', '#FFD23F', '#0E1B15', '#F4F7F2', '#E31B23'

def star(cx, cy, r, k=0.382):
    pts = []
    for i in range(10):
        a = math.radians(-90 + i * 36); rr = r if i % 2 == 0 else r * k
        pts.append(f'{cx + rr * math.cos(a):.2f} {cy + rr * math.sin(a):.2f}')
    return 'M' + ' L'.join(pts) + ' Z'

# pistes : A (retenue) route-T + etoile ; B T vu du ciel (carrefour) + etoile ; C volant dont le moyeu est l'etoile
def mark_a():
    t = (f'<path d="{star(48, 18, 12)}"/>'
         '<path fill-rule="evenodd" d="M16 40 H80 A4 4 0 0 1 80 48 H53.5 L70 88 H26 L42.5 48 H16 A4 4 0 0 1 16 40 Z '
         'M47.1 55 h1.8 l0.4 7 h-2.6 Z M46.4 66 h3.2 l0.6 8 h-4.4 Z M45.6 78 h4.8 l0.7 7 h-6.2 Z"/>')
    return t
def mark_b():
    return (f'<path d="{star(48, 20, 11)}"/>'
            '<path fill-rule="evenodd" d="M12 40 H84 V56 H56 V88 H40 V56 H12 Z M18 47 h8 v2 h-8 Z M34 47 h8 v2 h-8 Z M54 47 h8 v2 h-8 Z M70 47 h8 v2 h-8 Z M47 62 h2 v8 h-2 Z M47 76 h2 v8 h-2 Z"/>')
def mark_c():
    return ('<path fill-rule="evenodd" d="M48 10 A38 38 0 1 1 47.99 10 Z M48 20 A28 28 0 1 0 48.01 20 Z"/>'
            f'<path d="{star(48, 50, 15)}"/>'
            '<rect x="20" y="46" width="14" height="6" rx="3"/><rect x="62" y="46" width="14" height="6" rx="3"/><rect x="45" y="64" width="6" height="16" rx="3"/>')

def svg(body, fill='currentColor', bg=None, rx=0, vb='0 0 96 96'):
    b = f'<rect width="96" height="96" rx="{rx}" fill="{bg}"/>' if bg else ''
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{b}<g fill="{fill}">{body}</g></svg>'

def icon(body):  # icone d'appli : fond vert plein (iOS et Android arrondissent eux-memes), symbole a 78 %
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
            f'<defs><radialGradient id="g" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#0A7A4E"/><stop offset="1" stop-color="{GREEN}"/></radialGradient></defs>'
            f'<rect width="96" height="96" fill="url(#g)"/><g transform="translate(10.56 10.56) scale(0.78)" fill="{SUN}">{body}</g></svg>')

files = {
    'teranga.svg': svg(mark_a()),
    'teranga-vert.svg': svg(mark_a(), GREEN),
    'teranga-noir.svg': svg(mark_a(), DARK),
    'teranga-blanc.svg': svg(mark_a(), '#FFFFFF'),
    'teranga-icone.svg': icon(mark_a()),
    'piste-b.svg': svg(mark_b(), GREEN), 'piste-c.svg': svg(mark_c(), GREEN),
}
for n, s in files.items(): open(os.path.join(D, n), 'w', encoding='utf-8').write(s)

# planche de presentation (rendue en PNG pour les icones et l'apercu)
A = mark_a()
html = f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Teranga — marque</title>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root{{--g:{GREEN};--s:{SUN};--d:{DARK};--l:{LIGHT}}}
body{{margin:0;background:#dfe5df;font-family:Sora,system-ui,sans-serif;color:var(--d)}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:16px;max-width:1500px;margin:auto}}
.c{{border-radius:18px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}}
.c svg{{width:46%}} .w{{grid-column:span 2;aspect-ratio:2/1}}
.lock{{display:flex;align-items:center;gap:.55em;font-weight:600;letter-spacing:-.03em;font-size:96px}} .lock svg{{width:1.35em;height:1.35em}}
.stack{{display:flex;flex-direction:column;align-items:center;gap:.25em;font-weight:600;letter-spacing:-.03em;font-size:64px}} .stack svg{{width:2.2em}}
.lbl{{position:absolute;left:18px;bottom:14px;font-size:13px;opacity:.7}}
.fav{{display:flex;gap:28px;align-items:end}} .fav svg{{width:auto}}
.cons line,.cons circle,.cons rect{{fill:none;stroke:#9aa8a0;stroke-width:.25}}
.phone{{width:46%;aspect-ratio:9/19;border-radius:28px;background:#1b2a24;padding:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-content:start}}
.app{{aspect-ratio:1;border-radius:22.5%;background:#2c3d36}} .app.t{{background:none;overflow:hidden}} .app.t svg{{width:100%;height:100%}}
</style></head><body><div class="grid">
<div class="c" id="hero" style="background:var(--g)"><svg viewBox="0 0 96 96" fill="{SUN}">{A}</svg><span class="lbl" style="color:#fff">Symbole</span></div>
<div class="c w" style="background:var(--l)"><div class="lock"><svg viewBox="0 0 96 96" fill="{GREEN}">{A}</svg>teranga</div><span class="lbl">Version horizontale</span></div>
<div class="c w" style="background:var(--d);color:#fff"><div class="lock"><svg viewBox="0 0 96 96" fill="{SUN}">{A}</svg>teranga</div><span class="lbl">Sur fond sombre</span></div>
<div class="c" style="background:var(--s)"><div class="stack" style="color:var(--g)"><svg viewBox="0 0 96 96" fill="{GREEN}">{A}</svg>teranga</div><span class="lbl">Version empilee</span></div>
<div class="c" style="background:#fff"><svg viewBox="0 0 96 96" class="cons" style="width:62%"><g fill="{GREEN}" opacity=".9">{A}</g>
  {''.join(f'<line x1="{i*8}" y1="0" x2="{i*8}" y2="96"/><line x1="0" y1="{i*8}" x2="96" y2="{i*8}"/>' for i in range(13))}
  <rect x="9.6" y="9.6" width="76.8" height="76.8"/><circle cx="48" cy="18" r="12"/><circle cx="48" cy="48" r="40"/></svg><span class="lbl">Construction : grille 96, module 8</span></div>
<div class="c" style="background:var(--l)"><div class="fav">
  <svg viewBox="0 0 96 96" style="height:96px">{icon(A)[icon(A).index('>')+1:-6]}</svg>
  <svg viewBox="0 0 96 96" style="height:48px">{icon(A)[icon(A).index('>')+1:-6]}</svg>
  <svg viewBox="0 0 96 96" style="height:32px">{icon(A)[icon(A).index('>')+1:-6]}</svg>
  <svg viewBox="0 0 96 96" style="height:16px">{icon(A)[icon(A).index('>')+1:-6]}</svg></div><span class="lbl">Tests 96, 48, 32 et 16 px</span></div>
<div class="c" style="background:#fff"><svg viewBox="0 0 96 96" fill="{DARK}">{A}</svg><span class="lbl">Une couleur</span></div>
<div class="c" style="background:#c9d3cc"><div class="phone">{''.join('<div class="app"></div>' for _ in range(5))}<div class="app t">{icon(A)}</div>{''.join('<div class="app"></div>' for _ in range(10))}</div><span class="lbl">Sur l'ecran d'accueil</span></div>
<div class="c" style="background:#fff"><svg viewBox="0 0 96 96" fill="{GREEN}" style="width:30%">{mark_b()}</svg><span class="lbl">Piste B : carrefour en T vu du ciel</span></div>
<div class="c" style="background:#fff"><svg viewBox="0 0 96 96" fill="{GREEN}" style="width:30%">{mark_c()}</svg><span class="lbl">Piste C : volant, moyeu etoile</span></div>
<div class="c" style="background:var(--g)"><svg viewBox="0 0 96 96" fill="{SUN}" style="width:30%">{A}</svg><span class="lbl" style="color:#fff">Piste A, retenue : route en T vers l'etoile</span></div>
</div>
<div id="icone" style="width:1024px;height:1024px;position:absolute;left:-2000px">{icon(A)}</div>
</body></html>'''
open(os.path.join(D, 'presentation.html'), 'w', encoding='utf-8').write(html)
print('ok', len(files), 'svg')
