# Генератор четырёх трасс этапа 6 (сплайн, высоты, особенности, пропсы): python3 scripts/dev/tracks-gen.py src/tracks
# Нужен из корня проекта (вызывает scripts/dev/crest.ts через npx tsx).
import json, math, sys
OUT = sys.argv[1]

def rounded(corners, r=10, close=True):
    """Ломаная (x,z,y) -> точки сплайна: у каждого угла точки за r м до и после (острый, но плавный поворот)."""
    pts = []
    n = len(corners)
    for i in range(n):
        p = corners[i]; a = corners[i-1]; b = corners[(i+1) % n]
        def toward(q, dist):
            dx, dz = q[0]-p[0], q[1]-p[1]; L = math.hypot(dx, dz)
            k = min(dist, L*0.45)/L
            return [p[0]+dx*k, p[1]+dz*k]
        ya, yb, yp = a[2], b[2], p[2]
        r_i = p[3] if len(p) > 3 else r
        if r_i <= 0:
            pts.append([p[0], yp, p[1]]); continue
        q1 = toward(a, r_i); q2 = toward(b, r_i)
        # Высота — по ломаной без «полок» в углах: перелом уклона подбрасывает машины.
        la = math.hypot(a[0]-p[0], a[1]-p[1]); lb = math.hypot(b[0]-p[0], b[1]-p[1])
        d1 = math.hypot(q1[0]-p[0], q1[1]-p[1]); d2 = math.hypot(q2[0]-p[0], q2[1]-p[1])
        y1 = yp + (ya-yp)*d1/la; y2 = yp + (yb-yp)*d2/lb
        pts.append([round(q1[0],2), round(y1,2), round(q1[1],2)])
        pts.append([round((q1[0]+q2[0]+p[0]*2)/4,2), round((y1+y2)/2,2), round((q1[1]+q2[1]+p[1]*2)/4,2)])
        pts.append([round(q2[0],2), round(y2,2), round(q2[1],2)])
    return pts

