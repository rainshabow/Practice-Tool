import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, EXAMS_DIR, publicConfig, resolveApiKey, saveSettings } from './config.mjs';
import { checkPython, extractPdf } from './lib/extract.mjs';
import { buildExam, explainWithOfficialAnswers, repairExam, reanalyzeQuestion, reclassifyExam } from './lib/pipeline.mjs';
import {
  addWrong, clearMastered, listWrong, markMastered, removeEntry, setMastered, wrongSummary,
} from './lib/wrongbook.mjs';
import {
  countByExam, getProgress, practicedKeySet, progressSummary, recordMany, recordProgress, resetProgress,
} from './lib/progress.mjs';

/** 答案比较：支持多选（"AD" 视为集合），顺序无关 */
function sameAnswer(a, b) {
  if (!a || !b) return false;
  const canon = (s) => [...String(s).toUpperCase().replace(/[^A-H]/g, '')].sort().join('');
  return canon(a) === canon(b);
}
import { resetApiKeyCache } from './lib/llm.mjs';
import {
  deleteExam, ensureDirs, examDir, examFile, listExams, loadExam, mediaDir,
  readJob, saveExam, uniqueId, writeJob, writeJson,
} from './lib/store.mjs';

export const api = express.Router();

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

/** 正在跑的导入任务，避免重复启动 */
const running = new Map();

api.get('/health', async (_req, res) => {
  const py = await checkPython();
  res.json({ ok: py.ok, python: py, config: await configWithKeyState() });
});

/** 把"实际能拿到的密钥"反映到对外配置里（只给掩码） */
async function configWithKeyState() {
  const cfg = publicConfig();
  const key = await resolveApiKey();
  cfg.llm.hasApiKey = Boolean(key);
  cfg.llm.apiKeyHint = key ? `${key.slice(0, 8)}…${key.slice(-4)}` : '';
  return cfg;
}

api.get('/config', async (_req, res) => res.json(await configWithKeyState()));

api.post('/config', async (req, res) => {
  const { baseUrl, model, visionModel, apiKey } = req.body || {};
  const patch = {};
  if (typeof baseUrl === 'string' && baseUrl.trim()) patch.llmBaseUrl = baseUrl.trim();
  if (typeof model === 'string' && model.trim()) patch.llmModel = model.trim();
  if (typeof visionModel === 'string' && visionModel.trim()) patch.llmVisionModel = visionModel.trim();
  if (typeof apiKey === 'string' && apiKey.trim()) patch.llmApiKey = apiKey.trim();
  saveSettings(patch);
  resetApiKeyCache();
  res.json(await configWithKeyState());
});

api.get('/exams', (_req, res) => res.json({ exams: listExams() }));

api.get('/exams/:id', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  res.json(exam);
});

api.get('/exams/:id/job', (req, res) => {
  res.json(readJob(req.params.id) || { status: 'unknown' });
});

