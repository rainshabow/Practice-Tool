import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.mjs';

const FILE = path.join(DATA_DIR, 'progress.json');

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { version: 1, questions: j.questions && typeof j.questions === 'object' ? j.questions : {} };
  } catch {
    return { version: 1, questions: {} };
  }
}

function write(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
  fs.renameSync(tmp, FILE);
}

export const keyOf = (examId, no) => `${examId}#${no}`;

/**
 * 记一条"刷题进度"。
 * source 只是留痕：exam（整卷/中止）、sprint（冲刺）、type（按题型）、wrong（错题重刷）。
 * 同题多次刷只保留最近一次时间与对错，另计次数。
 */
export function recordProgress(examId, no, { correct = null, source = 'exam' } = {}) {
  const data = read();
  const key = keyOf(examId, no);
  const now = new Date().toISOString();
  const prev = data.questions[key];
  data.questions[key] = {
    at: now,
    examId,
    no: Number(no),
    source,
    correct: correct === null ? (prev?.correct ?? null) : Boolean(correct),
    times: (prev?.times || 0) + 1,
    firstAt: prev?.firstAt || now,
  };
  write(data);
  return data.questions[key];
}

/** 批量记（按题型一次交十几题） */
export function recordMany(items = [], source = 'type') {
  if (!items.length) return 0;
  const data = read();
  const now = new Date().toISOString();
  for (const it of items) {
    if (!it?.examId || !it?.no) continue;
    const key = keyOf(it.examId, it.no);
    const prev = data.questions[key];
    data.questions[key] = {
      at: now,
      examId: it.examId,
      no: Number(it.no),
      source,
      correct: it.correct === undefined ? (prev?.correct ?? null) : Boolean(it.correct),
      times: (prev?.times || 0) + 1,
      firstAt: prev?.firstAt || now,
    };
  }
  write(data);
  return items.length;
}

export function getProgress() {
  return read().questions;
}

export function practicedKeySet() {
  return new Set(Object.keys(read().questions));
}

/** 每套卷刷过多少题 */
export function countByExam() {
  const out = {};
  for (const v of Object.values(read().questions)) {
    out[v.examId] = (out[v.examId] || 0) + 1;
  }
  return out;
}

/** 重置进度：不传 examId 就是全清（错题本不受影响） */
export function resetProgress(examId = null) {
  const data = read();
  const before = Object.keys(data.questions).length;
  if (!examId) {
    data.questions = {};
  } else {
    for (const [k, v] of Object.entries(data.questions)) {
      if (v.examId === examId) delete data.questions[k];
    }
  }
  write(data);
  return before - Object.keys(data.questions).length;
}

export function progressSummary() {
  const qs = Object.values(read().questions);
  const right = qs.filter((q) => q.correct === true).length;
  const wrong = qs.filter((q) => q.correct === false).length;
  return {
    practiced: qs.length,
    right,
    wrong,
    accuracy: right + wrong ? Math.round((right / (right + wrong)) * 1000) / 10 : null,
  };
}
