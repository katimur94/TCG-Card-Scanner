#!/usr/bin/env python3
"""Erzeugt den Bildindex für die Bilderkennung (data/vision/) aus den TCGdex-Kartenbildern.

    pip install onnxruntime opencv-python-headless numpy
    python3 scripts/build-vision-index.py [--cache .cache/vision]

Für jede Karte mit Bild wird mit models/card-embed.onnx (DINOv2-small, int8, mit gelerntem
Whitening) ein 128-D-Merkmalsvektor berechnet
(internationale Karten: englisches Bild, sonst eine andere Sprache; japanische Karten: eigenes Bild).
Bereits berechnete Vektoren werden übernommen, solange sich das Modell nicht geändert hat –
bei neuen Sets werden also nur die neuen Karten geladen und berechnet.

data/vision/index.bin  – int8, Karten x Dimensionen (Zeilenreihenfolge wie in keys.json)
data/vision/keys.json  – Modell-Hash, Skalierung und die Karten je Set
data/vision/lang/<set>.json – Sprach-Signaturen: grobe Textstruktur (Namensleiste, Textbereich)
                         jeder Karte in jeder Sprache, mit der die App die Kartensprache am Foto
                         erkennt, auch wenn kein Text lesbar ist (4 bit, Base64)
"""

import argparse
import hashlib
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import cv2
import numpy as np
import onnxruntime as ort

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'data')
OUT = os.path.join(DATA, 'vision')
MODEL = os.path.join(ROOT, 'models', 'card-embed.onnx')
ASSETS = 'https://assets.tcgdex.net'
INTL_LANGS = ['en', 'de', 'fr', 'es', 'it', 'pt']
IN_W, IN_H = 182, 252  # Eingangsgröße des Modells (Vielfaches der Patchgröße 14, Kartenformat)
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def card_list():
    """[(group, setId, localId, url)] – eine Bildquelle je Karte."""
    sets = {(s['g'], s['id']): s for s in json.load(open(os.path.join(DATA, 'sets.json')))['sets']}
    out, seen = [], set()
    for lang in INTL_LANGS:
        for sid, rows in json.load(open(os.path.join(DATA, f'cards-{lang}.json')))['sets'].items():
            s = sets.get(('intl', sid))
            if not s or not s.get('s'):
                continue
            for r in rows:
                if len(r) >= 3 or (sid, r[0]) in seen:  # [localId, name, 0] = kein Bild
                    continue
                seen.add((sid, r[0]))
                out.append(('intl', sid, r[0], f"{ASSETS}/{lang}/{s['s']}/{sid}/{r[0]}/low.webp"))
    for sid, rows in json.load(open(os.path.join(DATA, 'cards-ja.json')))['sets'].items():
        s = sets.get(('ja', sid))
        if not s or not s.get('s'):
            continue
        for r in rows:
            if len(r) < 3:
                out.append(('ja', sid, r[0], f"{ASSETS}/ja/{s['s']}/{sid}/{r[0]}/low.webp"))
    return out


def ssl_context():
    ca = os.environ.get('SSL_CERT_FILE')
    return ssl.create_default_context(cafile=ca) if ca else ssl.create_default_context()


def fetch(item, cache, ctx):
    group, sid, lid, url = item
    path = os.path.join(cache, f'{group}~{sid}~{lid}.webp')
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    for i in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30, context=ctx) as r:
                data = r.read()
            with open(path, 'wb') as f:
                f.write(data)
            return path
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(1 + 2 * i)
    return None


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        return None
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    if im.shape[2] == 4:  # transparente Ecken auf Grau legen
        a = im[..., 3:].astype(np.float32) / 255
        im = (im[..., :3] * a + 128 * (1 - a)).astype(np.uint8)
    return im


def prep(im):
    x = cv2.resize(im, (IN_W, IN_H), interpolation=cv2.INTER_AREA)[..., ::-1].astype(np.float32) / 255
    return ((x - MEAN) / STD).transpose(2, 0, 1)


