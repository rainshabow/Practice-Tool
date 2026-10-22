/**
 * 按标准答案重写指定题目的解析。
 *
 *   npm run re-explain -- <examId> 10,51,52
 *   npm run re-explain -- <examId>          # 自动取题库里记录的被修正题目
 */
import { loadExam } from '../lib/store.mjs';
import { explainWithOfficialAnswers } from '../lib/pipeline.mjs';

const [, , examId, listArg] = process.argv;
if (!examId) {
  console.error('用法: npm run re-explain -- <examId> [题号,逗号分隔]');
  process.exit(2);
}

const exam = loadExam(examId);
if (!exam) {
  console.error(`找不到题库：${examId}`);
  process.exit(2);
}

let numbers = listArg
  ? listArg.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n))
  : (exam.officialAnswers?.correctedNos || []);

if (!numbers.length) {
  console.log('没有指定题号，题库里也没有记录被修正的题目。');
  process.exit(0);
}

console.log(`[重写解析] ${exam.title}，共 ${numbers.length} 题：${numbers.join(',')}`);
let last = 0;
const n = await explainWithOfficialAnswers(exam, numbers, {
  onProgress: ({ done, total }) => {
    if (done !== last) {
      last = done;
      process.stdout.write(`\r   ${done}/${total}   `);
    }
  },
});
console.log(`\n完成：重写 ${n} 题解析。\n`);
