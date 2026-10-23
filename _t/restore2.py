import json, os

# 把 Q22 的解析恢复成导入时的原文（刚才只是测试编辑功能，不留改动）
ORIG = ('设利民超市有公斤黄玉米，则原有玉米总重量为公斤。根据题意可列式：，解得，则该超市有公斤黄玉米。\n'
        '故正确答案为B。')
p = os.path.join(r'D:\Code\Github\shuati\data\exams',
                 '2025中国移动校园秋招试卷网友回忆版-20261020', 'exam.json')
e = json.load(open(p, encoding='utf-8'))
for q in e['questions']:
    if q['no'] == 22:
        q['explanation'] = ORIG
        q.pop('editedAt', None)
        print('已恢复 Q22 解析原文')
tmp = p + '.tmp'
json.dump(e, open(tmp, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
os.replace(tmp, p)