# ---------- Sprach-Signaturen ----------
# Muss zu js/vision.js (languageFeatures/regionSignature) passen.

SIG_VERSION = 'lsig1'
SIG_W, SIG_H = 245, 342
SIG_REGIONS = [((0.02, 0.12, 0.05, 0.80), (3, 16)), ((0.50, 0.92, 0.04, 0.96), (8, 16))]


def lang_features(im):
    """Kantenenergie (|Laplace| weichgezeichnet) des Kartenbildes in 245 x 342."""
    im = cv2.resize(im, (SIG_W, SIG_H), interpolation=cv2.INTER_AREA)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 0.8)
    e = np.abs(cv2.Laplacian(g, cv2.CV_32F, ksize=3))
    return cv2.GaussianBlur(e, (0, 0), 1.5)


def signature(f):
    parts = []
    H, W = f.shape
    for (y0, y1, x0, x1), (gh, gw) in SIG_REGIONS:
        s = cv2.resize(f[round(y0 * H):round(y1 * H), round(x0 * W):round(x1 * W)], (gw, gh), interpolation=cv2.INTER_AREA).flatten()
        s = s - s.mean()
        parts.append(s / (np.abs(s).max() + 1e-6))
    q = np.clip(np.round(np.concatenate(parts) * 7), -7, 7).astype(np.int16) + 8
    packed = (q[0::2] | (q[1::2] << 4)).astype(np.uint8)
    return __import__('base64').b64encode(packed.tobytes()).decode()


def lang_items():
    """{setId: [(localId, lang, url)]} für alle internationalen Karten mit Bild in der jeweiligen Sprache."""
    sets = {s['id']: s for s in json.load(open(os.path.join(DATA, 'sets.json')))['sets'] if s['g'] == 'intl'}
    out = {}
    for lang in INTL_LANGS:
        for sid, rows in json.load(open(os.path.join(DATA, f'cards-{lang}.json')))['sets'].items():
            s = sets.get(sid)
            if not s or not s.get('s'):
                continue
            for r in rows:
                if len(r) < 3:
                    out.setdefault(sid, []).append((r[0], lang, f"{ASSETS}/{lang}/{s['s']}/{sid}/{r[0]}/low.webp"))
    return out


