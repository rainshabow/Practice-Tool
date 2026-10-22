/**
 * 命令行导入：不经过网页，直接把 PDF 跑成题库。
 *
 *   npm run parse -- "D:\Download\xxx.pdf"
 *   npm run parse -- "D:\Download\xxx.pdf" "自定义标题"
 *
 * 产物：data/exams/<id>/exam.json + media/*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkPython, extractPdf } from '../lib/extract.mjs';
import { buildExam } from '../lib/pipeline.mjs';
import { ensureDirs, examDir, mediaDir, uniqueId, writeJob } from '../lib/store.mjs';

const [, , pdfArg, titleArg] = process.argv;

if (!pdfArg) {
  console.error('用法: npm run parse -- <pdf路径> [标题]');
  process.exit(2);
}
const pdfPath = path.resolve(pdfArg);
if (!fs.existsSync(pdfPath)) {
  console.error(`找不到文件：${pdfPath}`);
  process.exit(2);
}

const py = await checkPython();
if (!py.ok) {
  console.error(`Python 环境不可用：${py.detail}`);
  process.exit(2);
}

const title = (titleArg || path.basename(pdfPath, '.pdf')).trim();
const id = uniqueId(title);
fs.mkdirSync(examDir(id), { recursive: true });
fs.mkdirSync(mediaDir(id), { recursive: true });
fs.copyFileSync(pdfPath, path.join(examDir(id), 'source.pdf'));

console.log(`\n[1/2] 解析 PDF：${path.basename(pdfPath)}`);
writeJob(id, { status: 'running', stage: '解析 PDF' });
const structure = await extractPdf({
  pdfPath,
  mediaDir: mediaDir(id),
  jsonPath: path.join(examDir(id), 'structure.json'),
  onLog: (l) => process.stdout.write(`      ${l}`),
});
console.log(`      切出 ${structure.questions.length} 道题`);

console.log('\n[2/2] 交给模型标注答案与解析 …');
let lastMsg = '';
const exam = await buildExam({
  id,
  title,
  structure,
  mediaDir: mediaDir(id),
  onProgress: (p) => {
    const msg = `${p.stage} ${p.done}/${p.total}`;
    if (msg !== lastMsg) {
      lastMsg = msg;
      process.stdout.write(`\r      ${msg.padEnd(40)}`);
    }
  },
});

console.log(`\n\n完成：${exam.title}`);
console.log(`  id        : ${id}`);
console.log(`  题目数    : ${exam.questions.length}`);
console.log(`  有答案    : ${exam.stats.withAnswer}`);
console.log(`  高置信    : ${exam.stats.highConfidence}`);
console.log(`  分类      : ${exam.sections.map((s) => `${s.name}(${s.questionNos.length})`).join('、')}`);
console.log(`\n启动网页：npm start\n`);
