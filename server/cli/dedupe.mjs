import fs from 'node:fs';
import path from 'node:path';
import { EXAMS_DIR } from '../config.mjs';
import { loadExam, saveExam } from '../lib/store.mjs';

const dirs = fs.readdirSync(EXAMS_DIR).filter((d) => /-\d+$/.test(d));
console.log('待合并的重复库：', dirs);

for (const dup of dirs) {
  const clean = dup.replace(/-\d+$/, '');
  const cleanDir = path.join(EXAMS_DIR, clean);
  const dupDir = path.join(EXAMS_DIR, dup);
  if (!fs.existsSync(cleanDir)) {
    console.log(`  跳过（无原库）：${dup}`);
    continue;
  }
  const a = loadExam(clean);
  const b = loadExam(dup);
  const ansA = a.questions.filter((q) => q.answer).length;
  const ansB = b.questions.filter((q) => q.answer).length;
  console.log(`  ${clean}: 旧 ${ansA}/${a.questions.length}  新 ${ansB}/${b.questions.length}`);

  if (ansB < ansA) {
    console.log('    新库不全，保留旧库，删除重复');
    fs.rmSync(dupDir, { recursive: true, force: true });
    continue;
  }
  // 用新库替换旧库：把 media 换到干净目录名下
  const media = path.join(dupDir, 'media');
  fs.rmSync(cleanDir, { recursive: true, force: true });
  fs.renameSync(dupDir, cleanDir);
  const exam = loadExam(clean);
  exam.id = clean;
  saveExam(exam);
  console.log(`    已用新库替换，id 归一为 ${clean}（media=${fs.existsSync(path.join(cleanDir, 'media')) ? 'ok' : 'missing'}）`);
}

const left = fs.readdirSync(EXAMS_DIR);
console.log(`\n剩余题库 ${left.length} 个`);
