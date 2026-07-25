"""MP3 를 프레임 경계에서 잘라 앞부분 N 초만 남긴다 (재인코딩 없음)."""
import os, sys, struct

BITRATES_V1L3 = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,None]
BITRATES_V2L3 = [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,None]
RATES = {3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000]}


def skip_id3(data):
    if data[:3] == b'ID3':
        size = 0
        for b in data[6:10]:
            size = (size << 7) | (b & 0x7F)
        return 10 + size
    return 0


def trim(src, dst, seconds):
    data = open(src, 'rb').read()
    pos = skip_id3(data)
    start = pos
    total = 0.0
    frames = 0
    while pos + 4 <= len(data):
        h = struct.unpack('>I', data[pos:pos + 4])[0]
        if (h & 0xFFE00000) != 0xFFE00000:
            pos += 1
            continue
        ver = (h >> 19) & 3
        layer = (h >> 17) & 3
        br_idx = (h >> 12) & 15
        sr_idx = (h >> 10) & 3
        pad = (h >> 9) & 1
        if layer != 1 or ver == 1 or sr_idx == 3 or br_idx in (0, 15):
            pos += 1
            continue
        rates = RATES.get(ver)
        if not rates:
            pos += 1
            continue
        sr = rates[sr_idx]
        table = BITRATES_V1L3 if ver == 3 else BITRATES_V2L3
        br = table[br_idx]
        if not br:
            pos += 1
            continue
        spf = 1152 if ver == 3 else 576
        length = (spf // 8) * br * 1000 // sr + pad
        dur = spf / sr
        if total + dur > seconds:
            break
        total += dur
        frames += 1
        pos += length

    out = data[start:pos]
    open(dst, 'wb').write(out)
    return len(data), len(out), round(total, 1), frames


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build')
os.makedirs(OUT, exist_ok=True)

for src, dst, secs in [
    (f'{ROOT}/Christmas Time Again.mp3', f'{OUT}/creepy.mp3', 62),
    (f'{ROOT}/A Magical Evening Begins.mp3', f'{OUT}/escape.mp3', 42),
]:
    a, b, d, f = trim(src, dst, secs)
    print(f'{src.split("/")[-1]}: {a/1024/1024:.2f}MB -> {b/1024/1024:.2f}MB ({d}초, {f}프레임)')
