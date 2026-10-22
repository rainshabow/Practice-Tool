import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config.mjs';
import { chat, extractJson, mapPool } from './llm.mjs';
import { loadExam, mediaDir as mediaDirOf, readJob, saveExam, writeJob } from './store.mjs';

export const SECTIONS = [
  '言语理解与表达',
  '数字推理',
  '数学运算',
  '逻辑判断',
  '类比推理',
  '图形推理',
  '空间重构',
  '常识判断',
  '企业文化与时政',
  '职业性格测评',
];

const SECTION_DESC = {
  言语理解与表达: '请根据题目要求，在四个选项中选出一个最恰当的答案。',
  数字推理: '给出数列，选择最合理的一项填补空缺。',
  数学运算: '通过计算选择正确答案。',
  逻辑判断: '根据题干逻辑关系，选择能推出或削弱的选项。',
  类比推理: '找出与题干词语关系最贴近的一组。',
  图形推理: '选择最合适的一个填入问号处，使之呈现一定的规律性。',
  空间重构: '判断立体图形与展开图之间的折叠关系。',
  常识判断: '根据常识与知识积累选择正确答案。',
  企业文化与时政: '中国移动企业文化、战略与行业时政。',
  职业性格测评: '联想 / 性格推测类题目，没有标准对错，按惯例推荐一个选项。',
};

const SYSTEM = `你是资深公考/校招笔试教研专家，负责为题库标注分类、答案与解析。
严格要求：
1. 只输出 JSON，不要 markdown 代码块，不要任何解释性开场或结尾。
2. 输出一个 JSON 数组，元素个数与输入题目数量完全一致，顺序一致。
3. 每个元素字段固定为：
   {"no": 题号数字, "section": "分类", "answer": "单个大写选项字母", "explanation": "解析", "confidence": "high|medium|low"}
4. answer 必须落在该题给出的选项字母范围内（例如只有 A-D 时不能出现 E）。
5. explanation 用中文，80~180 字：先给结论，再说明依据；错误选项要指出典型错误点。数字推理/数学运算要写清计算步骤。
6. confidence 反映你对该答案的把握：凭记忆/权威事实确定=high；推理确定=medium；存在回忆偏差或图形判断=low。
7. 题干若有〔图〕标记或选项无文字（图形题），说明题干信息不完整，此时 answer 必须基于可见信息给出最可能答案，confidence 一律为 low。`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带退避的重试 */
async function withRetry(fn, attempts = 2, label = 'LLM') {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (i < attempts) await sleep(1200 * i * i);
    }
  }
  throw new Error(`${label}失败：${lastErr?.message || '未知错误'}`);
}

function textQuestionPayload(q) {
  return {
    no: q.no,
    stem: q.stem,
    options: q.options.map((o) => `${o.label}. ${o.text || '（见图）'}`),
  };
}

function normalizeAnswer(raw, optionLabels) {
  if (raw == null) return null;
  const m = String(raw).toUpperCase().match(/[A-H]/);
  if (!m) return null;
  return optionLabels.includes(m[0]) ? m[0] : null;
}

function normalizeSection(raw, fallback = '常识判断') {
  const s = String(raw || '').trim();
  if (SECTIONS.includes(s)) return s;
  for (const name of SECTIONS) if (s.includes(name)) return name;
  return fallback;
}

function applyResult(q, item, source) {
  const labels = q.options.map((o) => o.label);
  if (item?._error) {
    q.answer = null;
    q.answerSource = 'failed';
    q.confidence = 'low';
    q.section = q.section || normalizeSection(null, q.kind === 'figure' ? '图形推理' : '常识判断');
    q.explanation = `模型没有给出可用结果：${item._error}`;
    q.analyzedAt = new Date().toISOString();
    return false;
  }
  const answer = normalizeAnswer(item?.answer, labels);
  q.answer = answer;
  q.answerSource = source;
  q.explanation = typeof item?.explanation === 'string' ? item.explanation.trim() : '';
  q.section = normalizeSection(item?.section, q.kind === 'figure' ? '图形推理' : '常识判断');
  let conf = String(item?.confidence || '').toLowerCase();
  if (!['high', 'medium', 'low'].includes(conf)) conf = answer ? 'medium' : 'low';
  q.confidence = conf;
  q.analyzedAt = new Date().toISOString();
  return Boolean(answer);
}

