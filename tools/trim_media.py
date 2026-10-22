#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
裁剪题目配图的空白边，并把 exam.json 里的宽高同步更新。

粉笔 PDF 里图形题的图片块常常是整行宽度，但真正的内容只占左边一小块，
直接呈现会留出一大片空白。扫描件背景有渐变，所以不能直接拿"和边缘色差"当判据，
这里用「与高斯模糊后的背景估计值比较」来找笔画（ink），再取笔画外接框。

用法:
    python tools/trim_media.py            # 处理 data/exams 下所有题库
    python tools/trim_media.py <examId>   # 只处理一个
"""

import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMS = os.path.join(ROOT, "data", "exams")

INK_DELTA = 26          # 比背景估计值暗这么多，算笔画
PAD = 8                 # 裁完留白
MIN_SAVE_RATIO = 0.985  # 裁掉的面积不足 1.5% 就不动
BLUR_RADIUS = 45


def ink_bbox(img: Image.Image):
    """返回笔画外接框；找不到或几乎占满时返回 None。"""
    gray = img.convert("L")
    bg = gray.filter(ImageFilter.GaussianBlur(radius=BLUR_RADIUS))
    a = np.asarray(gray, dtype=np.int16)
    b = np.asarray(bg, dtype=np.int16)
    mask = a < (b - INK_DELTA)
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    # 去掉极少量噪点：要求至少 0.2% 的像素被判为笔画
    if mask.sum() < mask.size * 0.002:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def trim_file(path: str):
    try:
        img = Image.open(path)
        img.load()
    except Exception as exc:                      # noqa: BLE001
        print(f"  [skip] {os.path.basename(path)}: {exc}")
        return None
    w, h = img.size
    box = ink_bbox(img)
    if not box:
        return None
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - PAD); y0 = max(0, y0 - PAD)
    x1 = min(w, x1 + PAD); y1 = min(h, y1 + PAD)
    nw, nh = x1 - x0, y1 - y0
    if nw < 12 or nh < 12:
        return None
    if (nw * nh) / float(w * h) > MIN_SAVE_RATIO:
        return None
    img.crop((x0, y0, x1, y1)).save(path, optimize=True)
    return nw, nh


def process_exam(exam_dir: str) -> None:
    exam_file = os.path.join(exam_dir, "exam.json")
    media = os.path.join(exam_dir, "media")
    if not os.path.isfile(exam_file) or not os.path.isdir(media):
        return
    with open(exam_file, encoding="utf-8") as fh:
        exam = json.load(fh)

    changed = 0
    for q in exam.get("questions", []):
        for fig in q.get("figures", []):
            for part in fig.get("parts", []):
                path = os.path.join(media, part["file"])
                if not os.path.isfile(path):
                    continue
                size = trim_file(path)
                if size:
                    part["w"], part["h"] = size
                    changed += 1

    if changed:
        with open(exam_file, "w", encoding="utf-8") as fh:
            json.dump(exam, fh, ensure_ascii=False, indent=2)
    print(f"{os.path.basename(exam_dir)}: 裁剪 {changed} 张图")


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    dirs = [os.path.join(EXAMS, only)] if only else sorted(glob.glob(os.path.join(EXAMS, "*")))
    for d in dirs:
        if os.path.isdir(d):
            process_exam(d)


if __name__ == "__main__":
    main()