def build_lang_signatures(cache, ctx):
    folder = os.path.join(OUT, 'lang')
    os.makedirs(folder, exist_ok=True)
    items = lang_items()
    todo, existing = [], {}
    for sid, rows in items.items():
        path = os.path.join(folder, f'{sid}.json')
        old = json.load(open(path)) if os.path.exists(path) else {}
        cards = old.get('cards', {}) if old.get('v') == SIG_VERSION else {}
        existing[sid] = cards
        todo += [(sid, lid, lang, url) for lid, lang, url in rows if lang not in cards.get(lid, {})]
    print(f'[lang] {sum(len(r) for r in items.values())} Karten-Sprachen, neu zu berechnen: {len(todo)}', flush=True)

    def work(t):
        sid, lid, lang, url = t
        path = fetch(('L' + lang, sid, lid, url), cache, ctx)
        im = load(path) if path else None
        return (sid, lid, lang, signature(lang_features(im)) if im is not None else None)

    t0 = time.time()
    with ThreadPoolExecutor(32) as ex:
        for i, (sid, lid, lang, sig) in enumerate(ex.map(work, todo)):
            if sig:
                existing[sid].setdefault(lid, {})[lang] = sig
            if i and i % 5000 == 0:
                print(f'[lang] {i}/{len(todo)} ({round(time.time() - t0)} s)', flush=True)
    total = 0
    for sid in items:
        cards = existing[sid]
        if not cards:
            continue
        with open(os.path.join(folder, f'{sid}.json'), 'w') as f:
            json.dump({'v': SIG_VERSION, 'cards': cards}, f, separators=(',', ':'))
        total += sum(len(v) for v in cards.values())
    print(f'[lang] fertig: {total} Signaturen in {len(items)} Sets', flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache', 'vision'), help='Ordner für heruntergeladene Kartenbilder')
    ap.add_argument('--threads', type=int, default=os.cpu_count() or 4)
    ap.add_argument('--only', choices=['index', 'lang'], help='nur einen Teil erzeugen')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    if args.only != 'index':
        build_lang_signatures(args.cache, ssl_context())
    if args.only == 'lang':
        return

    model_hash = hashlib.sha256(open(MODEL, 'rb').read()).hexdigest()[:16]
    items = card_list()
    print(f'[vision] {len(items)} Karten mit Bild', flush=True)

    # Vorhandene Vektoren übernehmen (gleiches Modell)
    old = {}
    keys_path = os.path.join(OUT, 'keys.json')
    if os.path.exists(keys_path):
        meta = json.load(open(keys_path))
        if meta.get('model') == model_hash and meta.get('input') == [IN_W, IN_H]:
            vec = np.fromfile(os.path.join(OUT, 'index.bin'), np.int8).reshape(-1, meta['dims']).astype(np.float32) * meta['scale']
            i = 0
            for group, sid, ids in meta['sets']:
                for lid in ids:
                    old[(group, sid, lid)] = vec[i]
                    i += 1
    todo = [it for it in items if it[:3] not in old]
    print(f'[vision] übernommen: {len(items) - len(todo)}, neu zu berechnen: {len(todo)}', flush=True)

    new = {}
    if todo:
        so = ort.SessionOptions()
        so.intra_op_num_threads = args.threads
        sess = ort.InferenceSession(MODEL, so, providers=['CPUExecutionProvider'])
        ctx = ssl_context()
        t0 = time.time()
        with ThreadPoolExecutor(32) as ex:
            paths = list(ex.map(lambda it: fetch(it, args.cache, ctx), todo))
        print(f'[vision] Bilder geladen ({round(time.time() - t0)} s)', flush=True)
        ok = [(it, p) for it, p in zip(todo, paths) if p]
        B = 48
        with ThreadPoolExecutor(8) as ex:
            for i in range(0, len(ok), B):
                chunk = ok[i:i + B]
                ims = list(ex.map(lambda x: load(x[1]), chunk))
                pairs = [(it, im) for (it, _), im in zip(chunk, ims) if im is not None]
                if not pairs:
                    continue
                emb = sess.run(['embedding'], {'pixel_values': np.stack([prep(im) for _, im in pairs])})[0]
                emb /= np.linalg.norm(emb, axis=1, keepdims=True)
                for (it, _), v in zip(pairs, emb):
                    new[it[:3]] = v
                if i % (B * 50) == 0:
                    print(f'[vision] {i}/{len(ok)} ({round(time.time() - t0)} s)', flush=True)

    # In der Reihenfolge von card_list() speichern, gruppiert nach Set
    rows, sets = [], []
    for group, sid, lid, _ in items:
        v = new.get((group, sid, lid))
        if v is None:
            v = old.get((group, sid, lid))
        if v is None:
            continue
        if not sets or sets[-1][0] != group or sets[-1][1] != sid:
            sets.append([group, sid, []])
        sets[-1][2].append(lid)
        rows.append(v)
    X = np.stack(rows).astype(np.float32)
    scale = float(np.abs(X).max() / 127)
    Q = np.clip(np.round(X / scale), -127, 127).astype(np.int8)
    Q.tofile(os.path.join(OUT, 'index.bin'))
    meta = {'v': 1, 'model': model_hash, 'input': [IN_W, IN_H], 'dims': int(X.shape[1]), 'scale': scale, 'count': len(rows), 'sets': sets}
    with open(keys_path, 'w') as f:
        json.dump(meta, f, separators=(',', ':'))
    print(f'[vision] fertig: {len(rows)} Karten, {X.shape[1]} D, {round(Q.nbytes / 1e6, 2)} MB', flush=True)


if __name__ == '__main__':
    sys.exit(main())
