#!/usr/bin/env python3
"""Kalibrier-Testset: künstliche Handyfotos aus echten Kartenbildern (TCGdex).

    pip install opencv-python-headless numpy
    python3 scripts/calib/make-scenes.py [--n 120] [--seed 1]

Die Kartenbilder und Szenen landen nur im Cache (.cache/calib/, nicht im Repository).
Szenenarten:
  single  – eine Karte, schräg fotografiert, mit Spiegelung, Unschärfe, Farbstich, Hülle oder Finger
  binder  – Binderseite mit 3×3 Taschen
  scatter – 2–4 Karten in beliebiger Lage auf dem Tisch
Schwierigkeit 1–3 steuert Stärke der Störungen.
Ausgabe: .cache/calib/scenes/<name>.jpg und .cache/calib/truth.json
"""

import argparse
import json
import os
import random
import ssl
import time
import urllib.request

import cv2
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
DATA = os.path.join(ROOT, 'public', 'data')
CACHE = os.path.join(ROOT, '.cache', 'calib')
ASSETS = 'https://assets.tcgdex.net'


def ctx():
    ca = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


def pick_cards(n, rnd):
    """Zufällige Karten mit Bild: überwiegend international (englisches Bild), einige japanische."""
    sets = {(s['g'], s['id']): s for s in json.load(open(os.path.join(DATA, 'sets.json')))['sets']}
    vision = json.load(open(os.path.join(DATA, 'vision', 'keys.json')))
    indexed = set()
    for g, sid, ids in vision['sets']:
        for lid in ids:
            indexed.add((g, sid, lid))
    pool = []
    for lang, g in (('en', 'intl'), ('ja', 'ja')):
        for sid, rows in json.load(open(os.path.join(DATA, f'cards-{lang}.json')))['sets'].items():
            s = sets.get((g, sid))
            if not s or not s.get('s'):
                continue
            for r in rows:
                if len(r) >= 3 or (g, sid, r[0]) not in indexed:
                    continue
                pool.append({'group': g, 'setId': sid, 'localId': r[0], 'name': r[1],
                             'url': f"{ASSETS}/{lang}/{s['s']}/{sid}/{r[0]}/high.webp"})
    intl = [p for p in pool if p['group'] == 'intl']
    ja = [p for p in pool if p['group'] == 'ja']
    return rnd.sample(intl, int(n * 0.85)) + rnd.sample(ja, n - int(n * 0.85))


def fetch(card, c):
    os.makedirs(os.path.join(CACHE, 'cards'), exist_ok=True)
    path = os.path.join(CACHE, 'cards', f"{card['group']}~{card['setId']}~{card['localId']}.webp")
    if not (os.path.exists(path) and os.path.getsize(path) > 0):
        for i in range(4):
            try:
                with urllib.request.urlopen(card['url'], timeout=30, context=c) as r:
                    open(path, 'wb').write(r.read())
                break
            except Exception:
                time.sleep(1 + i)
    im = cv2.imread(path, cv2.IMREAD_COLOR)
    if im is None:
        return None
    return cv2.resize(im, (630, 880), interpolation=cv2.INTER_AREA)


def background(w, h, rnd):
    base = np.array([rnd.randint(30, 200) for _ in range(3)], np.float32)
    img = np.ones((h, w, 3), np.float32) * base
    # Holz-/Stoffmaserung und Flecken
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = rnd.uniform(0.005, 0.03)
    img += (np.sin(xx * f + np.sin(yy * f * 0.3) * 3) * rnd.uniform(5, 25))[..., None]
    for _ in range(rnd.randint(2, 6)):
        cx, cy, r = rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(60, 400)
        img += (np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r)) * rnd.uniform(-50, 50))[..., None]
    # Krimskrams: Rechtecke/Kreise, die keine Karten sind
    for _ in range(rnd.randint(0, 4)):
        col = [rnd.randint(0, 255) for _ in range(3)]
        if rnd.random() < 0.5:
            cv2.circle(img, (rnd.randint(0, w), rnd.randint(0, h)), rnd.randint(20, 90), col, -1)
        else:
            x, y = rnd.randint(0, w), rnd.randint(0, h)
            cv2.rectangle(img, (x, y), (x + rnd.randint(30, 300), y + rnd.randint(10, 60)), col, -1)
    img += np.random.default_rng(rnd.randint(0, 10**6)).normal(0, 4, img.shape).astype(np.float32)
    return np.clip(img, 0, 255)


