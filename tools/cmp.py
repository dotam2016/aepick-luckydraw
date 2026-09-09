"""스파이크 렌더와 레퍼런스 프레임을 나란히 붙여 비교 시트를 만든다."""
import sys
from PIL import Image, ImageDraw

shot = sys.argv[1] if len(sys.argv) > 1 else 'reports/spike-shot.png'
out = sys.argv[2] if len(sys.argv) > 2 else 'reports/cmp.jpg'
W = 540

mine = Image.open(shot).convert('RGB')
# 더미가 있는 하단 영역을 잘라 재질·조명을 비교한다
mine = mine.crop((0, int(mine.height * 0.55), mine.width, mine.height))
mine = mine.resize((W, int(mine.height * W / mine.width)), Image.LANCZOS)

ref = Image.open('apps/spike-3d/public/ref-gameplay.jpg').convert('RGB')
ref = ref.crop((0, 30, ref.width, 460))  # 큰 화면 게임플레이 영역만
ref = ref.resize((W, int(ref.height * W / ref.width)), Image.LANCZOS)

BAR = 26
canvas = Image.new('RGB', (W, mine.height + ref.height + BAR * 2), '#1a1420')
d = ImageDraw.Draw(canvas)
d.text((8, 6), 'SPIKE (Three.js)', fill='#8fe0a0')
canvas.paste(mine, (0, BAR))
d.text((8, BAR + mine.height + 6), 'REFERENCE (Lotte Lucky Picker)', fill='#e0a08f')
canvas.paste(ref, (0, BAR * 2 + mine.height))
canvas.save(out, quality=92)
print('saved', out, canvas.size)
