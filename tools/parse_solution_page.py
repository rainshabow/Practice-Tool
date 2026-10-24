"""把粉笔解析页「全选复制」得到的文本解析成题库 JSON。

文本里每个文本节点单独一行，结构大致是：
    N. / 单选题 / 题干… / A / 选项A… / B / … / D / … / <答案字母> / 正确答案 /
    未作答 / 你的答案 / <百分比> / % / 全站正确率 / <易错项字母> / 易错项 / 解析 /
    解析正文… / 考点 / <考点> / 来源 / <来源> / 笔记 / 添加笔记
"""
import json
import re
import sys

TYPES = ('单选题', '多选题', '判断题', '不定项选择题', '简答题', '论述题', '材料题')
NUM_RE = re.compile(r'^(\d{1,3})\.$')
LETTERS = 'ABCDEFGH'
SECTION_RE = re.compile(r'^[（(]\s*(\d+)\s*题\s*[）)]$')
SECTION_NAMES = ('思想素质', '通用能力', '综合知识', '专业能力', '英语', '资料分析')


def tokens_of(text):
    return [ln.strip() for ln in text.replace('\r', '').split('\n') if ln.strip()]


def split_blocks(toks):
    """按「题号 + 题型」切块；顺带记住每题属于哪个分节。"""
    starts = []
    for i, t in enumerate(toks):
        m = NUM_RE.match(t)
        if m and i + 1 < len(toks) and toks[i + 1] in TYPES:
            starts.append((i, int(m.group(1))))

    # 分节标题：形如 思想素质 / （30题） / 说明
    heads = []
    for i, t in enumerate(toks):
        if t in SECTION_NAMES and i + 1 < len(toks) and SECTION_RE.match(toks[i + 1]):
            heads.append((i, t))

    def section_at(idx):
        name = '综合知识'
        for h, n in heads:
            if h < idx:
                name = n
            else:
                break
        return name

    blocks = []
    for k, (i, no) in enumerate(starts):
        end = starts[k + 1][0] if k + 1 < len(starts) else len(toks)
        blocks.append((no, toks[i:end], section_at(i)))

    # 块尾到下一块之间的正文（材料题的资料）挂到下一题，遇到分节标题就截断
    for k in range(len(blocks) - 1):
        cur = blocks[k][1]
        if '添加笔记' not in cur:
            continue
        tail = cur[cur.index('添加笔记') + 1:]
        cut = len(tail)
        for j, t in enumerate(tail):
            if any(t == n and SECTION_RE.match(tail[j + 1]) if j + 1 < len(tail) else False
                   for n in SECTION_NAMES):
                cut = j
                break
        tail = tail[:cut]
        if tail:
            blocks[k + 1][1].insert(2, '〔材料〕' + ''.join(tail))
    return blocks


def parse_block(no, toks, section='综合知识'):
    kind_name = toks[1]
    # 选项从第一个单独的 "A" 开始
    try:
        opt_start = toks.index('A', 2)
    except ValueError:
        opt_start = -1
    stem = ''.join(toks[2:opt_start]) if opt_start > 0 else ''.join(toks[2:])

    # 「正确答案」前一个 token 就是答案字母
    try:
        ans_at = toks.index('正确答案', opt_start if opt_start > 0 else 2)
    except ValueError:
        ans_at = -1

    options = []
    if opt_start > 0 and ans_at > opt_start:
        region = toks[opt_start:ans_at - 1]
        cur = None
        for t in region:
            if len(options) < 8 and t == LETTERS[len(options)]:
                options.append({'label': t, 'text': ''})
                cur = options[-1]
            elif cur is not None:
                cur['text'] += t

    answer = toks[ans_at - 1] if ans_at > 0 else None
    if answer and not re.fullmatch(r'[A-H]{1,8}', answer):
        answer = None

    expl, kp, src = '', [], ''
    if ans_at > 0:
        try:
            ex_at = toks.index('解析', ans_at)
        except ValueError:
            ex_at = -1
        if ex_at > 0:
            try:
                src_at = toks.index('来源', ex_at)
            except ValueError:
                src_at = len(toks)
            kp_at = -1
            for j in range(src_at - 1, ex_at, -1):
                if toks[j] == '考点':
                    kp_at = j
                    break
            expl_at_end = kp_at if kp_at > 0 else src_at
            expl = ''.join(toks[ex_at + 1:expl_at_end])
            if kp_at > 0 and kp_at + 1 < src_at:
                kp = [x for x in re.split(r'[/,，、]', ''.join(toks[kp_at + 1:src_at])) if x.strip()]
            if src_at + 1 < len(toks):
                src = toks[src_at + 1]

    # 选项全空 => 图形题（选项是图片，复制拿不到）
    has_text = any(o['text'].strip() for o in options)
    kind = 'text' if has_text else ('figure' if options else 'essay')
    return {
        'no': no,
        'kind': kind,
        'stem': stem,
        'options': options,
        'answer': answer,
        'explanation': expl,
        'keypoints': kp,
        'source': src,
        'section': section,
        'typeName': kind_name,
    }


def main():
    src_path, out_path = sys.argv[1], sys.argv[2]
    toks = tokens_of(open(src_path, encoding='utf-8').read())
    blocks = split_blocks(toks)
    qs = [parse_block(no, b, sec) for no, b, sec in blocks]
    qs.sort(key=lambda q: q['no'])
    json.dump(qs, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with_ans = sum(1 for q in qs if q['answer'])
    with_expl = sum(1 for q in qs if q['explanation'])
    fig = sum(1 for q in qs if q['kind'] == 'figure')
    secs = {}
    for q in qs:
        secs[q['section']] = secs.get(q['section'], 0) + 1
    print(f'题目 {len(qs)} 道；有答案 {with_ans}；有解析 {with_expl}；选项是图片的 {fig}；分节 {secs}')


if __name__ == '__main__':
    main()
