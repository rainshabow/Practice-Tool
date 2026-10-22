/**
 * 补全答案：把题库里没有答案的题单独重跑一遍。
 *
 *   npm run repair                 # 补全所有题库
 *   npm run repair -- <examId>     # 只补全某一个
 */
import { listExams, loadExam, writeJob } from '../lib/store.mjs';
import { repairExam } from '../lib/pipeline.mjs';

const [, , onlyId] = process.argv;

const targets = onlyId
  ? [onlyId]
  : listExams()
    .filter((e) => (e.answeredCount || 0) < (e.questionCount || 0))
    .map((e) => e.id);

if (!targets.length) {
  console.log('没有需要补全的题库。');
  process.exit(0);
}

for (const id of targets) {
  const exam = loadExam(id);
  if (!exam) {
    console.error(`跳过：找不到题库 ${id}`);
    continue;
  }
  const missing = exam.questions.filter((q) => !q.answer).length;
  console.log(`\n[补全] ${exam.title}（缺 ${missing} 题）`);
  writeJob(id, { status: 'running', stage: '补全答案' });
  const after = await repairExam(id, {
    onProgress: ({ done, total }) => {
      process.stdout.write(`\r        ${done}/${total}        `);
    },
  });
  const still = after.stats.missingAnswer.length;
  console.log(`\n        完成：有答案 ${after.stats.withAnswer}/${after.questions.length}` +
    (still ? `，仍有 ${still} 题缺答案：${after.stats.missingAnswer.join(',')}` : '，全部齐全'));
}
console.log('\n完成。');