api.delete('/exams/:id', (req, res) => {
  try {
    deleteExam(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** 上传 PDF（raw body），后台跑解析流水线 */
api.post('/exams', express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '80mb' }),
  async (req, res) => {
    if (!req.body || !req.body.length) return res.status(400).json({ error: '没有收到 PDF 内容' });
    const py = await checkPython();
    if (!py.ok) return res.status(400).json({ error: py.detail });

    ensureDirs();
    const rawName = decodeURIComponent(req.get('X-Filename') || '');
    const title = (req.query.title || path.basename(rawName, '.pdf') || '未命名题库').toString().trim();
    const id = uniqueId(title);

    fs.mkdirSync(examDir(id), { recursive: true });
    fs.mkdirSync(mediaDir(id), { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const pdfPath = path.join(examDir(id), 'source.pdf');
    fs.writeFileSync(pdfPath, req.body);

    res.status(202).json({ id, title });

    if (running.has(id)) return;
    running.set(id, true);
    runImport({ id, title, pdfPath }).finally(() => running.delete(id));
  });

async function runImport({ id, title, pdfPath }) {
  const media = mediaDir(id);
  const jsonPath = path.join(examDir(id), 'structure.json');
  try {
    const report = (stage, extra = {}) => writeJob(id, { status: 'running', stage, title, ...extra });
    report('解析 PDF');
    const structure = await extractPdf({
      pdfPath,
      mediaDir: media,
      jsonPath,
      onLog: (line) => {
        const t = String(line).trim();
        if (t) writeJob(id, { status: 'running', message: t.slice(0, 300) });
      },
    });
    if (!structure.questions?.length) throw new Error('没能从 PDF 里切出任何题目');
    report('交给模型分析', { done: 0, total: structure.questions.length });
    await buildExam({
      id, title, structure, mediaDir: media,
      onProgress: (p) => writeJob(id, { status: 'running', ...p }),
    });
  } catch (err) {
    console.error(`[import ${id}]`, err);
    try {
      writeJob(id, { status: 'error', stage: '失败', message: err?.message || String(err) });
    } catch (writeErr) {
      // 写进度失败也不能让整个进程挂掉
      console.error(`[import ${id}] 写入失败状态时出错`, writeErr);
    }
  }
}

/** 覆盖答案 / 笔记 / 标记 */
api.patch('/exams/:id/questions/:no', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const q = exam.questions.find((x) => x.no === Number(req.params.no));
  if (!q) return res.status(404).json({ error: '题目不存在' });
  const { answer, explanation, note, marked, section } = req.body || {};
  if (answer !== undefined) {
    const labels = q.options.map((o) => o.label);
    if (answer === null || answer === '') {
      q.answer = null;
      q.answerSource = null;
    } else if (labels.includes(String(answer).toUpperCase())) {
      q.answer = String(answer).toUpperCase();
      q.answerSource = 'manual';
      q.confidence = 'high';
    } else {
      return res.status(400).json({ error: `答案必须是 ${labels.join('/')} 之一` });
    }
  }
  if (explanation !== undefined) q.explanation = String(explanation);
  if (note !== undefined) q.note = String(note);
  if (marked !== undefined) q.marked = Boolean(marked);
  if (section !== undefined) q.section = String(section);
  saveExam(exam);
  res.json(q);
});

api.post('/exams/:id/questions/:no/reanalyze', async (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  try {
    const q = await reanalyzeQuestion(exam, req.params.no);
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 补全答案：把所有缺答案的题单独重跑（后台执行，进度写 job） */
api.post('/exams/:id/repair', async (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  if (running.has(`repair:${exam.id}`)) return res.status(409).json({ error: '已经在补全中' });
  const missing = exam.questions.filter((q) => !q.answer).length;
  if (!missing) return res.json({ ok: true, missing: 0 });

  running.set(`repair:${exam.id}`, true);
  res.status(202).json({ ok: true, missing });
  repairExam(exam.id)
    .catch((err) => writeJob(exam.id, { status: 'error', stage: '补全失败', message: err.message }))
    .finally(() => running.delete(`repair:${exam.id}`));
});

/** 重新给整份卷子做一次一致的题型分类 */
api.post('/exams/:id/reclassify', async (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  try {
    const updated = await reclassifyExam(exam.id);
    res.json({ sections: updated.sections, questions: updated.questions.map((q) => ({ no: q.no, section: q.section })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 记录一次作答。
 * scope 为空表示整卷；给定题号集合则只统计这些题（冲刺分段、中止续做都走这里）。
 * 留空的题：不计对错、不进错题本。
 */
function recordAttempt(exam, { answers, durationMs, pausedMs, questionNos, mode }) {
  const scope = Array.isArray(questionNos) && questionNos.length
    ? new Set(questionNos.map(Number))
    : null;
  const target = scope ? exam.questions.filter((q) => scope.has(q.no)) : exam.questions;

  let correct = 0;
  let wrong = 0;
  let blank = 0;
  const detail = [];
  for (const q of target) {
    const picked = answers[q.no] || null;
    let verdict = 'blank';
    if (!picked) blank++;
    else if (!q.answer) { /* 无标准答案，计为待定 */ }
    else if (sameAnswer(picked, q.answer)) {
      correct++;
      verdict = 'correct';
      markMastered(exam.id, q.no);
      recordProgress(exam.id, q.no, { correct: true, source: mode === 'sprint' ? 'sprint' : 'exam' });
    } else {
      wrong++;
      verdict = 'wrong';
      addWrong(exam.id, q.no, { picked, answer: q.answer });
      recordProgress(exam.id, q.no, { correct: false, source: mode === 'sprint' ? 'sprint' : 'exam' });
    }
    detail.push({ no: q.no, picked, answer: q.answer, verdict });
  }

  const total = target.length;
  const attempt = {
    id: `a${Date.now()}`,
    at: new Date().toISOString(),
    durationMs: Number(durationMs) || 0,
    pausedMs: Number(pausedMs) || 0,
    mode: mode || 'full',
    partial: Boolean(scope),
    questionNos: target.map((q) => q.no).sort((a, b) => a - b),
    correct, wrong, blank, total,
    score: total ? Math.round((correct / total) * 1000) / 10 : 0,
    answers,
  };
  exam.attempts = [attempt, ...(exam.attempts || [])].slice(0, 50);
  return { attempt, detail };
}

/** 交卷：记录一次作答，并把错题写进错题本 */
api.post('/exams/:id/attempts', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const { answers } = req.body || {};
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: '缺少 answers' });

  const { attempt, detail } = recordAttempt(exam, { ...req.body, mode: req.body?.mode || 'full' });
  // 整卷提交后清掉"中断"状态
  if (!req.body?.questionNos) delete exam.suspended;
  saveExam(exam);
  res.json({ attempt, detail });
});

/**
 * 中止做题：只提交已作答的题，留空的不判分也不进错题本；
 * 同时把作答快照存到题库里，之后可以「继续做题」接着做。
 */
api.post('/exams/:id/suspend', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const { answers, durationMs } = req.body || {};
  if (!answers || typeof answers !== 'object') return res.status(400).json({ error: '缺少 answers' });

  const answeredNos = exam.questions
    .filter((q) => answers[q.no])
    .map((q) => q.no);

  let attempt = null;
  let detail = [];
  if (answeredNos.length) {
    ({ attempt, detail } = recordAttempt(exam, {
      answers,
      durationMs,
      questionNos: answeredNos,
      // 冲刺中途中止也走这里，用 mode 区分来源（'sprint' / 'suspend'）
      mode: req.body?.mode || 'suspend',
    }));
  }

  exam.suspended = {
    at: new Date().toISOString(),
    answers,
    elapsedMs: Number(durationMs) || 0,
    answered: answeredNos.length,
    total: exam.questions.length,
  };
  saveExam(exam);
  res.json({ attempt, detail, suspended: exam.suspended });
});

/** 放弃继续：清掉中断快照 */
api.delete('/exams/:id/suspend', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  delete exam.suspended;
  saveExam(exam);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- 按题型刷题 */

function collectBySection() {
  const map = new Map();
  for (const meta of listExams()) {
    const exam = loadExam(meta.id);
    if (!exam) continue;
    for (const q of exam.questions) {
      const name = q.section || '未分类';
      if (!map.has(name)) {
        map.set(name, { name, total: 0, withAnswer: 0, exams: new Set(), kinds: {}, keys: new Set() });
      }
      const cur = map.get(name);
      cur.total += 1;
      if (q.answer) cur.withAnswer += 1;
      cur.exams.add(meta.id);
      cur.kinds[q.kind || 'text'] = (cur.kinds[q.kind || 'text'] || 0) + 1;
      cur.keys.add(`${meta.id}#${q.no}`);
    }
  }
  return map;
}

/** 题型总览：每类有多少题、覆盖几套卷、已刷多少 */
api.get('/practice/types', (_req, res) => {
  const map = collectBySection();
  const practiced = practicedKeySet();
  for (const t of map.values()) {
    t.practiced = 0;
    for (const key of practiced) {
      if (t.keys.has(key)) t.practiced += 1;
    }
  }
  const types = [...map.values()]
    .map((t) => ({
      name: t.name,
      total: t.total,
      withAnswer: t.withAnswer,
      exams: t.exams.size,
      figures: t.kinds.figure || 0,
      practiced: t.practiced || 0,
    }))
    .filter((t) => t.withAnswer > 0)
    .sort((a, b) => b.total - a.total);
  res.json({
    types,
    total: types.reduce((s, t) => s + t.total, 0),
    progress: progressSummary(),
  });
});

/**
 * 抽某个题型的题：跨卷混合。
 * 默认「先出没刷过的」——按上次刷题时间升序，从没刷过的排最前，同档内随机；
 * 刷完了再从头循环，不会没题可做。
 */
api.get('/practice/questions', (req, res) => {
  const section = String(req.query.section || '');
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 200);
  const order = String(req.query.order || 'fresh');
  const onlyFigures = req.query.kind === 'figure';
  const progress = getProgress();

  const pool = [];
  for (const meta of listExams()) {
    const exam = loadExam(meta.id);
    if (!exam) continue;
    for (const q of exam.questions) {
      if ((q.section || '未分类') !== section) continue;
      if (!q.answer) continue;                       // 没答案不好即时判分
      if (q.kind === 'image') continue;               // 题干选项都在截图里，没法作答
      if (onlyFigures && q.kind !== 'figure') continue;
      const p = progress[`${meta.id}#${q.no}`];
      pool.push({
        examId: meta.id,
        examTitle: meta.title || exam.title,
        no: q.no,
        kind: q.kind,
        stem: q.stem,
        options: q.options,
        figures: q.figures || [],
        answer: q.answer,
        explanation: q.explanation || '',
        section: q.section,
        practicedAt: p?.at || null,
        practicedTimes: p?.times || 0,
      });
    }
  }

  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  if (order === 'random') {
    shuffle(pool);
  } else if (order === 'seq') {
    // 保持卷面顺序
  } else {
    // fresh：没刷过的优先，其次按最久没刷的
    const fresh = shuffle(pool.filter((x) => !x.practicedAt));
    const done = shuffle(pool.filter((x) => x.practicedAt))
      .sort((a, b) => String(a.practicedAt).localeCompare(String(b.practicedAt)));
    pool.length = 0;
    pool.push(...fresh, ...done);
  }

  const unpracticed = pool.filter((x) => !x.practicedAt).length;
  res.json({
    section,
    total: pool.length,
    unpracticed,
    items: pool.slice(0, limit),
  });
});

/** 按题型练习的作答回传：记进度 + 错题进错题本 */
api.post('/practice/record', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.json({ ok: true, recorded: 0 });
  const records = [];
  for (const it of items) {
    const examId = it?.examId;
    const no = Number(it?.no);
    if (!examId || !Number.isFinite(no)) continue;
    const exam = loadExam(examId);
    const q = exam?.questions?.find((x) => x.no === no);
    if (!q) continue;
    const correct = sameAnswer(it.picked, q.answer);
    if (!correct && it.picked) {
      addWrong(examId, no, { picked: it.picked, answer: q.answer });
    }
    records.push({ examId, no, correct });
  }
  const recorded = recordMany(records, 'type');
  res.json({ ok: true, recorded, progress: progressSummary() });
});

/* ---------------------------------------------------------------- 刷题进度 */

api.get('/progress', (_req, res) => {
  res.json({ ...progressSummary(), byExam: countByExam() });
});

/** 重置刷题进度（错题本不受影响）；给 examId 就只重置那套卷 */
api.post('/progress/reset', (req, res) => {
  const examId = req.body?.examId || null;
  const removed = resetProgress(examId);
  res.json({ ok: true, removed, progress: progressSummary() });
});

/* ---------------------------------------------------------------- 做题历史 */

/** 汇总所有试卷的交卷记录，按时间倒序 */
api.get('/history', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = [];
  for (const meta of listExams()) {
    const exam = loadExam(meta.id);
    if (!exam) continue;
    for (const a of exam.attempts || []) {
      rows.push({
        examId: meta.id,
        examTitle: meta.title || exam.title,
        id: a.id,
        at: a.at,
        mode: a.mode || 'full',
        partial: Boolean(a.partial),
        total: a.total,
        correct: a.correct,
        wrong: a.wrong,
        blank: a.blank,
        score: a.score,
        durationMs: a.durationMs || 0,
        answered: Object.values(a.answers || {}).filter(Boolean).length,
      });
    }
  }
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const summary = {
    count: rows.length,
    byMode: rows.reduce((m, r) => { m[r.mode] = (m[r.mode] || 0) + 1; return m; }, {}),
    avgScore: rows.length
      ? Math.round((rows.reduce((s, r) => s + (r.score || 0), 0) / rows.length) * 10) / 10
      : null,
    bestScore: rows.length ? Math.max(...rows.map((r) => r.score || 0)) : null,
  };
  res.json({ items: rows.slice(0, limit), summary });
});

/** 删除一条历史记录 */
api.delete('/history/:examId/:attemptId', (req, res) => {
  const exam = loadExam(req.params.examId);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const before = (exam.attempts || []).length;
  exam.attempts = (exam.attempts || []).filter((a) => a.id !== req.params.attemptId);
  if (exam.attempts.length === before) return res.status(404).json({ error: '记录不存在' });
  saveExam(exam);
  res.json({ ok: true, removed: before - exam.attempts.length });
});

/* ------------------------------------------------------------ 题型练习会话 */

const DRILL_FILE = path.join(DATA_DIR, 'drill-session.json');

function readDrill() {
  try {
    return JSON.parse(fs.readFileSync(DRILL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeDrill(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!data) {
    try { fs.unlinkSync(DRILL_FILE); } catch { /* 没有就算了 */ }
    return;
  }
  const tmp = `${DRILL_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DRILL_FILE);
}

/** 当前是否有未做完的题型练习（用于「继续练习」） */
api.get('/practice/session', (_req, res) => {
  const s = readDrill();
  if (!s) return res.json({ session: null });
  res.json({
    session: {
      section: s.section,
      idx: s.idx || 0,
      total: (s.items || []).length,
      elapsedMs: s.elapsedMs || 0,
      limitSec: s.limitSec || 0,
      mode: s.mode || 'normal',
      savedAt: s.savedAt,
    },
  });
});

/** 中止时保存题型练习现场 */
api.post('/practice/session', (req, res) => {
  const b = req.body || {};
  if (!b.section || !Array.isArray(b.items) || !b.items.length) {
    return res.status(400).json({ error: '缺少 section / items' });
  }
  const session = {
    section: b.section,
    items: b.items.map((x) => ({ examId: x.examId, no: Number(x.no) })),
    idx: Number(b.idx) || 0,
    answers: b.answers || {},
    results: b.results || {},
    elapsedMs: Number(b.elapsedMs) || 0,
    limitSec: Number(b.limitSec) || 0,
    mode: b.mode || 'normal',
    savedAt: new Date().toISOString(),
  };
  writeDrill(session);
  res.json({ ok: true, session: { section: session.section, total: session.items.length, idx: session.idx } });
});

/** 继续练习：取出完整现场并按 key 补回题目内容 */
api.get('/practice/session/full', (_req, res) => {
  const s = readDrill();
  if (!s) return res.json({ session: null, items: [] });
  const cache = new Map();
  const items = [];
  for (const it of s.items || []) {
    if (!cache.has(it.examId)) cache.set(it.examId, loadExam(it.examId));
    const exam = cache.get(it.examId);
    const q = exam?.questions?.find((x) => x.no === it.no);
    if (!q) continue;
    items.push({
      examId: it.examId,
      examTitle: exam.title,
      no: q.no,
      kind: q.kind,
      stem: q.stem,
      options: q.options,
      figures: q.figures || [],
      answer: q.answer,
      explanation: q.explanation || '',
      keypoints: q.keypoints || [],
      section: q.section,
    });
  }
  res.json({ session: s, items });
});

api.delete('/practice/session', (_req, res) => {
  writeDrill(null);
  res.json({ ok: true });
});

/* ---------------------------------------------------------------- 错题本 */

api.get('/wrongbook', (req, res) => {
  res.json({
    items: listWrong({ includeMastered: req.query.all === '1' }),
    summary: wrongSummary(),
  });
});

api.post('/wrongbook', (req, res) => {
  const { examId, no, picked } = req.body || {};
  if (!examId || !no) return res.status(400).json({ error: '缺少 examId / no' });
  const exam = loadExam(examId);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const q = exam.questions.find((x) => x.no === Number(no));
  if (!q) return res.status(404).json({ error: '题目不存在' });
  addWrong(examId, Number(no), { picked: picked || null, answer: q.answer });
  res.json({ ok: true, summary: wrongSummary() });
});

api.patch('/wrongbook/:key', (req, res) => {
  const { mastered } = req.body || {};
  const entry = setMastered(req.params.key, mastered);
  if (!entry) return res.status(404).json({ error: '错题不存在' });
  res.json({ ok: true, entry, summary: wrongSummary() });
});

api.delete('/wrongbook/:key', (req, res) => {
  const ok = removeEntry(req.params.key);
  res.json({ ok, summary: wrongSummary() });
});

api.post('/wrongbook/clear-mastered', (_req, res) => {
  res.json({ ok: true, removed: clearMastered(), summary: wrongSummary() });
});

/* ---------------------------------------------------------------- 统计 */

api.get('/stats', (_req, res) => {
  const exams = listExams();
  let totalQuestions = 0;
  let withAnswer = 0;
  let attempts = 0;
  let answered = 0;
  let correct = 0;
  const bySection = new Map();

  for (const meta of exams) {
    const exam = loadExam(meta.id);
    if (!exam) continue;
    totalQuestions += exam.questions.length;
    withAnswer += exam.questions.filter((q) => q.answer).length;
    for (const a of exam.attempts || []) {
      attempts += 1;
      answered += a.correct + a.wrong;
      correct += a.correct;
    }
    const secMap = new Map();
    for (const q of exam.questions) {
      const s = q.section || '未分类';
      if (!secMap.has(s)) secMap.set(s, { total: 0, answered: 0 });
      secMap.get(s).total += 1;
    }
    // 用最近一次成绩估算分类正确率过于粗糙，这里只统计题量分布
    for (const [s, v] of secMap) {
      const cur = bySection.get(s) || { total: 0 };
      cur.total += v.total;
      bySection.set(s, cur);
    }
  }

  res.json({
    exams: exams.length,
    totalQuestions,
    withAnswer,
    attempts,
    accuracy: answered ? Math.round((correct / answered) * 1000) / 10 : null,
    wrongbook: wrongSummary(),
    progress: progressSummary(),
    bySection: [...bySection.entries()]
      .map(([name, v]) => ({ name, total: v.total }))
      .sort((a, b) => b.total - a.total),
  });
});

/** 只补解析、不动答案（题库里答案通常是官方的，详情交给模型写） */
api.post('/exams/:id/questions/:no/explain', async (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  const q = exam.questions.find((x) => x.no === Number(req.params.no));
  if (!q) return res.status(404).json({ error: '题目不存在' });
  if (!q.answer) return res.status(400).json({ error: '这道题还没有标准答案，无法生成解析' });
  try {
    await explainWithOfficialAnswers(exam, [q.no]);
    const fresh = loadExam(req.params.id).questions.find((x) => x.no === Number(req.params.no));
    res.json(fresh);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get('/exams/:id/export', (req, res) => {
  const exam = loadExam(req.params.id);
  if (!exam) return res.status(404).json({ error: '题集不存在' });
  res.setHeader('Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${exam.title}.json`)}`);
  res.json(exam);
});

/** 静态媒体：data/exams/<id>/media/<file> */
api.use('/media/:id', (req, res, next) => {
  const dir = path.join(EXAMS_DIR, path.basename(req.params.id), 'media');
  express.static(dir, { maxAge: '7d', fallthrough: true })(req, res, next);
});

export { examFile };
