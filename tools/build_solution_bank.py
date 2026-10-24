"""把 parse_page.py 的输出组装成项目可直接读取的 exam.json。"""
import json
import os
import re
import sys
from datetime import datetime, timezone

EXAMS = r'D:\Code\Github\shuati\data\exams'


def slug(title):
    t = re.sub(r'[（(][^）)]*[）)]', '', title)          # 去掉（网友回忆版）
    t = re.sub(r'[^\w\u4e00-\u9fa5-]+', '', t)
    return t


def build(year, title, items):
    qs = []
    for it in items:
        opts = [{'label': o['label'], 'text': o['text']} for o in it['options']]
        kind = it['kind']
        # 选项是图片 / 只有占位字母 / 题干本身就是一张图：都标成图片题（只读，不判分）
        texts = [o['text'].strip() for o in opts]
        placeholder = (not texts) or all(
            t == '' or t == 'ABCDEFGH'[i] for i, t in enumerate(texts))
        if placeholder or not it['stem'].strip():
            kind = 'image'
            opts = [{'label': 'ABCDEFGH'[i], 'text': ''} for i in range(max(len(opts), 4))]
        qs.append({
            'no': it['no'],
            'page': None,
            'kind': kind,
            'stem': it['stem'],
            'options': opts,
            'figures': [],
            'section': it['section'],
            'answer': it['answer'],
            'answerSource': 'fenbi',
            'explanation': it['explanation'],
            'explanationSource': 'fenbi',
            'confidence': 'high',
            'note': '',
            'marked': False,
            'keypoints': it['keypoints'],
            'analyzedAt': datetime.now(timezone.utc).isoformat(),
        })

    order, by = [], {}
    for q in qs:
        s = q['section'] or '综合知识'
        if s not in by:
            by[s] = []
            order.append(s)
        by[s].append(q['no'])

    now = datetime.now(timezone.utc).isoformat()
    return {
        'id': f"{slug(title)}-{datetime.now().strftime('%Y%m%d')}",
        'title': title,
        'createdAt': now,
        'updatedAt': now,
        'source': {'pdf': None, 'pages': None, 'from': 'fenbi-solution-page'},
        'llm': {'model': None, 'provider': 'fenbi', 'note': '题干/答案/解析均取自粉笔解析页'},
        'sections': [{'name': s, 'desc': '', 'questionNos': sorted(by[s])} for s in order],
        'stats': {
            'total': len(qs),
            'withAnswer': sum(1 for q in qs if q['answer']),
            'missingAnswer': [q['no'] for q in qs if not q['answer']],
            'highConfidence': len(qs),
            'figureCount': sum(1 for q in qs if '〔图〕' in q['stem'] or q['kind'] == 'figure'),
            'answerSource': 'fenbi',
            'officialApplied': len(qs),
            'correctedByOfficial': 0,
            'withExplanation': sum(1 for q in qs if q['explanation']),
        },
        'questions': qs,
        'officialAnswers': True,
        'attempts': [],
    }


def main():
    meta = [
        ('2025', '2025中国石油秋招试题（网友回忆版）'),
        ('2024', '2024中国石油秋招试卷（网友回忆版）'),
        ('2023', '2023中国石油秋招试卷（网友回忆版）'),
        ('2022', '2022中国石油春招试卷（网友回忆版）'),
        ('2021', '2021中国石油秋招试卷（网友回忆版）'),
        ('2020', '2020中国石油试卷（网友回忆版）'),
    ]
    total = 0
    for year, title in meta:
        src = os.path.join(r'D:\Code\Github\shuati\_cnpc', f'{year}.json')
        items = json.load(open(src, encoding='utf-8'))
        exam = build(year, title, items)
        out_dir = os.path.join(EXAMS, exam['id'])
        os.makedirs(os.path.join(out_dir, 'media'), exist_ok=True)
        with open(os.path.join(out_dir, 'exam.json'), 'w', encoding='utf-8') as fh:
            json.dump(exam, fh, ensure_ascii=False, indent=2)
        total += exam['stats']['total']
        print(f"{exam['id']}  题 {exam['stats']['total']}  答案 {exam['stats']['withAnswer']}  "
              f"解析 {exam['stats']['withExplanation']}  分节 {[s['name'] for s in exam['sections']]}")
    print(f'合计 {total} 题')


if __name__ == '__main__':
    main()
