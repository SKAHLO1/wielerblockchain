# Crops each element out of tools/asset-sheet.webp (1500x1000) into public/images/art/.
# Usage: python tools/crop-assets.py   (from frontend/)
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHEET = Image.open(ROOT / 'tools' / 'asset-sheet.webp').convert('RGB')
OUT = ROOT / 'public' / 'images' / 'art'
OUT.mkdir(parents=True, exist_ok=True)

# name: (left, top, right, bottom)
BOXES = {
    'barbarian-full':      (20, 0, 335, 392),
    'barbarian-attacking': (330, 95, 565, 360),
    'barbarian-defending': (565, 110, 760, 360),
    'barbarian-victorious':(740, 5, 935, 360),
    'barbarian-portrait':  (935, 70, 1140, 355),
    'banner-w':            (1160, 25, 1230, 190),
    'banner-btc':          (1160, 205, 1232, 330),
    'banner-eth':          (1240, 205, 1312, 330),
    'banner-sol':          (1320, 205, 1392, 330),
    'banner-near':         (1398, 205, 1470, 330),
    'fortress-eth':        (380, 405, 665, 615),
    'citadel-sol':         (665, 405, 945, 615),
    'keep-near':           (945, 405, 1200, 615),
    'throne-wieler':       (1200, 395, 1500, 615),
    'battlefield':         (12, 672, 334, 930),
    'kingdom':             (346, 672, 664, 930),
    'raiders':             (677, 672, 943, 930),
    'clan-leader':         (957, 690, 1107, 935),
    'conqueror':           (1120, 690, 1270, 935),
    'icon-coin':           (1295, 688, 1385, 778),
    'icon-trophy':         (1390, 688, 1475, 778),
    'icon-shield':         (1305, 782, 1375, 852),
    'icon-helmet':         (1405, 778, 1475, 852),
    'icon-chest':          (1295, 852, 1385, 930),
    'icon-scroll':         (1388, 852, 1475, 932),
}

for name, box in BOXES.items():
    SHEET.crop(box).save(OUT / f'{name}.webp', 'WEBP', quality=90)
print(f'{len(BOXES)} crops -> {OUT}')