/* ---------------------------------------------------------------- 文本题 */

async function enrichTextBatch(batch, cfg) {
  const user = [
    `请为下面 ${batch.length} 道题标注分类、给出正确答案和解析。`,
    `可选分类（section 必须严格取其中之一）：${SECTIONS.join(' / ')}`,
    '',
    JSON.stringify(batch.map(textQuestionPayload), null, 1),
  ].join('\n');

  const res = await chat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    maxTokens: cfg.llm.maxTokens,
  });
  const arr = extractJson(res.content);
  if (!Array.isArray(arr)) throw new Error('模型未返回数组');
  if (!arr.length) throw new Error('模型返回空数组');
  return arr;
}

/**
 * 处理一组文本题。整组失败就二分重试，直到单题；
 * 单题仍失败则记下原因，而不是让整份卷子丢答案。
 */
async function enrichTextGroup(group, cfg, onEach) {
  try {
    const arr = await withRetry(() => enrichTextBatch(group, cfg), 2, '文本题标注');
    const byNo = new Map(arr.map((x) => [Number(x?.no), x]));
    for (const q of group) onEach(q, byNo.get(q.no) || { _error: '模型返回的数组里缺这道题' });
  } catch (err) {
    if (group.length > 1) {
      const mid = Math.ceil(group.length / 2);
      await enrichTextGroup(group.slice(0, mid), cfg, onEach);
      await enrichTextGroup(group.slice(mid), cfg, onEach);
      return;
    }
    onEach(group[0], { _error: err.message });
  }
}

/* ---------------------------------------------------------------- 图形题 */

