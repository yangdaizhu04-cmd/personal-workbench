# -*- coding: utf-8 -*-
"""
霞鹜文楷 Lite 常用字子集生成器
输入：.tmp/LXGWWenKaiLite-Regular.ttf（需先下载）+ js/css/data 目录扫描 + 字频表
输出：vendor/font/lxgw-wenkai-subset.woff2
字符集 = 字频表 Top N 常用汉字 ∪ 项目源码中出现的所有字符 ∪ ASCII/常用标点/符号
"""
import os, sys, io

ROOT = os.path.dirname(os.path.abspath(__file__))
FREQ = os.path.join(ROOT, ".tmp", "zh_freq.txt")
TTF = os.path.join(ROOT, ".tmp", "LXGWWenKaiLite-Regular.ttf")
OUT = os.path.join(ROOT, "vendor", "font", "lxgw-wenkai-subset.woff2")
TOPN = 4500

def is_cjk(c):
    return 0x4E00 <= ord(c) <= 0x9FFF

chars = set()

# 1) ASCII 可打印 + 制表
chars.update(chr(i) for i in range(0x20, 0x7F))

# 2) 常用中文标点与符号（界面会用到的全部_extra）
extra = ("，。、；：？！“”‘’（）《》〈〉【】〔〕·—…～￥％°×÷±√"
         "✓✗★☆♥♦♣♠←→↑↓↔⇧⌘⏰⏸▶◀☎☕svg"
         "一二三四五六七八九十百千万亿零壹贰叁肆伍陆柒捌玖拾"
         "○●◐◑◇◆□■△▲▽▼※§¶†‡‰℃℉㎡㎝㎏"
         "　")
chars.update(extra)

# 3) 字频表 Top N
if os.path.exists(FREQ):
    with io.open(FREQ, encoding="utf-8") as f:
        for line in f:
            for ch in line.split(" ")[0].strip():
                if is_cjk(ch):
                    chars.add(ch)
                    if len([c for c in chars if is_cjk(c)]) >= TOPN:
                        break
            if len([c for c in chars if is_cjk(c)]) >= TOPN:
                break

# 4) 扫描项目源码（js/ css/ *.html build.js 等），保证 UI 文案全覆盖
SCAN_DIRS = ["js", "css"]
SCAN_FILES = ["index.html", "build.js", "desktop/README.md"]
for d in SCAN_DIRS:
    for dp, _, fns in os.walk(os.path.join(ROOT, d)):
        for fn in fns:
            if fn.endswith((".js", ".css", ".html")):
                p = os.path.join(dp, fn)
                try:
                    with io.open(p, encoding="utf-8") as f:
                        chars.update(f.read())
                except Exception:
                    pass
for fn in SCAN_FILES:
    p = os.path.join(ROOT, fn)
    if os.path.exists(p):
        with io.open(p, encoding="utf-8") as f:
            chars.update(f.read())

text = "".join(sorted(chars))
cjk_n = sum(1 for c in text if is_cjk(c))
print("charset: total %d (cjk %d)" % (len(text), cjk_n))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

opts = Options()
opts.flavor = "woff2"
opts.layout_features = ["*"]  # 保留 kern 等
opts.name_IDs = [1, 2]
opts.drop_tables += ["FFTM"]
opts.ignore_missing_glyphs = True
opts.notdef_outline = True

font = TTFont(TTF)
ss = Subsetter(options=opts)
ss.populate(text=text)
ss.subset(font)
font.save(OUT)
size = os.path.getsize(OUT)
print("written %s (%.1f KB)" % (OUT, size / 1024))
