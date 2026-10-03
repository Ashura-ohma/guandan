#!/usr/bin/env python3
"""Generate original geometric playing-card icon assets (Pillow only)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math

OUT = Path(__file__).resolve().parent / 'res'
N = 1296
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
fg = Image.new('RGBA', (N, N))

def card(angle, x, y, suit, red):
    tile = Image.new('RGBA', (360, 500))
    d = ImageDraw.Draw(tile)
    d.rounded_rectangle((5, 5, 350, 490), radius=40, fill=(247,244,226), outline=(220,183,91), width=8)
    color = (216,63,78) if red else (14,63,63)
    d.text((32, 23), 'A', font=ImageFont.truetype(font_path, 80), fill=color)
    if suit == 'heart':
        d.ellipse((74,165,192,283),fill=color); d.ellipse((166,165,284,283),fill=color)
        d.polygon([(76,238),(282,238),(180,358)],fill=color)
    else:
        d.polygon([(180,157),(75,285),(284,285)],fill=color)
        d.ellipse((72,246,180,341),fill=color); d.ellipse((174,246,283,341),fill=color)
        d.polygon([(180,279),(143,378),(216,378)],fill=color)
    turned=tile.rotate(angle, Image.Resampling.BICUBIC, expand=True)
    fg.alpha_composite(turned, (x,y))

card(17,330,362,'spade',False)
card(-13,563,328,'heart',True)
d=ImageDraw.Draw(fg)
# A small original golden star, top center.
points=[]
for i in range(8):
    a = -math.pi/2 + i*math.pi/4
    r=64 if i%2==0 else 23
    points.append((648+math.cos(a)*r,285+math.sin(a)*r))
d.polygon(points, fill=(244,212,136))
fg.resize((432,432),Image.Resampling.LANCZOS).save(OUT/'drawable-nodpi/icon_foreground.png')
# Full-resolution preview and legacy icon are generated from the same design.
bg=Image.new('RGBA',(N,N),(9,44,43,255))
bgd=ImageDraw.Draw(bg)
for r in range(640,100,-2):
    ratio=(640-r)/540
    bgd.ellipse((648-r,648-r,648+r,648+r),fill=(9,int(44+13*ratio),int(43+13*ratio),255))
bgd.rounded_rectangle((35,35,1261,1261),radius=275,outline=(161,127,57,255),width=10)
bg.alpha_composite(fg)
bg.resize((512,512),Image.Resampling.LANCZOS).save(OUT/'drawable/icon.png')
print('Original icon generated')