async function enrichFigureQuestion(q, mediaDir, cfg) {
  const parts = [];
  for (const fig of q.figures || []) {
    for (const p of fig.parts) {
      const file = path.join(mediaDir, p.file);
      if (!fs.existsSync(file)) continue;
      parts.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${fs.readFileSync(file).toString('base64')}` },
      });
    }
  }
  if (!parts.length) throw new Error('这道图形题没有可用的配图');

  const text = [
    `这是一道图形推理/空间重构题（第 ${q.no} 题）。题干文字：${q.stem}`,
    '图片按顺序给出：先是题干图形，后是 A、B、C、D 四个选项。',
    '请判断正确答案，并输出一个 JSON 对象（不要数组、不要代码块）：',
    `{"no": ${q.no}, "section": "图形推理或空间重构", "answer": "A", "explanation": "解析", "confidence": "low"}`,
    '解析要描述你观察到的图形规律（数量、位置、样式、叠加、对称、折叠方向等），控制在 120 字以内。',
    '注意：先想清楚就尽快给结论，不要把预算花在反复自我质疑上。',
  ].join('\n');

  const res = await chat({
    model: cfg.llm.visionModel,
    messages: [{ role: 'user', content: [{ type: 'text', text }, ...parts] }],
    // 空间重构题要在大脑里转立方体，思考很长；额度给小了会"想满却一句话没说"
    maxTokens: Math.max(cfg.llm.maxTokens, 32768),
  });
  const obj = extractJson(res.content);
  const first = Array.isArray(obj) ? obj[0] : obj;
  if (!first) throw new Error('视觉模型没有给出结果');
  first.confidence = 'low'; // 图形题一律低置信，交给人工复核
  return first;
}

/* ---------------------------------------------------------------- 主流程 */

function groupSections(questions) {
  const bySection = new Map();
  for (const q of questions) {
    if (!q.section) q.section = q.kind === 'figure' ? '图形推理' : '常识判断';
    if (!bySection.has(q.section)) bySection.set(q.section, []);
    bySection.get(q.section).push(q.no);
  }
  const order = [...SECTIONS, ...[...bySection.keys()].filter((s) => !SECTIONS.includes(s))];
  return order
    .filter((name) => bySection.has(name))
    .map((name) => ({
      name,
      desc: SECTION_DESC[name] || '',
      questionNos: bySection.get(name).sort((a, b) => a - b),
    }));
}

function finalizeStats(exam) {
  const withAnswer = exam.questions.filter((q) => q.answer).length;
  exam.stats = {
    total: exam.questions.length,
    withAnswer,
    missingAnswer: exam.questions.filter((q) => !q.answer).map((q) => q.no),
    highConfidence: exam.questions.filter((q) => q.confidence === 'high').length,
    figureCount: exam.questions.filter((q) => q.kind === 'figure').length,
  };
  exam.sections = groupSections(exam.questions);
  return exam;
}

export async function buildExam({ id, title, structure, mediaDir, onProgress }) {
  const cfg = getConfig();
  const questions = structure.questions.map((q) => ({
    no: q.no,
    page: q.page,
    kind: q.kind,
    stem: q.stem,
    options: q.options,
    figures: q.figures || [],
    section: null,
    answer: null,
    answerSource: null,
    explanation: '',
    confidence: null,
    note: '',
    marked: false,
  }));

  const figureQs = questions.filter((q) => q.kind === 'figure');
  const textQs = questions.filter((q) => q.kind !== 'figure');
  const total = questions.length;
  let done = 0;
  const bump = (stage, extra = {}) => {
    writeJob(id, { stage, done, total, ...extra });
    onProgress?.({ stage, done, total, ...extra });
  };

  bump('标注文本题', { message: `共 ${total} 题：文本 ${textQs.length}、图形 ${figureQs.length}` });

  const batches = [];
  for (let i = 0; i < textQs.length; i += cfg.llm.batchSize) {
    batches.push(textQs.slice(i, i + cfg.llm.batchSize));
  }
  const batchResults = await mapPool(batches, async (batch) => {
    await enrichTextGroup(batch, cfg, (q, item) => {
      applyResult(q, item, 'llm');
      done++;
      bump('标注文本题');
    });
  }, cfg.llm.concurrency);
  const failedBatches = batchResults.filter((r) => !r.ok).length;

  bump('分析图形题', { message: `${figureQs.length} 道图形题交给视觉模型` });
  await mapPool(figureQs, async (q) => {
    try {
      const item = await withRetry(() => enrichFigureQuestion(q, mediaDir, cfg), 2, '图形题判读');
      applyResult(q, item, 'vision');
    } catch (err) {
      applyResult(q, { _error: err.message }, 'vision');
    }
    done++;
    bump('分析图形题');
  }, Math.max(1, Math.min(cfg.llm.concurrency, 2)));

  // 全卷一次性重判分类，避免分批推理各说各话
  bump('统一分类', { message: '正在对整份卷子做一次一致的题型划分' });
  try {
    const map = await withRetry(() => classifyAll(questions, cfg), 2, '全卷分类');
    for (const q of questions) {
      const s = map.get(q.no);
      if (s) q.section = s;
    }
    smoothSections(questions);
  } catch (err) {
    bump('统一分类', { message: `分类一致化失败（不影响答案）：${err.message}` });
  }

  const exam = finalizeStats({
    id,
    title,
    createdAt: new Date().toISOString(),
    source: { pdf: structure.meta.pdf, pages: structure.meta.pages },
    llm: { model: cfg.llm.model, visionModel: cfg.llm.visionModel, baseUrl: cfg.llm.baseUrl },
    sections: [],
    stats: null,
    questions,
  });
  saveExam(exam);

  const missing = exam.stats.missingAnswer.length;
  const summary = `完成：${total} 题，已给出答案 ${exam.stats.withAnswer} 道` +
    (missing ? `，${missing} 道待补全` : '');
  writeJob(id, { status: 'ready', stage: '完成', done: total, total, message: summary });
  return exam;
}

/* -------------------------------------------------- 按标准答案重写解析 */

const EXAMINE_SYSTEM = `你是资深公考/校招笔试教研专家。
题目已经给出**标准答案**，你的任务是写出与标准答案一致的解析。
严格要求：
1. 只输出 JSON，不要 markdown 代码块，不要开场白。
2. 输出 JSON 数组，元素个数与输入一致，顺序一致。
3. 每个元素字段固定为：{"no": 题号数字, "explanation": "解析"}
4. 解析必须论证**标准答案**为什么对，并点出其他选项的典型错误；绝不能论证别的选项。
5. 中文 80~180 字，数字题写清计算步骤。`;

/**
 * 按已确认的标准答案重写解析。
 * 场景：模型原来答错了，它的解析会为错答案辩护，必须按官方答案重写才不会自相矛盾。
 */
export async function explainWithOfficialAnswers(exam, numbers, { onProgress } = {}) {
  const cfg = getConfig();
  const targets = exam.questions.filter((q) => numbers.includes(q.no) && q.answer);
  if (!targets.length) return 0;

  let done = 0;
  const batches = [];
  for (let i = 0; i < targets.length; i += cfg.llm.batchSize) {
    batches.push(targets.slice(i, i + cfg.llm.batchSize));
  }

  await mapPool(batches, async (batch) => {
    const list = batch.map((q) => ({
      no: q.no,
      stem: q.stem,
      options: q.options.map((o) => `${o.label}. ${o.text || '（见图）'}`),
      officialAnswer: q.answer,
    }));
    try {
      const res = await chat({
        messages: [
          { role: 'system', content: EXAMINE_SYSTEM },
          { role: 'user', content: `请为下面 ${list.length} 道题写解析：\n\n${JSON.stringify(list)}` },
        ],
        maxTokens: cfg.llm.maxTokens,
      });
      const arr = extractJson(res.content);
      const byNo = new Map(arr.map((x) => [Number(x?.no), x]));
      for (const q of batch) {
        const item = byNo.get(q.no);
        const text = typeof item?.explanation === 'string' ? item.explanation.trim() : '';
        if (text) {
          q.explanation = text;
          q.explanationSource = 'model-from-official';
        }
        done++;
        onProgress?.({ done, total: targets.length });
      }
    } catch (err) {
      writeJob(exam.id, { message: `重写解析失败一批：${err.message}` });
      for (const q of batch) done++;
    }
  }, cfg.llm.concurrency);

  saveExam(exam);
  return done;
}

/** 单题重做（网页上的「重新解析」按钮） */
export async function reanalyzeQuestion(exam, no) {  const cfg = getConfig();
  const q = exam.questions.find((x) => x.no === Number(no));
  if (!q) throw new Error(`没有第 ${no} 题`);
  if (q.kind === 'figure') {
    const item = await withRetry(
      () => enrichFigureQuestion(q, mediaDirOf(exam.id), cfg), 2, '图形题判读',
    );
    applyResult(q, item, 'vision');
  } else {
    let result = null;
    await enrichTextGroup([q], cfg, (_q, item) => { result = item; });
    applyResult(q, result || { _error: '模型没有返回结果' }, 'llm');
  }
  finalizeStats(exam);
  saveExam(exam);
  return q;
}

/* ------------------------------------------------------------ 分类一致化 */

/**
 * 一次性把整份卷子重新分类。
 *
 * 分批标注时每批看不到别的题，分类容易各说各话；逐题重判又会在边界上来回摇摆。
 * 所以这里直接让模型给"分节区间"（from/to），天然连续、不重不漏，
 * 比让它逐题贴标签稳得多。
 */
async function classifyAll(questions, cfg) {
  const list = questions.map((q) => ({
    no: q.no,
    stem: q.stem.replace(/\s+/g, ' ').slice(0, 70),
    kind: q.kind === 'figure' ? '图形题' : '文字题',
  }));
  const last = questions[questions.length - 1].no;
  const user = [
    `下面是一整份试卷的 ${list.length} 道题（题干已截断，题干顺序就是卷面顺序）。`,
    '试卷的题型是按题号顺序分节的，请给出分节方案。',
    `section 必须严格取其中之一：${SECTIONS.join(' / ')}`,
    `要求：从 1 到 ${last} 连续覆盖，不重叠、不留空；每一节至少 3 道题。`,
    '只输出 JSON 数组，形如：',
    '[{"section":"言语理解与表达","from":1,"to":10},{"section":"数字推理","from":11,"to":20}]',
    '',
    JSON.stringify(list),
  ].join('\n');

  const res = await chat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    maxTokens: cfg.llm.maxTokens,
  });
  const arr = extractJson(res.content);
  if (!Array.isArray(arr)) throw new Error('分类结果不是数组');

  // 按 from 排序后铺成逐题映射；区间有缝就用前一节补上，保证每题都有归属
  const segs = arr
    .map((s) => ({
      name: normalizeSection(s?.section, ''),
      from: Number(s?.from ?? s?.start),
      to: Number(s?.to ?? s?.end),
    }))
    .filter((s) => s.name && Number.isFinite(s.from) && Number.isFinite(s.to) && s.to >= s.from)
    .sort((a, b) => a.from - b.from);
  if (!segs.length) throw new Error('没有解析出任何分节');

  const map = new Map();
  let cursor = 1;
  for (const seg of segs) {
    while (cursor < seg.from) {
      map.set(cursor, map.get(cursor - 1) || seg.name);
      cursor++;
    }
    for (let n = seg.from; n <= seg.to; n++) map.set(n, seg.name);
    cursor = Math.max(cursor, seg.to + 1);
  }
  for (let n = cursor; n <= last; n++) map.set(n, map.get(n - 1) || segs[segs.length - 1].name);
  return map;
}

/** 把孤立的单题分节并到相邻节，避免答题卡里出现零散的分类碎片 */
function smoothSections(questions) {
  const labels = questions.map((q) => q.section);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    let i = 0;
    while (i < labels.length) {
      let j = i;
      while (j + 1 < labels.length && labels[j + 1] === labels[i]) j++;
      const len = j - i + 1;
      const prev = i > 0 ? labels[i - 1] : null;
      const next = j + 1 < labels.length ? labels[j + 1] : null;
      if (len <= 2 && prev && next && prev === next && prev !== labels[i]) {
        for (let k = i; k <= j; k++) labels[k] = prev;
        changed = true;
      }
      i = j + 1;
    }
    if (!changed) break;
  }
  questions.forEach((q, i) => { q.section = labels[i]; });
}

/** 重新分类整份卷子并落盘 */
export async function reclassifyExam(id) {
  const cfg = getConfig();
  const exam = loadExam(id);
  if (!exam) throw new Error('题集不存在');
  try {
    const map = await withRetry(() => classifyAll(exam.questions, cfg), 2, '全卷分类');
    for (const q of exam.questions) {
      const s = map.get(q.no);
      if (s) q.section = s;
      else if (!q.section) q.section = q.kind === 'figure' ? '图形推理' : '常识判断';
    }
    smoothSections(exam.questions);
  } catch (err) {
    // 分类失败不影响答案，保持原样即可
    writeJob(id, { message: `分类一致化失败（不影响答案）：${err.message}` });
  }
  finalizeStats(exam);
  saveExam(exam);
  return exam;
}

/** 补全答案：把所有没有答案的题单独重跑一遍 */
export async function repairExam(id, { onProgress } = {}) {  const cfg = getConfig();
  const exam = loadExam(id);
  if (!exam) throw new Error('题集不存在');
  const todo = exam.questions.filter((q) => !q.answer);
  const media = mediaDirOf(id);
  let done = 0;
  const bump = () => {
    writeJob(id, { status: 'running', stage: '补全答案', done, total: todo.length, message: `剩余 ${todo.length - done} 道` });
    onProgress?.({ done, total: todo.length });
  };
  bump();

  await mapPool(todo, async (q) => {
    // 补全只补答案：题型分类是全卷一次性判定的，单题重跑会把它改漂
    const keepSection = q.section;
    try {
      if (q.kind === 'figure') {
        const item = await withRetry(() => enrichFigureQuestion(q, media, cfg), 2, '图形题判读');
        applyResult(q, item, 'vision');
      } else {
        let result = null;
        await enrichTextGroup([q], cfg, (_q, item) => { result = item; });
        applyResult(q, result || { _error: '模型没有返回结果' }, 'llm');
      }
    } catch (err) {
      applyResult(q, { _error: err.message }, q.kind === 'figure' ? 'vision' : 'llm');
    }
    if (keepSection) q.section = keepSection;
    done++;
    bump();
  }, Math.max(1, Math.min(cfg.llm.concurrency, 3)));

  finalizeStats(exam);
  saveExam(exam);
  const missing = exam.stats.missingAnswer.length;
  writeJob(id, {
    status: 'ready', stage: '补全完成', done: exam.questions.length,
    total: exam.questions.length,
    message: missing ? `仍有 ${missing} 道题没拿到答案` : '全部题目都有答案了',
  });
  return exam;
}

export { readJob };
