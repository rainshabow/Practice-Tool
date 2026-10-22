import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, EXAMS_DIR } from '../config.mjs';
import { loadExam, saveExam } from '../lib/store.mjs';

// 清掉测试交卷记录与错题本（保留按需生成的解析）
const wbFile = path.join(DATA_DIR, 'wrongbook.json');
if (fs.existsSync(wbFile)) {
  fs.writeFileSync(wbFile, JSON.stringify({ entries: [] }, null, 2), 'utf8');
}
let clearedAttempts = 0;
for (const id of fs.readdirSync(EXAMS_DIR)) {
  const exam = loadExam(id);
  if (!exam) continue;
  if (exam.attempts?.length) {
    clearedAttempts += exam.attempts.length;
    exam.attempts = [];
    saveExam(exam);
  }
}
console.log(`清理交卷记录 ${clearedAttempts} 条，错题本已清空\n`);

// 体检
console.log('试卷'.padEnd(38) + '题数  答案  缺  图形  解析  媒体');
let tq = 0, ta = 0, tm = 0;
for (const id of fs.readdirSync(EXAMS_DIR).sort()) {
  const exam = loadExam(id);
  if (!exam) continue;
  const media = path.join(EXAMS_DIR, id, 'media');
  const mediaFiles = fs.existsSync(media) ? fs.readdirSync(media).length : 0;
  const missing = exam.questions.filter((q) => !q.answer);
  const figs = exam.questions.filter((q) => q.kind === 'figure').length;
  const expl = exam.questions.filter((q) => q.explanation).length;
  const figsMissing = exam.questions.filter((q) => q.kind === 'figure' && !(q.figures || []).length).length;
  tq += exam.questions.length;
  ta += exam.questions.length - missing.length;
  tm += mediaFiles;
  const flag = figsMissing ? ` ⚠图形缺图${figsMissing}` : '';
  console.log(
    exam.title.slice(0, 36).padEnd(38) +
    String(exam.questions.length).padStart(4) +
    String(exam.questions.length - missing.length).padStart(6) +
    String(missing.length).padStart(4) +
    String(figs).padStart(6) +
    String(expl).padStart(6) +
    String(mediaFiles).padStart(6) + flag,
  );
}
console.log(`\n合计 ${tq} 题，有答案 ${ta}，缺 ${tq - ta}，图片 ${tm} 张`);
