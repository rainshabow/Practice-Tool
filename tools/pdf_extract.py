#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
粉笔导出 PDF 题库抽取器（坐标感知切题）

用法:
    python tools/pdf_extract.py <input.pdf> <media_out_dir> [<json_out_path>]

输出 JSON:
{
  "meta": {"pages": 26, "pdf": "...", "title": "..."},
  "questions": [
    {"no": 1, "page": 2, "kind": "text" | "figure",
     "stem": "...", "options": [{"label": "A", "text": "..."}],
     "figures": [{"role": "stem"|"options"|"inline",
                  "parts": [{"file": "q1-stem.png", "w": 700, "h": 310}]}]}
  ]
}

针对粉笔网页导出 PDF 的版式约定：
  1. 题号 "N." 是独立文本 run，位于左栏 (x1 <= 46)，其 y 与题干首行相同；
     因此按 (页码, y, x) 排序时，题号会自然落在题干首行之前。
  2. 选项有单列与双列两种排布（双列时 B/D 的 x 约为 297）。
  3. 图形推理题的选项是 "如图选项A" 或仅字母占位，真正的图形是图片块。
     题干图与选项图在文档流中都出现在 "选项标签行" 之前，其中**紧邻标签行之前**
     的那张是选项图，其余是题干图。
  4. 题目的内容可以跨页（题号在上一页底部、选项在下一页顶部）。
  5. 页眉（标题栏图片/文字）、页脚（"· 本试卷由…生成"、"第 N 页，共 M 页"）、
     以及没有任何题目锚点的装饰页需过滤。
