import json, glob, os, collections

EXAMS = r'D:\Code\Github\shuati\data\exams'
kinds = collections.Counter()
bad = []
for p in sorted(glob.glob(os.path.join(EXAMS, '*', 'exam.json'))):
    e = json.load(open(p, encoding='utf-8'))
    for q in e['questions']:
        kinds[q['kind']] += 1
        opts = q.get('options') or []
        if any((o['text'] or '').startswith('选项') for o in opts):
            bad.append((e['title'][:14], q['no'], '占位选项'))
        if q['kind'] in ('text', 'figure') and not q['stem'].strip():
            bad.append((e['title'][:14], q['no'], '题干为空'))
        if q['kind'] == 'text' and len(opts) == 0:
            bad.append((e['title'][:14], q['no'], '文本题无选项'))
print('kind 分布:', dict(kinds))
print('异常:', len(bad), bad[:5])