def paste(dst, card, quad, alpha=1.0):
    h, w = card.shape[:2]
    M = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), np.float32(quad))
    warped = cv2.warpPerspective(card.astype(np.float32), M, (dst.shape[1], dst.shape[0]))
    mask = cv2.warpPerspective(np.ones((h, w), np.float32), M, (dst.shape[1], dst.shape[0]))
    mask = cv2.GaussianBlur(mask, (3, 3), 0)[..., None] * alpha
    return dst * (1 - mask) + warped * mask


def rect_quad(cx, cy, w, h, ang, persp=0.0, rnd=None):
    a = np.deg2rad(ang)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    pts = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    if persp and rnd:
        # Trapez: oben schmaler/breiter (schräg gehalten)
        k = rnd.uniform(-persp, persp)
        pts[0, 0] *= 1 - k
        pts[1, 0] *= 1 - k
        pts[2, 0] *= 1 + k
        pts[3, 0] *= 1 + k
        pts[:, 1] += rnd.uniform(-persp, persp) * h * 0.2 * np.array([1, -1, 1, -1])
    return (pts @ R.T) + np.array([cx, cy])


def disturb(img, level, rnd, card_quads):
    h, w = img.shape[:2]
    # Spiegelung (heller Fleck) auf einer Karte
    if rnd.random() < 0.35 * level:
        q = card_quads[rnd.randrange(len(card_quads))]
        cx, cy = q.mean(axis=0)
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = rnd.uniform(20, 70) * level
        img += (np.exp(-((xx - cx - rnd.uniform(-60, 60)) ** 2 + (yy - cy - rnd.uniform(-80, 80)) ** 2) / (2 * r * r)) * rnd.uniform(60, 160))[..., None]
    # Hülle: bläulich-transparente Fläche etwas größer als die Karte
    if rnd.random() < 0.2 * level and len(card_quads) == 1:
        q = card_quads[0]
        c = q.mean(axis=0)
        big = (q - c) * 1.06 + c
        overlay = img.copy()
        cv2.fillPoly(overlay, [big.astype(np.int32)], (235, 230, 225))
        img = img * 0.88 + overlay * 0.12
        cv2.polylines(img, [big.astype(np.int32)], True, (220, 220, 220), 2)
    # Finger am Rand
    if rnd.random() < 0.15 * level:
        q = card_quads[rnd.randrange(len(card_quads))]
        e = rnd.randrange(4)
        p = q[e] * 0.6 + q[(e + 1) % 4] * 0.4
        cv2.ellipse(img, (int(p[0]), int(p[1])), (int(22 + 8 * level), int(45 + 10 * level)), rnd.uniform(0, 180), 0, 360, (120, 150, 200), -1)
    # Farbstich, Helligkeit
    img = img * np.array([rnd.uniform(1 - 0.08 * level, 1 + 0.08 * level) for _ in range(3)], np.float32) + rnd.uniform(-15, 15) * level
    # Unschärfe
    if rnd.random() < 0.4 * level:
        k = 1 + 2 * rnd.randint(1, level + 1)
        img = cv2.GaussianBlur(img, (k, k), 0)
    img += np.random.default_rng(rnd.randint(0, 10**6)).normal(0, 2 + 2 * level, img.shape).astype(np.float32)
    return np.clip(img, 0, 255)


def scene_single(card, rnd, level):
    W, H = 1080, 1440
    img = background(W, H, rnd)
    ch = rnd.uniform(0.6, 0.85) * H
    cw = ch * 63 / 88
    q = rect_quad(W / 2 + rnd.uniform(-60, 60), H / 2 + rnd.uniform(-60, 60), cw, ch, rnd.uniform(-6, 6) * level, 0.06 * level, rnd)
    img = paste(img, card, q)
    return disturb(img, level, rnd, [q]), [q]


