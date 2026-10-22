/**
 * 从粉笔「解析版 PDF」直接建题库（题目 + 标准答案一起抽）。
 *
 * 这类 PDF 是「做题后点下载」得到的，每道题后面带「正确答案： X」，
 * 所以不需要模型猜答案。解析文字默认不生成（1000+ 题太贵），
 * 界面上可以逐题点「生成解析」按需补。
 *
 *   node server/cli/import-solution.mjs "<solution.pdf>" [--explain] [--title "xxx"]
 */
import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from '../lib/extract.mjs';
import {
  examDir, mediaDir, saveExam, uniqueId, writeJob, loadExam,
} from '../lib/store.mjs';
import { explainWithOfficialAnswers, reclassifyExam } from '../lib/pipeline.mjs';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const pdfArg = positional[0];
const titleFlagIdx = argv.indexOf('--title');
const titleFlag = titleFlagIdx >= 0 ? argv[titleFlagIdx + 1] : null;

if (!pdfArg) {
  console.error('用法: node server/cli/import-solution.mjs "<solution.pdf>" [--explain] [--title ""]');
  process.exit(2);
}
const pdfPath = path.resolve(pdfArg);
if (!fs.existsSync(pdfPath)) {
  console.error(`找不到文件：${pdfPath}`);
  process.exit(2);
}

const title = (titleFlag || path.basename(pdfPath, '.pdf')).trim();
const id = uniqueId(title);
const dir = examDir(id);
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(mediaDir(id), { recursive: true });
fs.copyFileSync(pdfPath, path.join(dir, 'solution.pdf'));

console.log(`\n[${title}]`);
writeJob(id, { status: 'running', stage: '解析解析版 PDF', title });
const structure = await extractPdf({
  pdfPath,
  mediaDir: mediaDir(id),
  jsonPath: path.join(dir, 'structure.json'),
  onLog: () => {},
});

const withAnswer = structure.questions.filter((q) => q.answer).length;
console.log(`  切题 ${structure.questions.length} 道，带答案 ${withAnswer} 道`);

const questions = structure.questions.map((q) => ({
  no: q.no,
  page: q.page,
  kind: q.kind,
  stem: q.stem,
  options: q.options,
  figures: q.figures || [],
  section: null,
  answer: q.answer || null,
  answerSource: q.answer ? 'fenbi' : null,
  confidence: q.answer ? 'high' : null,
  explanation: '',
  explanationSource: null,
  note: '',
  marked: false,
}));

const exam = {
  id,
  title,
  createdAt: new Date().toISOString(),
  source: { pdf: structure.meta.pdf, pages: structure.meta.pages },
  sections: [],
  stats: null,
  officialAnswers: {
    importedAt: new Date().toISOString(),
    source: 'fenbi 解析版 PDF（做题后下载）',
    pdf: 'solution.pdf',
    applied: withAnswer,
  },
  questions,
};
saveExam(exam);

console.log('  划分题型 …');
writeJob(id, { status: 'running', stage: '划分题型', title });
await reclassifyExam(id);

if (flags.has('--explain')) {
  const nos = exam.questions.map((q) => q.no);
  console.log(`  生成 ${nos.length} 道题的解析 …`);
  writeJob(id, { status: 'running', stage: '生成解析', title });
  let last = 0;
  await explainWithOfficialAnswers(loadExam(id), nos, {
    onProgress: ({ done, total }) => {
      if (done !== last) {
        last = done;
        process.stdout.write(`\r    ${done}/${total}   `);
      }
    },
  });
  console.log('');
}

const final = loadExam(id);
writeJob(id, {
  status: 'ready',
  stage: '完成',
  done: final.questions.length,
  total: final.questions.length,
  message: `${final.questions.length} 题，答案 ${final.stats.withAnswer} 道`,
  title,
});

console.log(`  id=${id}`);
console.log(`  分节：${final.sections.map((s) => `${s.name}(${s.questionNos.length})`).join('、')}`);
console.log(`  缺答案：${final.stats.missingAnswer.length ? final.stats.missingAnswer.join(',') : '无'}\n`);
