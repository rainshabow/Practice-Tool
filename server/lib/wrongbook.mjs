import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.mjs';
import { listExams, loadExam } from './store.mjs';

const FILE = path.join(DATA_DIR, 'wrongbook.json');

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return { entries: Array.isArray(j.entries) ? j.entries : [] };
  } catch {
    return { entries: [] };
  }
}

function write(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

const keyOf = (examId, no) => `${examId}#${no}`;

/** 记一道错题（已存在就更新，并重置"已掌握"） */
export function addWrong(examId, no, { picked = null, answer = null } = {}) {
  const data = read();
  const key = keyOf(examId, no);
  const found = data.entries.find((e) => e.key === key);
  const now = new Date().toISOString();
  if (found) {
    found.picked = picked;
    found.answer = answer;
    found.at = now;
    found.mastered = false;
    found.times = (found.times || 1) + 1;
  } else {
    data.entries.push({ key, examId, no, picked, answer, at: now, mastered: false, times: 1 });
  }
  write(data);
}

/** 答对了就从错题本里标成已掌握（保留记录，便于统计） */
export function markMastered(examId, no) {
  const data = read();
  const found = data.entries.find((e) => e.key === keyOf(examId, no));
  if (found && !found.mastered) {
    found.mastered = true;
    found.masteredAt = new Date().toISOString();
    write(data);
  }
}

export function setMastered(key, mastered) {
  const data = read();
  const found = data.entries.find((e) => e.key === key);
  if (!found) return null;
  found.mastered = Boolean(mastered);
  if (mastered) found.masteredAt = new Date().toISOString();
  write(data);
  return found;
}

export function removeEntry(key) {
  const data = read();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => e.key !== key);
  write(data);
  return before !== data.entries.length;
}

export function clearMastered() {
  const data = read();
  const before = data.entries.length;
  data.entries = data.entries.filter((e) => !e.mastered);
  write(data);
  return before - data.entries.length;
}

/**
 * 返回错题本列表（带题干、选项、答案等上下文）。
 * 按题库分组，附每题所在试卷标题。
 */
export function listWrong({ includeMastered = false } = {}) {
  const data = read();
  const exams = new Map();
  for (const meta of listExams()) {
    exams.set(meta.id, meta);
  }
  const examCache = new Map();
  const getExam = (id) => {
    if (!examCache.has(id)) examCache.set(id, loadExam(id));
    return examCache.get(id);
  };

  const items = [];
  for (const e of data.entries) {
    if (!includeMastered && e.mastered) continue;
    const exam = getExam(e.examId);
    if (!exam) continue;
    const q = (exam.questions || []).find((x) => x.no === e.no);
    if (!q) continue;
    items.push({
      key: e.key,
      examId: e.examId,
      examTitle: exams.get(e.examId)?.title || exam.title,
      no: e.no,
      at: e.at,
      mastered: Boolean(e.mastered),
      times: e.times || 1,
      picked: e.picked,
      answer: q.answer,
      section: q.section,
      kind: q.kind,
      stem: q.stem,
      options: q.options,
      figures: q.figures || [],
      explanation: q.explanation,
    });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return items;
}

export function wrongSummary() {
  const data = read();
  const active = data.entries.filter((e) => !e.mastered);
  const byExam = new Map();
  for (const e of active) byExam.set(e.examId, (byExam.get(e.examId) || 0) + 1);
  return {
    total: data.entries.length,
    active: active.length,
    mastered: data.entries.length - active.length,
    byExam: Object.fromEntries(byExam),
  };
}
