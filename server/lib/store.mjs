import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, EXAMS_DIR } from '../config.mjs';
import { countByExam } from './progress.mjs';

export function ensureDirs() {
  fs.mkdirSync(EXAMS_DIR, { recursive: true });
}

export function slugify(text, fallback = 'exam') {
  // NFKC 把全角括号/字母折成 ASCII，再只保留字母数字下划线、汉字与短横线，
  // 保证生成的 id 既能做目录名，也能安全地放进 URL。
  const base = String(text || '')
    .normalize('NFKC')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

export function uniqueId(title) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const base = `${slugify(title)}-${stamp}`;
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(EXAMS_DIR, id))) id = `${base}-${++n}`;
  return id;
}

export function examDir(id) {
  if (!/^[\w\-\u4e00-\u9fa5]+$/.test(id)) throw new Error(`非法题集 id：${id}`);
  return path.join(EXAMS_DIR, id);
}

export const examFile = (id) => path.join(examDir(id), 'exam.json');
export const jobFile = (id) => path.join(examDir(id), 'job.json');
export const mediaDir = (id) => path.join(examDir(id), 'media');

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function loadExam(id) {
  return readJson(examFile(id));
}

export function saveExam(exam) {
  exam.updatedAt = new Date().toISOString();
  writeJson(examFile(exam.id), exam);
  return exam;
}

export function listExams() {
  ensureDirs();
  const out = [];
  const practicedByExam = countByExam();
  for (const entry of fs.readdirSync(EXAMS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const job = readJson(jobFile(entry.name), null);
    const data = readJson(examFile(entry.name));
    if (!data) {
      // 还在解析、exam.json 尚未生成：用 job 里的信息先占个位，刷新后也能看到进度
      if (job && (job.status === 'running' || job.status === 'error')) {
        out.push({
          id: entry.name,
          title: job.title || entry.name,
          questionCount: job.total || 0,
          answeredCount: 0,
          createdAt: job.startedAt || job.updatedAt,
          status: job.status,
          progress: { stage: job.stage, done: job.done, total: job.total },
        });
      }
      continue;
    }
    out.push({
      id: data.id,
      title: data.title,
      questionCount: data.questions?.length || 0,
      answeredCount: (data.questions || []).filter((q) => q.answer).length,
      createdAt: data.createdAt,
      status: job?.status || 'ready',
      progress: job ? { stage: job.stage, done: job.done, total: job.total } : null,
      // 上次"中止做题"留下的快照，用来在首页显示「继续做题」
      suspend: data.suspended
        ? {
          at: data.suspended.at,
          answered: data.suspended.answered || 0,
          total: data.suspended.total || (data.questions || []).length,
          elapsedMs: data.suspended.elapsedMs || 0,
        }
        : null,
      attemptCount: (data.attempts || []).length,
      lastScore: data.attempts?.[0]?.score ?? null,
      lastAt: data.attempts?.[0]?.at || null,
      practicedCount: practicedByExam[data.id] || 0,
    });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

export function deleteExam(id) {
  fs.rmSync(examDir(id), { recursive: true, force: true });
}

export function writeJob(id, patch) {
  const prev = readJson(jobFile(id), {});
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  writeJson(jobFile(id), next);
  return next;
}

export function readJob(id) {
  return readJson(jobFile(id), null);
}

export { DATA_DIR };