def densify(pts, step=60):
    """Длинные прямые — промежуточные точки (сплайн не «провисает»)."""
    out = []
    n = len(pts)
    for i in range(n):
        a = pts[i]; b = pts[(i+1) % n]
        out.append(a)
        L = math.hypot(b[0]-a[0], b[2]-a[2])
        k = int(L // step)
        for j in range(1, k):
            t = j / k
            out.append([round(a[0]+(b[0]-a[0])*t,2), round(a[1]+(b[1]-a[1])*t,2), round(a[2]+(b[2]-a[2])*t,2)])
    return out

tracks = {}

# ---------- Ночной город ----------
city = rounded([
    (0, 0, 0.0, 0), (0, -160, 0.4, 0), (0, -320, 0.8), (180, -320, 1.2), (180, -200, 1.0), (320, -200, 0.6),
    (320, -60, 0.4, 0), (320, 60, 0.2), (150, 60, 0.4), (150, 140, 0.6), (40, 140, 0.4), (0, 100, 0.2),
], r=28)
tracks['city'] = {
  "id": "city", "name": "Ночной город",
  "description": "Неон, мокрый асфальт, узкие повороты кварталов и телепорт через переулок",
  "points": densify(city), "width": 13, "surface": "asphalt",
  "shoulder": {"width": 1.5, "surface": "asphalt"},
  "walls": {"offset": 0.8, "height": 1.0},
  "checkpoints": 10, "startAt": 0.03,
  "lighting": "city-day", "lightingNight": "city-night", "weather": "rain",
  "groundColor": "#55575c", "ground": "concrete",
  "teleports": [{"from": 0.505, "to": 0.70, "d": 3.2, "halfWidth": 2.4}],
  "boosts": [{"from": 0.25, "to": 0.27, "d": 0, "halfWidth": 2.5}],
  "breakables": [
    {"type": "cone", "at": 0.205, "d": -5.5, "count": 6, "spacing": 2.5},
    {"type": "cone", "at": 0.355, "d": 5.5, "count": 6, "spacing": 2.5},
    {"type": "billboard", "at": 0.15, "d": -7.4, "count": 1, "rot": 0.3},
    {"type": "billboard", "at": 0.62, "d": 7.4, "count": 1, "rot": -0.3},
    {"type": "crate", "at": 0.83, "d": -5.8, "count": 4, "spacing": 2}
  ],
  "props": [
    {"type": "building", "span": {"from": 0, "to": 1}, "side": 0, "every": 22, "d": 3, "rows": 2, "jitter": 2},
    {"type": "neon", "span": {"from": 0, "to": 1}, "side": 0, "every": 33, "d": 1.4, "jitter": 3, "rot": 1.5708},
    {"type": "lamp", "span": {"from": 0, "to": 1}, "side": 0, "every": 32, "d": 0.4}
  ]
}

# ---------- Пустыня / каньон ----------
desert = [
  [0, 0.3, 0], [0, 0.6, -120], [0, 3.5, -230], [0, 8.5, -310], [0, 10.0, -350], [0, 10.0, -400], [0, 10.0, -460],
  [0, 6.5, -530], [0, 1.0, -610], [25, 0.5, -710], [120, 0.5, -800], [260, 0.8, -800], [400, 1.0, -720],
  [470, 1.4, -600], [500, 1.6, -460], [470, 1.2, -340], [520, 1.0, -230], [560, 0.8, -100],
  [520, 0.6, 20], [400, 0.4, 90], [240, 0.3, 100], [100, 0.3, 80], [20, 0.3, 50]
]
desert = [[round(x*0.8,1), y, round(z*0.8,1)] for x, y, z in desert]
tracks['desert'] = {
  "id": "desert", "name": "Каньон",
  "description": "Закат в пустыне: длинные прямые, песчаные обочины и трамплин через расщелину",
  "points": desert, "width": 16, "surface": "asphalt",
  "zones": [{"from": 0.58, "to": 0.63, "surface": "sand"}],
  "shoulder": {"width": 5, "surface": "sand"},
  "walls": {"offset": 2.5, "height": 0.9},
  "checkpoints": 10, "startAt": 0.02,
  "lighting": "desert-sunset", "lightingNight": "desert-night", "weather": "dust",
  "groundColor": "#c29a63", "ground": "sand", "groundOffset": -0.4, "skirt": "rock", "fallDepth": 3,
  "jumps": [{"at": 0, "height": 1.8, "length": 40, "gap": 14}],
  "boosts": [{"from": 0.86, "to": 0.89, "d": 0, "halfWidth": 3}, {"from": 0.115, "to": 0.135, "d": 0, "halfWidth": 5}],
  "breakables": [
    {"type": "barrel", "at": 0.33, "d": -10, "count": 6, "spacing": 2.5, "stagger": 0.8},
    {"type": "billboard", "at": 0.5, "d": 11.5, "count": 1, "rot": -0.2},
    {"type": "crate", "at": 0.72, "d": 9.5, "count": 5, "spacing": 2.2}
  ],
  "props": [
    {"type": "rock", "span": {"from": 0, "to": 1}, "side": 0, "every": 26, "d": 8, "rows": 3, "jitter": 6, "scale": 4},
    {"type": "rock", "span": {"from": 0.3, "to": 0.7}, "side": 0, "every": 60, "d": 35, "jitter": 10, "scale": 16},
    {"type": "cactus", "span": {"from": 0, "to": 1}, "side": 0, "every": 31, "d": 4, "rows": 2, "jitter": 5}
  ]
}

# ---------- Горный серпантин ----------
mtn = rounded([
  (0, 0, 0, 0), (0, -150, 4, 0), (-10, -260, 10, 26), (-120, -270, 16, 24), (-130, -170, 22, 24),
  (-240, -160, 28, 24), (-250, -290, 34, 26), (-160, -390, 40, 20), (60, -420, 46, 30), (230, -380, 44, 30),
  (300, -250, 36, 30), (260, -100, 24, 30), (170, 0, 12, 30), (80, 60, 4, 30), (20, 40, 1, 20),
], r=14)
mtn = [[round(x*0.9,1), y, round(z*0.9,1)] for x, y, z in mtn]
tracks['mountain'] = {
  "id": "mountain", "name": "Серпантин",
  "description": "Горное утро: туман в долине, серпантин над обрывами и снег на вершине",
  "points": mtn, "width": 11, "surface": "asphalt",
  "zones": [{"from": 0.42, "to": 0.56, "surface": "snow"}],
  "shoulder": {"width": 1.5, "surface": "dirt"},
  "walls": {"offset": 0.6, "height": 1.4, "gaps": [{"from": 0.24, "to": 0.29, "side": 1}, {"from": 0.62, "to": 0.68, "side": -1}]},
  "checkpoints": 12, "startAt": 0.02,
  "lighting": "mountain-morning", "lightingNight": "mountain-night", "weather": "none",
  "groundColor": "#6c7a5a", "ground": "grass", "groundOffset": -30, "skirt": "rock", "fallDepth": 6,
  "breakables": [
    {"type": "cone", "at": 0.13, "d": 4.5, "count": 5, "spacing": 2},
    {"type": "barrel", "at": 0.56, "d": -4.8, "count": 4, "spacing": 2.2},
    {"type": "billboard", "at": 0.8, "d": 7.8, "count": 1, "rot": 0.2}
  ],
  "props": [
    {"type": "pine", "span": {"from": 0.6, "to": 1}, "side": 0, "every": 14, "d": 3, "rows": 3, "jitter": 4, "scale": 1.3},
    {"type": "pine", "span": {"from": 0, "to": 0.4}, "side": 0, "every": 14, "d": 3, "rows": 3, "jitter": 4, "scale": 1.3},
    {"type": "snowpine", "span": {"from": 0.4, "to": 0.6}, "side": 0, "every": 16, "d": 3, "rows": 2, "jitter": 4, "scale": 1.2},
    {"type": "greyrock", "span": {"from": 0, "to": 1}, "side": 0, "every": 40, "d": 5, "jitter": 8, "scale": 6}
  ]
}

# ---------- Зимний лес ----------
forest = [
  [0, 0.5, 0], [0, 0.8, -140], [-30, 1.2, -260], [-120, 1.0, -330], [-240, 0.8, -320], [-320, 0.6, -240],
  [-330, 0.5, -120], [-300, 2.5, -20], [-260, 5.0, 60], [-200, 5.5, 120], [-130, 5.0, 170], [-60, 2.5, 200],
  [30, 0.8, 230], [140, 0.6, 210], [220, 0.8, 140], [240, 1.0, 40], [190, 0.8, -20], [120, 0.6, 10], [60, 0.5, 50], [15, 0.5, 55],
]
tracks['forest'] = {
  "id": "forest", "name": "Зимний лес",
  "description": "Снегопад и ели, ледяной мост над замёрзшей рекой, ночью — северное сияние",
  "points": forest, "width": 12, "surface": "asphalt",
  "zones": [{"from": 0.52, "to": 0.555, "surface": "ice"}, {"from": 0.22, "to": 0.28, "surface": "snow"}],
  "shoulder": {"width": 3, "surface": "snow"},
  "walls": {"offset": 1.2, "height": 1.0},
  "checkpoints": 10, "startAt": 0.02,
  "lighting": "forest-day", "lightingNight": "forest-night", "weather": "snow",
  "groundColor": "#e8eef5", "ground": "snow", "groundOffset": -0.3, "skirt": "snow",
  "bridges": [{"from": 0.47, "to": 0.61}],
  "areas": [{"type": "ground", "rect": [-300, 20, -60, 230], "y": -0.05, "style": "ice"}],
  "breakables": [
    {"type": "cone", "at": 0.45, "d": -4.8, "count": 5, "spacing": 2.5},
    {"type": "crate", "at": 0.75, "d": 6.5, "count": 4, "spacing": 2},
    {"type": "billboard", "at": 0.9, "d": -9, "count": 1, "rot": 0.2}
  ],
  "props": [
    {"type": "snowpine", "span": {"from": 0, "to": 0.46}, "side": 0, "every": 9, "d": 4, "rows": 4, "jitter": 3, "scale": 1.35},
    {"type": "snowpine", "span": {"from": 0.62, "to": 1}, "side": 0, "every": 9, "d": 4, "rows": 4, "jitter": 3, "scale": 1.35},
    {"type": "lamp", "span": {"from": 0.46, "to": 0.62}, "side": 0, "every": 24, "d": 0.4},
    {"type": "greyrock", "span": {"from": 0, "to": 1}, "side": 0, "every": 70, "d": 8, "jitter": 8, "scale": 3}
  ]
}

import subprocess
for k, v in tracks.items():
    if k == 'desert':
        v['jumps'][0]['at'] = 0
        json.dump(v, open(f"{OUT}/{k}.json", 'w'), ensure_ascii=False, indent=2)
        # Трамплин — в 18 м после начала ровной вершины (иначе приземление на крутой спуск).
        frac = subprocess.check_output(['npx', 'tsx', 'scripts/dev/crest.ts', f"{OUT}/{k}.json"], text=True).strip().splitlines()[-1]
        v['jumps'][0]['at'] = float(frac)
for k, v in tracks.items():
    json.dump(v, open(f"{OUT}/{k}.json", 'w'), ensure_ascii=False, indent=2)
print('ok', list(tracks))
