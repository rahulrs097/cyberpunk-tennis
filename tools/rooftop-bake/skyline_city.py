# The Rain/Concrete 3D skyline strip (models/rooftop/skyline_city.png) from
# Poly Haven's Shanghai Bund HDRI (CC0): the Pudong skyline across the river,
# shrunk to SCALE so it reads as a city a few km off, with mirrored, dimmer
# copies round the rest of the circle (far districts), the river and
# promenade below the waterline darkened, and the hazy photo sky taken down
# towards night. The strip covers -4..14 degrees, 4096 x 205 (as skyline.py).
from PIL import Image
import numpy as np
SCALE = 0.62
im = Image.open('shanghai_bund.jpg').convert('RGB')
W, H = im.size; pxd = W / 360; hz = H // 2
top = int(hz - 14 / SCALE * pxd); bot = int(hz + 4 / SCALE * pxd)
x0 = int(W * 0.33); n0 = 3441
S = im.crop((x0, top, x0 + n0, bot))
n = int(n0 * SCALE); h = int(S.size[1] * SCALE)
S = np.asarray(S.resize((n, h), Image.LANCZOS)).astype(np.float32) / 255
reps = int(np.ceil(W / n)) + 1
strip = np.concatenate([S if i % 2 == 0 else S[:, ::-1] for i in range(reps)], axis=1)[:, :W]
x = np.arange(W); d = np.where(x < n, 0, np.minimum(x - (n - 1), W - x))
strip = strip * (0.4 + 0.6 * np.clip(1 - d / 400, 0, 1))[None, :, None]
pearl = int(2110 * SCALE)
strip = np.roll(strip, int(0.515 * W) - pearl, axis=1)
lat = 14 - np.arange(h) / pxd
strip = np.where((lat < -0.15)[:, None, None], strip * 0.12, strip)
lum = strip.mean(axis=2, keepdims=True)
dark = np.clip((0.55 - lum) / 0.25, 0, 1) * np.clip((lat - 0.3) / 2, 0, 1)[:, None, None]
strip = strip * (1 - 0.75 * dark)
k = np.clip((lat - 3) / 8, 0, 1)[:, None, None]; strip = strip * (1 - 0.5 * k)
alpha = np.clip((14 - lat) / 6, 0, 1)
out = np.dstack([np.clip(strip, 0, 1) * 255, np.repeat(alpha[:, None], W, 1) * 255]).astype(np.uint8)
img = Image.fromarray(out, 'RGBA').resize((4096, 205), Image.LANCZOS)
img.save('/home/user/cyberpunk-tennis/models/rooftop/skyline_city.png', optimize=True)
img.convert('RGB').resize((2048, 102)).save('preview.jpg')
