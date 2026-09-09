"""두 렌더를 나란히 비교."""
import sys
from PIL import Image, ImageDraw
a_path, a_label, b_path, b_label, out = sys.argv[1:6]
W = 520
def load(p):
    im = Image.open(p).convert('RGB')
    im = im.crop((0, int(im.height*0.58), im.width, im.height))
    return im.resize((W, int(im.height*W/im.width)), Image.LANCZOS)
a, b = load(a_path), load(b_path)
BAR = 24
c = Image.new('RGB', (W, a.height+b.height+BAR*2), '#1a1420')
d = ImageDraw.Draw(c)
d.text((8,5), a_label, fill='#8fe0a0'); c.paste(a,(0,BAR))
d.text((8,BAR+a.height+5), b_label, fill='#e0c08f'); c.paste(b,(0,BAR*2+a.height))
c.save(out, quality=92)
print('saved', out)