"""

import json
import os
import re
import sys

import pymupdf

# 与抽取脚本同目录的裁白边工具（新导入的图片顺带裁掉空白）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from trim_media import trim_file as _trim_file
except Exception:                                   # noqa: BLE001
    _trim_file = None

NUM_RE = re.compile(r"^(\d{1,3})\.$")
OPT_RE = re.compile(r"^([A-H])[.．、]\s*(.*)$")
FIG_OPT_RE = re.compile(r"^如图选项")
# 解析版 PDF 里每题选项之后会跟两块：「正确答案： C」「你的答案： C」
# 少量多选题答案会写成「正确答案： A D」，所以字母组要允许空格分隔
ANSWER_RE = re.compile(r"^正确答案\s*[:：]\s*([A-H](?:\s*[A-H])*)\s*$")
MINE_RE = re.compile(r"^你的答案\s*[:：]")
FOOTER_RES = [
    re.compile(r"·?\s*本试卷由粉笔用户.*生成"),
    re.compile(r"^第\s*\d+\s*页[，,]\s*共\s*\d+\s*页$"),
]
GARBAGE_RES = [re.compile(r"^粉笔$"), re.compile(r"^Fb\s*粉笔$")]

LEFT_GUTTER_X1 = 46.0
HEADER_Y1 = 72.0
FOOTER_Y0 = 786.0
RENDER_ZOOM = 2.6
MIN_IMG_PT = 7.0      # 小于该尺寸的图片块忽略


def log(*a):
    print(*a, file=sys.stderr)


def is_garbage(text):
    t = text.strip()
    if not t:
        return True
    if any(r.search(t) for r in FOOTER_RES):
        return True
    if any(r.search(t) for r in GARBAGE_RES):
        return True
    return False


def collect(doc):
    lines, imgs = [], []
    for pno, page in enumerate(doc):
        W = page.rect.width
        for b in page.get_text("dict")["blocks"]:
            x0, y0, x1, y1 = b["bbox"]
            if b["type"] == 1:
                w, h = x1 - x0, y1 - y0
                if w < MIN_IMG_PT or h < MIN_IMG_PT:
                    continue
                if x0 <= 1.5 and x1 >= W - 1.5:      # 整幅包装图
                    continue
                if y1 <= HEADER_Y1:                   # 页眉装饰
                    continue
                imgs.append({"page": pno, "x0": x0, "y0": y0, "x1": x1, "y1": y1})
                continue
            for line in b["lines"]:
                txt = "".join(s["text"] for s in line["spans"]).strip()
                if not txt or is_garbage(txt):
                    continue
                lx0, ly0, lx1, ly1 = line["bbox"]
                if ly1 <= HEADER_Y1 or ly0 >= FOOTER_Y0:
                    continue
                a = ANSWER_RE.match(txt)
                lines.append({
                    "page": pno, "x0": lx0, "y0": ly0, "x1": lx1, "y1": ly1, "text": txt,
                    "num": None,
                    "answer": a.group(1).replace(" ", "") if a else None,
                    "mine": bool(MINE_RE.match(txt)),
                })
    lines.sort(key=lambda r: (r["page"], round(r["y0"], 1), r["x0"]))
    _mark_question_numbers(lines)
    return lines, imgs


def _mark_question_numbers(lines):
    """识别题号。

    题号 `N.` 是左侧栏的独立短文本 run，但**左右边距随导出版式变化**
    （原始卷约 x=29~42，解析版约 x=59~67），所以不能写死阈值：
    先统计所有"形如 `N.` 的短行"的右边界中位数当作栏位，再按它筛选。
    """
    cands = [ln for ln in lines if NUM_RE.match(ln["text"]) and (ln["x1"] - ln["x0"]) <= 26]
    if not cands:
        return
    xs = sorted(ln["x1"] for ln in cands)
    gutter = xs[len(xs) // 2]
    for ln in cands:
        if abs(ln["x1"] - gutter) <= 5:
            ln["num"] = int(NUM_RE.match(ln["text"]).group(1))


def split_questions(lines):
    questions, cur = [], None
    for ln in lines:
        if ln["num"] is not None:
            if cur:
                questions.append(cur)
            cur = {"no": ln["num"], "page_idx": ln["page"], "page": ln["page"] + 1,
                   "num_pos": (ln["page"], ln["y0"]),
                   "stem_lines": [], "options": [], "opt_started": False, "label_pos": None,
                   "answer": None}
            continue
        if cur is None:
            continue
        if ln.get("mine"):
            continue                      # 「你的答案：」对题库无意义
        if ln.get("answer"):
            cur["answer"] = ln["answer"]  # 解析版 PDF 的标准答案
            continue
        m = OPT_RE.match(ln["text"])
        if m and len(ln["text"]) > 1:
            if not cur["opt_started"]:
                cur["opt_started"] = True
                cur["label_pos"] = (ln["page"], ln["y0"])
            cur["options"].append({"label": m.group(1), "text": m.group(2).strip(),
                                   "x0": ln["x0"], "y0": ln["y0"], "page": ln["page"], "pos": (ln["page"], ln["y0"])})
        elif not cur["opt_started"]:
            cur["stem_lines"].append(ln)
        else:
            right = ln["x0"] > 250
            for opt in reversed(cur["options"]):
                if (opt["x0"] > 250) == right:
                    opt["text"] += ln["text"]
                    break
            else:
                if cur["options"]:
                    cur["options"][-1]["text"] += ln["text"]
                else:
                    cur["stem_lines"].append(ln)
    if cur:
        questions.append(cur)
    for q in questions:
        _fix_option_overflow(q)
    return questions


def _fix_option_overflow(q):
    """题干以 "A、" 开头时会被误当成选项 A，导致选项变成 5 个。

    单选题就是 4 个选项，多出来的（连同多出来的字母）应该还回题干，
    剩下的重新按 A-D 编号。
    """
    opts = q["options"]
    if len(opts) <= 4:
        return
    extra = len(opts) - 4
    moved = []
    for o in opts[:extra]:
        moved.append({"text": o["label"] + "、" + o["text"],
                      "page": o.get("page", 0), "y0": o.get("y0", 0), "y1": o.get("y1", 0)})
    q["stem_lines"] = moved + q["stem_lines"]
    q["options"] = opts[extra:]
    for i, o in enumerate(q["options"]):
        o["label"] = "ABCDEFGH"[i]


def is_figure_question(q):
    """选项全部是图片占位（如图选项A / 仅字母）时判定为图形题。"""
    if len(q["options"]) < 2:
        return False
    for o in q["options"]:
        t = o["text"]
        if FIG_OPT_RE.match(t):
            continue
        if t == "" or t == o["label"]:
            continue
        return False
    return True


PLACEHOLDER_RE = re.compile(r"^选项[A-H]")


def is_placeholder_option_question(q):
    """选项是 "A.选项A" 这种占位——真实内容是一整张截图。

    放宽成前缀匹配：两栏排版时，下一题的题干可能被粘到某个占位选项后面
    （如 "B.选项B2019年2月中下旬，某市统计局…"），仍然算占位。
    """
    if len(q["options"]) < 2:
        return False
    return all(PLACEHOLDER_RE.match(o["text"]) for o in q["options"])


def assign_images(questions, imgs):
    """按题目在文档流中的跨度分配图片，并区分题干图 / 选项图 / 行内图。"""
    anchors = [q["num_pos"] for q in questions]
    anchored_pages = {p for p, _ in anchors}

    def owner(page, y):
        idx = -1
        for i, (p, ay) in enumerate(anchors):
            if (p, ay) <= (page, y):
                idx = i
            else:
                break
        return idx

    # ① 先认"紧贴选项标签行上方"的图：那是本题的选项图。
    #    它通常排在题号**之前**，按题号前缀归属会被错算到上一题，所以单独处理。
    label_index = {}
    for qi, q in enumerate(questions):
        lp = q.get("label_pos")
        if lp:
            label_index.setdefault(lp[0], []).append((lp[1], qi))

    taken = set()
    for img in imgs:
        rows = label_index.get(img["page"])
        if not rows:
            continue
        for ly, qi in rows:
            gap = ly - img["y1"]
            if 0 <= gap <= 16:
                questions[qi].setdefault("_optimg", []).append(img)
                taken.add(id(img))
                break

    # ② 其余图片按"前面最近的题号"归属。
    #    用图片**中心**而不是上沿判断：题干图常常微微越出题号行（如 y0 比题号还高一点），
    #    用上沿会把它算给上一题。
    for img in imgs:
        if id(img) in taken:
            continue
        if img["page"] not in anchored_pages:
            continue
        qi = owner(img["page"], (img["y0"] + img["y1"]) / 2)
        if qi < 0:
            continue
        questions[qi].setdefault("_imgs", []).append(img)

    for qi, q in enumerate(questions):
        q["kind"] = "figure" if is_figure_question(q) else "text"
        pics = q.get("_imgs", [])
        opt_imgs = q.pop("_optimg", [])
        lp = q.get("label_pos")
        q["figures"] = []

        # 有些题（联想/性格测评那类）把「题干 + 四个选项」整张截成一张图，
        # 文本层只剩 "A.选项A"…"D.选项D" 占位。这种既不是常规文本题也不是图形推理题，
        # 单独标成 image，界面上只展示图片 + 解析，不再编造选项。
        if is_placeholder_option_question(q):
            q["kind"] = "image"
            all_imgs = list(opt_imgs) + list(pics)
            if all_imgs:
                for i in all_imgs:
                    i["_role"] = "stem"
                q["figures"] = [{"role": "stem", "imgs": all_imgs}]
            continue

        if q["kind"] == "figure" and (pics or opt_imgs):
            lpos = lp or (10 ** 6, 10 ** 6)
            before = [i for i in pics if (i["page"], i["y1"]) <= lpos]
            after = [i for i in pics if (i["page"], i["y1"]) > lpos]
            if opt_imgs:
                q["figures"].append({"role": "options", "imgs": opt_imgs})
            elif before:
                q["figures"].append({"role": "options", "imgs": [before[-1]]})
                before = before[:-1]
            if before:
                q["figures"].append({"role": "stem", "imgs": before})
            if after:
                q["figures"].append({"role": "stem", "imgs": after})
            q["figures"].sort(key=lambda f: 0 if f["role"] == "stem" else 1)
            for f in q["figures"]:
                for i in f["imgs"]:
                    i["_role"] = f["role"]
        elif pics or opt_imgs:
            allp = list(opt_imgs) + list(pics)
            for i in allp:
                i["_role"] = "inline"
            q["figures"] = [{"role": "inline", "imgs": allp}]
            # 行内公式/小图：在题干对应行补一个占位标记
            for i in allp:
                if i["y1"] - i["y0"] < 40 and i["x1"] - i["x0"] < 40:
                    best, bestd = None, 1e9
                    for ln in q["stem_lines"]:
                        if ln["page"] != i["page"]:
                            continue
                        d = abs((ln["y0"] + ln["y1"]) / 2 - (i["y0"] + i["y1"]) / 2)
                        if d < bestd:
                            best, bestd = ln, d
                    if best is not None and bestd < 30:
                        best["_mark"] = True
        q.pop("_imgs", None)


def render(doc, q, media_dir):
    out = []
    for f in q["figures"]:
        by_page = {}
        for i in f["imgs"]:
            by_page.setdefault(i["page"], []).append((i["x0"], i["y0"], i["x1"], i["y1"]))
        parts = []
        for pno in sorted(by_page):
            rs = by_page[pno]
            bb = (min(r[0] for r in rs), min(r[1] for r in rs),
                  max(r[2] for r in rs), max(r[3] for r in rs))
            clip = pymupdf.Rect(bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2)
            pix = doc[pno].get_pixmap(clip=clip, matrix=pymupdf.Matrix(RENDER_ZOOM, RENDER_ZOOM))
            suffix = f"-p{pno + 1}" if len(by_page) > 1 else ""
            name = f"q{q['no']}-{f['role']}{suffix}.png"
            out_path = os.path.join(media_dir, name)
            pix.save(out_path)
            trimmed = _trim_file(out_path) if _trim_file else None
            w, h = trimmed if trimmed else (pix.width, pix.height)
            parts.append({"file": name, "w": w, "h": h})
        out.append({"role": f["role"], "parts": parts})
    return out


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    pdf_path, media_dir = sys.argv[1], sys.argv[2]
    json_out = sys.argv[3] if len(sys.argv) > 3 else None
    os.makedirs(media_dir, exist_ok=True)

    doc = pymupdf.open(pdf_path)
    lines, imgs = collect(doc)
    questions = split_questions(lines)
    assign_images(questions, imgs)

    result, seen = [], set()
    for q in questions:
        if q["no"] in seen:
            log(f"[warn] duplicate number {q['no']}")
        seen.add(q["no"])
        stem = "".join(ln["text"] + ("〔图〕" if ln.get("_mark") else "") for ln in q["stem_lines"]).strip()
        options = [{"label": o["label"], "text": o["text"]} for o in q["options"]]
        figs = render(doc, q, media_dir)
        if q["kind"] == "figure":
            for o in options:
                o["text"] = ""
            if not stem:
                stem = "请选择最合适的一个填入问号处，使之呈现一定的规律性。"
        elif q["kind"] == "image":
            # 内容整张在截图里，占位选项没有意义，别让它们冒充 ABCD
            options = []
            if not stem:
                stem = "（本题题干与选项为一张截图，见下图）"
        if not stem and q["kind"] == "text" and not figs:
            # 题干是矢量排版的公式/图形，文本层取不到
            stem = "（原卷此题题干为公式/图形排版，文本层为空，请参看解析）"
        result.append({"no": q["no"], "page": q["page"], "kind": q["kind"],
                       "stem": stem, "options": options, "figures": figs,
                       "answer": q.get("answer")})

    answered = sum(1 for q in result if q.get("answer"))
    payload = {"meta": {"pages": doc.page_count, "pdf": os.path.basename(pdf_path),
                        "title": (doc.metadata or {}).get("title") or "",
                        "answersFound": answered},
               "questions": result}
    text = json.dumps(payload, ensure_ascii=False, indent=1)
    if json_out:
        with open(json_out, "w", encoding="utf-8") as fh:
            fh.write(text)
        log(f"[ok] {len(result)} questions -> {json_out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
