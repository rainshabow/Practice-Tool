/**
 * 把粉笔解析页导出的标准答案合并进题库。
 *
 * 流程：
 *   1. 在粉笔解析页右上角点「下载」，得到解析版 PDF；
 *   2. python tools/parse_solution_pdf.py <solution.pdf> answers.json
 *   3. npm run answers -- <examId> answers.json
 *
 * 合并后题目的 answerSource 变为 fenbi、confidence 为 high；
 * 解析文字仍是模型写的（标注 explanationSource:'model'），
 * 因为解析 PDF 里只有答案，没有讲解。
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadExam, saveExam, examDir } from '../lib/store.mjs';
import { SECTIONS, explainWithOfficialAnswers } from '../lib/pipeline.mjs';

const argv = process.argv.slice(2);
const reexplain = argv.includes('--reexplain');
const [examIdArg, answersArg, solutionPdfArg] = argv.filter((a) => !a.startsWith('--'));

if (!examIdArg || !answersArg) {
  console.error('用法: npm run answers -- <examId> <answers.json> [solution.pdf]');
  process.exit(2);
}

const exam = loadExam(examIdArg);
if (!exam) {
  console.error(`找不到题库：${examIdArg}`);
  process.exit(2);
}
if (!fs.existsSync(answersArg)) {
  console.error(`找不到答案文件：${answersArg}`);
  process.exit(2);
}

const payload = JSON.parse(fs.readFileSync(answersArg, 'utf8'));
const answers = payload.answers || payload;
const letters = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);

let applied = 0;
let corrected = 0;
let invalid = 0;
const missingInFile = [];
const diffs = [];

for (const q of exam.questions) {
  const official = String(answers[q.no] ?? answers[String(q.no)] ?? '').trim().toUpperCase();
  if (!official) {
    missingInFile.push(q.no);
    continue;
  }
  if (!letters.has(official)) {
    invalid++;
    continue;
  }
  const labels = q.options.map((o) => o.label);
  if (labels.length && !labels.includes(official)) {
    invalid++;
    continue;
  }
  if (q.answer && q.answer !== official) {
    diffs.push({ no: q.no, before: q.answer, after: official, kind: q.kind });
    corrected++;
  }
  q.answer = official;
  q.answerSource = 'fenbi';
  q.confidence = 'high';
  q.explanationSource = q.explanation ? 'model' : null;
  applied++;
}

exam.stats = {
  ...(exam.stats || {}),
  total: exam.questions.length,
  withAnswer: exam.questions.filter((q) => q.answer).length,
  missingAnswer: exam.questions.filter((q) => !q.answer).map((q) => q.no),
  highConfidence: exam.questions.filter((q) => q.confidence === 'high').length,
  figureCount: exam.questions.filter((q) => q.kind === 'figure').length,
  answerSource: 'fenbi',
  officialApplied: applied,
  correctedByOfficial: corrected,
};

exam.officialAnswers = {
  importedAt: new Date().toISOString(),
  file: path.basename(answersArg),
  applied,
  corrected,
  correctedNos: diffs.map((d) => d.no),
  source: 'fenbi: /ti/exam/solution/1_26u_20ir0h5',
};

// 顺手把解析版 PDF 存进题库目录，留个出处
if (solutionPdfArg && fs.existsSync(solutionPdfArg)) {
  const dest = path.join(examDir(exam.id), 'solution.pdf');
  fs.copyFileSync(solutionPdfArg, dest);
  exam.officialAnswers.pdf = path.basename(dest);
}

saveExam(exam);

if (reexplain && corrected > 0) {
  console.log(`\n  按标准答案重写 ${corrected} 道题的解析 …`);
  let last = 0;
  await explainWithOfficialAnswers(exam, diffs.map((d) => d.no), {
    onProgress: ({ done, total }) => {
      if (done !== last) {
        last = done;
        process.stdout.write(`\r      ${done}/${total}      `);
      }
    },
  });
  console.log('');
}

console.log(`\n题库：${exam.title}`);
console.log(`  应用官方答案 : ${applied}/${exam.questions.length}`);
console.log(`  修正模型答案 : ${corrected}`);
if (invalid) console.log(`  格式非法被跳过 : ${invalid}`);
if (missingInFile.length) console.log(`  答案文件里缺 : ${missingInFile.join(', ')}`);

if (diffs.length) {
  console.log('\n  被修正的题目：');
  for (const d of diffs) {
    console.log(`    Q${String(d.no).padEnd(3)} ${d.before} -> ${d.after}   (${d.kind === 'figure' ? '图形' : '文本'})`);
  }
}

const sections = new Map();
for (const q of exam.questions) {
  const s = SECTIONS.includes(q.section) ? q.section : q.section || '未分类';
  sections.set(s, (sections.get(s) || 0) + 1);
}
console.log('\n  分节：' + [...sections].map(([k, v]) => `${k}(${v})`).join('、'));
console.log('');
