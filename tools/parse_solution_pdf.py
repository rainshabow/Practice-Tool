#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从粉笔「解析版」PDF 里抽取标准答案。

粉笔解析页导出的 PDF（报告页右上角「下载」）在每道题选项之后有一块：
    正确答案： C
    你的答案： C
本题号 `N.` 依旧是左侧栏的独立文本 run（y 与题干首行相同），
所以配对规则很简单：**答案块归属于它前面最近的那个题号**。

用法:
    python tools/parse_solution_pdf.py <solution.pdf> [out.json]
输出:
    {"answers": {"1": "C", "2": "A", ...}, "meta": {...}}
"""

import json
import os
import re
import sys

import pymupdf

NUM_RE = re.compile(r"^(\d{1,3})\.$")
ANS_RE = re.compile(r"^正确答案\s*[:：]\s*([A-H])\s*$")
MINE_RE = re.compile(r"^你的答案\s*[:：]\s*([A-H]?)\s*$")

HEADER_Y1 = 72.0
FOOTER_Y0 = 786.0
LEFT_GUTTER_X1 = 70.0


def collect(doc):
    """返回按文档顺序排好的 (题号, 正确答案) 两类锚点。"""
    nums, ans = [], []
    for pno, page in enumerate(doc):
        for block in page.get_text("dict")["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                text = "".join(s["text"] for s in line["spans"]).strip()
                if not text:
                    continue
                x0, y0, x1, y1 = line["bbox"]
                if y0 >= FOOTER_Y0 or y1 <= HEADER_Y1:
                    continue
                m = NUM_RE.match(text)
                if m and x1 <= LEFT_GUTTER_X1:
                    nums.append((pno, y0, int(m.group(1))))
                    continue
                a = ANS_RE.match(text)
                if a:
                    ans.append((pno, y0, a.group(1)))
    nums.sort()
    ans.sort()
    return nums, ans


def pair(nums, ans):
    """每个答案块归属于它前面最近的题号。"""
    out, mi = {}, 0
    for pno, y, letter in ans:
        owner = None
        while mi < len(nums) and (nums[mi][0], nums[mi][1]) <= (pno, y):
            owner = nums[mi][2]
            mi += 1
        if owner is not None:
            if owner in out and out[owner] != letter:
                print(f"[warn] 第 {owner} 题出现两个不同答案：{out[owner]} / {letter}", file=sys.stderr)
            out[owner] = letter
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    pdf_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    doc = pymupdf.open(pdf_path)
    nums, ans = collect(doc)
    answers = pair(nums, ans)

    payload = {
        "meta": {
            "pdf": os.path.basename(pdf_path),
            "pages": doc.page_count,
            "question_numbers": len(nums),
            "answer_blocks": len(ans),
            "answered": len(answers),
        },
        "answers": {str(k): answers[k] for k in sorted(answers)},
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"[ok] {len(answers)} 个答案 -> {out_path}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