def scene_binder(cards, rnd, level):
    W, H = 1200, 1600
    img = background(W, H, rnd) * 0.4
    cw = W * 0.27
    ch = cw * 88 / 63
    gap = cw * rnd.uniform(0.04, 0.09)
    ang = rnd.uniform(-3, 3) * level
    a = np.deg2rad(ang)
    quads = []
    for i, card in enumerate(cards):
        r, c = divmod(i, 3)
        ox, oy = (c - 1) * (cw + gap), (r - 1) * (ch + gap)
        cx = W / 2 + ox * np.cos(a) - oy * np.sin(a)
        cy = H / 2 + ox * np.sin(a) + oy * np.cos(a)
        q = rect_quad(cx, cy, cw, ch, ang)
        img = paste(img, card, q)
        quads.append(q)
    # Taschenfolie: leichter Schimmer über allem
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img += (np.sin((xx + yy) * 0.004) * 12 * level)[..., None]
    return disturb(img, level, rnd, quads), quads


def scene_scatter(cards, rnd, level):
    W, H = 1440, 1080
    img = background(W, H, rnd)
    quads, centers = [], []
    for card in cards:
        # Karten liegen ausgebreitet: ganz im Bild, ohne Überlappung (wie man sie zum Scannen hinlegt)
        for _ in range(200):
            ch = rnd.uniform(0.36, 0.46) * H
            cw = ch * 63 / 88
            cx, cy = rnd.uniform(ch * 0.62, W - ch * 0.62), rnd.uniform(ch * 0.62, H - ch * 0.62)
            if all(np.hypot(cx - x, cy - y) > 1.12 * ch for x, y in centers):
                break
        centers.append((cx, cy))
        q = rect_quad(cx, cy, cw, ch, rnd.uniform(-180, 180) if level >= 2 else rnd.uniform(-25, 25))
        img = paste(img, card, q)
        quads.append(q)
    return disturb(img, level, rnd, quads), quads


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--n', type=int, default=120, help='Anzahl Karten')
    ap.add_argument('--seed', type=int, default=1)
    args = ap.parse_args()
    rnd = random.Random(args.seed)
    np.random.seed(args.seed)
    c = ctx()
    cards = pick_cards(args.n, rnd)
    imgs = []
    for card in cards:
        im = fetch(card, c)
        if im is not None:
            imgs.append((card, im))
    print(f'{len(imgs)} Kartenbilder')
    out = os.path.join(CACHE, 'scenes')
    os.makedirs(out, exist_ok=True)
    truth = []
    k = 0
    pool = imgs[:]
    rnd.shuffle(pool)
    # Einzelkarten: je Karte eine Szene, Schwierigkeit reihum
    for i, (card, im) in enumerate(pool[: int(len(pool) * 0.6)]):
        level = 1 + i % 3
        img, quads = scene_single(im, rnd, level)
        name = f'single-{k:03d}-L{level}'
        cv2.imwrite(os.path.join(out, name + '.jpg'), img.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
        truth.append({'file': name + '.jpg', 'kind': 'single', 'level': level, 'cards': [{**{k2: card[k2] for k2 in ('group', 'setId', 'localId', 'name')}, 'quad': quads[0].tolist()}]})
        k += 1
    rest = pool[int(len(pool) * 0.6):]
    # Binderseiten (je 9 Karten)
    for b in range(3):
        sel = rnd.sample(pool, 9)
        level = 1 + b
        img, quads = scene_binder([im for _, im in sel], rnd, level)
        name = f'binder-{b:02d}-L{level}'
        cv2.imwrite(os.path.join(out, name + '.jpg'), img.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
        truth.append({'file': name + '.jpg', 'kind': 'binder', 'level': level, 'cards': [{**{k2: c2[k2] for k2 in ('group', 'setId', 'localId', 'name')}, 'quad': q.tolist()} for (c2, _), q in zip(sel, quads)]})
    # Verstreute Karten
    for s in range(6):
        sel = rnd.sample(rest or pool, rnd.randint(2, 4))
        level = 1 + s % 3
        img, quads = scene_scatter([im for _, im in sel], rnd, level)
        name = f'scatter-{s:02d}-L{level}'
        cv2.imwrite(os.path.join(out, name + '.jpg'), img.astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
        truth.append({'file': name + '.jpg', 'kind': 'scatter', 'level': level, 'cards': [{**{k2: c2[k2] for k2 in ('group', 'setId', 'localId', 'name')}, 'quad': q.tolist()} for (c2, _), q in zip(sel, quads)]})
    json.dump(truth, open(os.path.join(CACHE, 'truth.json'), 'w'), ensure_ascii=False, indent=1)
    print(f'{len(truth)} Szenen in {out}')


if __name__ == '__main__':
    main()
