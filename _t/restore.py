import json, os

p = os.path.join(r'D:\Code\Github\shuati\data\exams',
                 '2025中国移动校园秋招试卷网友回忆版-20261020', 'exam.json')
e = json.load(open(p, encoding='utf-8'))
for q in e['questions']:
    if q['no'] == 22:
        q['keypoints'] = ['和差倍比问题']
        q['answerSource'] = 'fenbi'
        q.pop('editedAt', None)
        print('恢复 Q22:', q['answer'], q['answerSource'], q['keypoints'])
tmp = p + '.tmp'
json.dump(e, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
os.replace(tmp, p)
