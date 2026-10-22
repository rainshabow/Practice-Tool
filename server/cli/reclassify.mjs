/**
 * 重新给整份卷子做一次一致的题型分类。
 *
 *   npm run reclassify                 # 所有题库
 *   npm run reclassify -- <examId>     # 只处理某一个
 */
import { listExams } from '../lib/store.mjs';
import { reclassifyExam } from '../lib/pipeline.mjs';

const [, , onlyId] = process.argv;
const targets = onlyId ? [onlyId] : listExams().map((e) => e.id);

if (!targets.length) {
  console.log('还没有题库。');
  process.exit(0);
}

for (const id of targets) {
  console.log(`\n[分类] ${id}`);
  const exam = await reclassifyExam(id);
  console.log('       分节：' + exam.sections.map((s) => `${s.name}(${s.questionNos.length})`).join('、'));
}
console.log('\n完成。');
