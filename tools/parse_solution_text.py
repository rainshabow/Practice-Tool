#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把粉笔解析页「全选复制」下来的文本，解析成逐题的解析/考点，写回本地题库。

为什么不直接调接口：
  - 解析正文在 `combine/static/solution` 这个签名接口里，需要登录态；
    抓包工具对超大 body 会截断，直接 fetch 又缺 cookie（也不该去扒 cookie）。
  - 而解析页会把每道题的「解析 / 考点 / 来源」都渲染成文本，
    全选复制就能整篇落盘，既不碰凭据也不受 body 大小限制。

用法:
    python tools/parse_solution_text.py <clipboard.txt> <examId> [--dry]

文本里每题大致是：
    <题号>. / 单选题 / 题干 / A 选项 / B 选项 ... /
    <正确字母> 正确答案 / 未作答 你的答案 / <比例>% 全站正确率 / 易错项 <字母> /
    解析 / <正文...> / 考点 / <考点...> / 来源 / <试卷名>第N题 / 笔记 / 添加笔记
按「解析」出现的顺序即可对上题号（来源里的第N题可能是原卷题号，不能当序号用）。
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXAMS = os.path.join(ROOT, "data", "exams")

ANS_LINE = re.compile(r"^[A-H]$")


def parse_blocks(text):
    """按「解析」行切块，返回 [{explanation, keypoints, source, answer}]。"""
    lines = [ln.strip() for ln in text.replace("\r\n", "\n").split("\n")]
    hits = [i for i, ln in enumerate(lines) if ln == "解析"]
    blocks = []
    for n, i in enumerate(hits):
        end = hits[n + 1] if n + 1 < len(hits) else len(lines)

        # ① 解析正文：从「解析」后一行到「考点 / 来源 / 笔记」
        body = []
        j = i + 1
        while j < end and lines[j] not in ("考点", "来源", "笔记"):
            body.append(lines[j])
            j += 1

        # ② 考点
        keypoints = []
        k = j
        if k < end and lines[k] == "考点":
            k += 1
            while k < end and lines[k] not in ("来源", "笔记"):
                if lines[k]:
                    keypoints.append(lines[k])
                k += 1

        # ③ 来源
        source = ""
        m = k
        if m < end and lines[m] == "来源":
            m += 1
            if m < end:
                source = lines[m]

        # ④ 正确选项字母：「正确答案」标签前面那一行
        answer = None
        for q in range(i - 1, max(0, i - 14), -1):
            if lines[q] == "正确答案" and q - 1 >= 0 and ANS_LINE.match(lines[q - 1]):
                answer = lines[q - 1]
                break

        # ⑤ 论述题没有 ABCD，答案写在「答案」标签后面
        answer_text = ""
        if not answer:
            for q in range(i - 1, max(0, i - 12), -1):
                if lines[q] == "答案":
                    answer_text = lines[q + 1] if q + 1 < i else ""
                    break

        explanation = "\n".join(x for x in body if x).strip()
        blocks.append({
            "explanation": explanation,
            "keypoints": keypoints,
            "source": source,
            "answer": answer,
            "answerText": answer_text,
        })
    return blocks


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    clip_path, exam_id = sys.argv[1], sys.argv[2]
    dry = "--dry" in sys.argv

    exam_file = os.path.join(EXAMS, exam_id, "exam.json")
    if not os.path.isfile(exam_file):
        print(f"找不到题库：{exam_file}")
        sys.exit(2)

    text = open(clip_path, encoding="utf-8").read()
    blocks = parse_blocks(text)
    exam = json.load(open(exam_file, encoding="utf-8"))
    qs = exam["questions"]

    print(f"文本块 {len(blocks)} 个 / 题库 {len(qs)} 题")

    # 按顺序对齐，并用正确答案校验顺序
    n = min(len(blocks), len(qs))
    mismatch = 0
    filled = 0
    for i in range(n):
        b, q = blocks[i], qs[i]
        if b["answer"] and q.get("answer") and b["answer"] != str(q["answer"])[:1].upper():
            mismatch += 1
        if b["explanation"]:
            filled += 1

    ratio = mismatch / n if n else 1
    print(f"正确字母不一致 {mismatch}/{n}（{ratio * 100:.1f}%）；有解析 {filled} 题")
    if ratio > 0.15:
        print("⚠ 顺序可能对不上（不一致比例过高），已中止。请确认这是同一套卷的解析页。")
        sys.exit(3)

    if not dry:
        filled_answers = 0
        for i in range(n):
            b, q = blocks[i], qs[i]
            # 本地缺答案的题（原卷就没给），解析页里可能有标准答案，顺手补上
            if not q.get("answer") and b.get("answer"):
                q["answer"] = b["answer"]
                q["answerSource"] = "fenbi"
                q["confidence"] = "high"
                filled_answers += 1
            if not b["explanation"]:
                continue
            q["explanation"] = b["explanation"]
            q["explanationSource"] = "fenbi"
            if b["keypoints"]:
                q["keypoints"] = b["keypoints"]
            # 论述题：没有选项，参考答案是文字
            if b.get("answerText") and not q.get("answer"):
                q["answerText"] = b["answerText"]
                q["kind"] = "essay"
                if not q.get("options"):
                    stem = str(q.get("stem", ""))
                    stem = stem.replace("（论述题）", "", 1)
                    for marker in ("✤ 答案", "答案", "✤ 解析"):
                        cut = stem.find(marker)
                        if cut > 0:
                            stem = stem[:cut]
                            break
                    q["stem"] = stem.strip()
        # 统计
        exam["stats"] = exam.get("stats") or {}
        exam["stats"]["withExplanation"] = sum(1 for q in qs if q.get("explanation"))
        exam["stats"]["withAnswer"] = sum(1 for q in qs if q.get("answer"))
        exam["stats"]["missingAnswer"] = [q["no"] for q in qs if not q.get("answer")]
        if filled_answers:
            print(f"  另外补上了 {filled_answers} 道题的标准答案")
        exam["officialAnswers"] = exam.get("officialAnswers") or {}
        exam["officialAnswers"]["explanationSource"] = "fenbi 解析页（全选复制）"
        exam["officialAnswers"]["explanationImportedAt"] = __import__("datetime").datetime.now().isoformat(timespec="seconds")
        tmp = exam_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(exam, f, ensure_ascii=False, indent=2)
        os.replace(tmp, exam_file)
        print(f"✓ 已写入 {n} 题解析 -> {exam_file}")
    else:
        print("（--dry 模式，未写盘）")
        for i in range(min(2, n)):
            print(f"\n--- 第 {i + 1} 题 ---")
            print("答案:", blocks[i]["answer"], "\n考点:", blocks[i]["keypoints"])
            print("解析:", blocks[i]["explanation"][:160])


if __name__ == "__main__":
    main()
