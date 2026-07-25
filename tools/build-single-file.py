"""모듈·CSS·음원을 한 파일로 합쳐 Artifact 용 HTML 을 만든다."""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# trim-mp3.py 가 만든 creepy.mp3 / escape.mp3 가 있는 곳
HERE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build')

# 의존 순서대로
MODULES = ['maze.js', 'audio.js', 'game.js', 'render.js', 'input.js', 'main.js']


def strip_module_syntax(src):
    # import 문 제거 (여러 줄 포함)
    src = re.sub(r'^import\s+[^;]*?;\s*$', '', src, flags=re.M | re.S)
    # export { ... } 제거
    src = re.sub(r'^export\s*\{[^}]*\};\s*$', '', src, flags=re.M | re.S)
    # export const / class / function → 선언만 남긴다
    src = re.sub(r'^export\s+(const|let|var|class|function)\b', r'\1', src, flags=re.M)
    return src


def main():
    css = open(f'{ROOT}/css/style.css').read()

    html = open(f'{ROOT}/index.html').read()
    body = html.split('<body>', 1)[1].split('</body>', 1)[0]
    body = body.replace('<script type="module" src="js/main.js"></script>', '').strip()

    parts = []
    for name in MODULES:
        src = open(f'{ROOT}/js/{name}').read()
        parts.append(f'/* ── {name} ── */\n' + strip_module_syntax(src).strip())
    script = '\n\n'.join(parts)

    tracks = {}
    for key, path in [('creepy', f'{HERE}/creepy.mp3'), ('escape', f'{HERE}/escape.mp3')]:
        tracks[key] = base64.b64encode(open(path, 'rb').read()).decode('ascii')

    out = f'''<title>고요한 밤</title>
<style>
{css}
</style>

{body}

<script>
window.__TRACKS = {{
  creepy: "{tracks['creepy']}",
  escape: "{tracks['escape']}"
}};
</script>

<script>
{script}
</script>
'''
    dst = f'{HERE}/silent-night.html'
    open(dst, 'w').write(out)
    print(f'{dst}: {len(out)/1024/1024:.2f}MB')

    # import/export 잔재가 남았는지 확인
    for bad in ['import {', 'export const', 'export class', 'export function', "from './"]:
        if bad in script:
            print(f'  !! 모듈 문법 잔재: {bad}')


main()
