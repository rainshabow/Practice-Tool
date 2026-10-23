/* ==========================================================================
   刷题 · 仿粉笔练习界面
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');

const state = {
  view: 'library',
  exams: [],
  exam: null,
  config: null,
  answers: {},       // no -> 'A'
  marks: {},         // no -> true
  notes: {},         // no -> string
  graded: false,
  elapsed: 0,        // 秒
  paused: false,
  timer: null,
  lastAttempt: null,
  importing: null,   // {id, title}
  poll: null,
  stats: null,
  wrong: null,       // 错题本数据 {items, summary}
  wbGraded: {},      // 错题重刷时的即时判分状态
  scope: 'all',      // 练习范围：all | undone | wrong | marked
  others: [],        // 换卷下拉用
};

/* ------------------------------------------------------------------ 工具 */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtClock = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${mm}:${ss}` : `${mm}:${ss}`;
};

function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: opts.body && !(opts.body instanceof Blob)
      ? { 'Content-Type': 'application/json' }
      : undefined,
    ...opts,
    body: opts.body && !(opts.body instanceof Blob) && typeof opts.body !== 'string'
      ? JSON.stringify(opts.body)
      : opts.body,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(data?.error || `请求失败 ${res.status}`);
  return data;
}

const LS_KEY = (id) => `shuati:v1:${id}`;

function loadLocal(id) {
  try { return JSON.parse(localStorage.getItem(LS_KEY(id)) || '{}'); } catch { return {}; }
}
function saveLocal() {
  if (!state.exam) return;
  const payload = {
    answers: state.answers,
    marks: state.marks,
    notes: state.notes,
    graded: state.graded,
    elapsed: state.elapsed,
  };
  try { localStorage.setItem(LS_KEY(state.exam.id), JSON.stringify(payload)); } catch { /* 忽略配额错误 */ }
}

/* ------------------------------------------------------------------ 图标 */
const icons = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.04V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09A1.7 1.7 0 0 0 20.96 10H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  submit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1"/><path d="M9 14l2.5 2.5L16 11"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.2 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>',
  starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.2 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m14 6.5 3 3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5"/><path d="M8.5 7.5h6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>',
  flash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
  pauseCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/></svg>',
  playCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/></svg>',
};

/* ------------------------------------------------------------------ 路由 */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const [kind, rawId, rawQ] = path.split('/');
  let id = rawId || '';
  try { id = decodeURIComponent(id); } catch { /* 保持原样 */ }
  const q = Number(rawQ);
  let params = new URLSearchParams();
  try { params = new URLSearchParams(query); } catch { /* 忽略 */ }
  return { kind: kind || 'library', id, q: Number.isFinite(q) && q > 0 ? q : null, params };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', render);

/* ------------------------------------------------------------------ 渲染入口 */
async function render() {
  const { kind, id, q } = parseHash();
  if (kind === 'exam' && id) {
    await renderExam(id);
  } else if (kind === 'sprint' && id) {
    await renderSprint(id);
  } else if (kind === 'types' && id) {
    await renderTypePractice(id);
  } else if (kind === 'edit' && id && q) {
    await renderEditor(id, q);
  } else if (kind === 'types') {
    await renderTypes();
  } else if (kind === 'history') {
    await renderHistory();
  } else if (kind === 'wrongbook' && id === 'practice') {
    await renderWrongPractice();
  } else if (kind === 'wrongbook') {
    await renderWrongbook();
  } else {
    await renderLibrary();
  }
}

/** 「按试卷刷 / 按题型刷」同级切换（做题历史走顶栏按钮） */
function modeTabs(active) {
  return `
    <div class="mode-tabs">
      <a class="mode-tab ${active === 'paper' ? 'active' : ''}" href="#/">按试卷刷</a>
      <a class="mode-tab ${active === 'type' ? 'active' : ''}" href="#/types">按题型刷</a>
    </div>`;
}

/** 数字选择：快捷 chip + 自定义输入，两者联动 */
function numberPicker({ id, values, value, min = 1, max = 999, unit = '' }) {
  const cur = Number(value) || values[0];
  const uniq = [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))];
  return `
    <div class="num-picker">
      <div class="num-chips">
        ${uniq.map((v) => `<button type="button" class="num-chip ${v === cur ? 'active' : ''}" data-for="${id}" data-v="${v}">${v}${unit}</button>`).join('')}
      </div>
      <div class="num-custom">
        <input id="${id}" type="number" min="${min}" max="${max}" value="${cur}" />
        <span>${unit || '自定义'}</span>
      </div>
    </div>`;
}

function bindNumberPicker(id) {
  document.querySelectorAll(`.num-chip[data-for="${id}"]`).forEach((btn) => {
    btn.onclick = () => {
      const input = document.getElementById(id);
      if (!input) return;
      input.value = btn.dataset.v;
      document.querySelectorAll(`.num-chip[data-for="${id}"]`).forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
    };
  });
  const input = document.getElementById(id);
  if (input) {
    input.oninput = () => {
      document.querySelectorAll(`.num-chip[data-for="${id}"]`).forEach((b) => {
        b.classList.toggle('active', String(input.value) === b.dataset.v);
      });
    };
  }
}

function topbar({ left = '', center = '', right = '', back = '#/' }) {  return `
    <div class="topbar">
      <div class="topbar-left">
        <a class="icon-btn back-btn" href="${esc(back)}" title="返回">${icons.back}</a>
        ${left}
      </div>
      <div class="topbar-center">${esc(center)}</div>
      <div class="topbar-right">${right}</div>
    </div>`;
}

/* ==========================================================================
   题库页
   ========================================================================== */
async function renderLibrary() {
  stopTimer();
  state.view = 'library';
  state.exam = null;

  app.innerHTML = `
    ${topbar({
      center: '刷题 · 题库',
      back: '#/',
      right: `<button class="icon-btn" id="btn-history">${icons.clock}<span>做题历史</span></button>
              <button class="icon-btn" id="btn-wrongbook">${icons.book}<span>错题本</span><b class="badge-dot" id="wb-badge" hidden></b></button>
              <button class="icon-btn" id="btn-settings">${icons.gear}<span>设置</span></button>`,
    })}
    <div class="page">
      ${modeTabs('paper')}
      <div class="lib-head">
        <h1>试卷</h1>
        <div class="actions">
          <button class="btn ghost sm" id="btn-refresh">${icons.refresh}<span>刷新</span></button>
        </div>
      </div>
      <div class="stat-row" id="stat-row"></div>
      <div class="lib-toolbar">
        <input id="search" class="search-input" placeholder="搜索试卷名…" />
        <select id="sort" class="search-input" style="max-width:150px">
          <option value="new">最新导入</option>
          <option value="count">题量最多</option>
          <option value="wrong">错题最多</option>
          <option value="name">按名称</option>
        </select>
      </div>
      <div id="import-progress"></div>
      <div class="exam-list" id="exam-list"><div class="empty-state">加载中…</div></div>
      <details class="upload-details">
        <summary>导入新试卷（PDF）</summary>
        <div class="dropzone" id="dropzone">
          ${icons.upload}
          <div class="dz-title">拖入 PDF，或点击选择文件</div>
          <div class="dz-hint">支持粉笔导出的试卷 PDF；解析版 PDF（带「正确答案」）会直接采用官方答案</div>
          <input type="file" id="file-input" accept="application/pdf,.pdf" hidden />
        </div>
      </details>
    </div>
  `;

  $('#btn-settings').onclick = openSettings;
  $('#btn-refresh').onclick = () => loadLibraryData(true);
  $('#btn-wrongbook').onclick = () => navigate('#/wrongbook');
  $('#btn-history').onclick = () => navigate('#/history');
  $('#search').oninput = () => paintExams();
  $('#sort').onchange = () => paintExams();

  const dz = $('#dropzone');
  const fi = $('#file-input');
  dz.onclick = () => fi.click();
  fi.onchange = () => { if (fi.files[0]) uploadPdf(fi.files[0]); fi.value = ''; };
  for (const ev of ['dragenter', 'dragover']) {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); });
  }
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) uploadPdf(f);
  });

  if (state.importing) showImportProgress(state.importing);
  await loadLibraryData();
}

async function loadLibraryData(force) {
  if (force) toast('已刷新');
  await Promise.all([loadExams(), loadStats()]);
}

async function loadStats() {
  try {
    state.stats = await api('/stats');
  } catch { state.stats = null; }
  const row = $('#stat-row');
  if (!row || !state.stats) return;
  const s = state.stats;
  const wb = s.wrongbook || { active: 0, mastered: 0 };
  const pg = s.progress || { practiced: 0 };
  row.innerHTML = `
    <div class="stat-card"><b>${s.exams}</b><span>套试卷</span></div>
    <div class="stat-card"><b>${s.totalQuestions}</b><span>道题</span></div>
    <div class="stat-card"><b>${pg.practiced || 0}</b><span>已刷题数</span></div>
    <div class="stat-card"><b>${s.accuracy == null ? '—' : `${s.accuracy}%`}</b><span>累计正确率</span></div>
    <div class="stat-card clickable" data-goto-wrong="1"><b class="${wb.active ? 'warn' : ''}">${wb.active}</b><span>待复习错题</span></div>`;
  const wbCard = row.querySelector('[data-goto-wrong]');
  if (wbCard) wbCard.onclick = () => navigate('#/wrongbook');
  updateWrongBadge(wb.active);
}

function updateWrongBadge(n) {
  const el = $('#wb-badge');
  if (!el) return;
  if (n > 0) { el.hidden = false; el.textContent = n > 99 ? '99+' : String(n); }
  else el.hidden = true;
}

async function loadExams() {
  const list = $('#exam-list');
  if (!list) return;
  try {
    const { exams } = await api('/exams');
    state.exams = exams;
    paintExams();
  } catch (err) {
    list.innerHTML = `<div class="empty-state">加载失败：${esc(err.message)}</div>`;
  }
}

/** 按搜索词与排序重画列表（不发请求） */
function paintExams() {
  const list = $('#exam-list');
  if (!list) return;
  const kw = ($('#search')?.value || '').trim().toLowerCase();
  const sort = $('#sort')?.value || 'new';
  const wrongByExam = state.stats?.wrongbook?.byExam || {};

  let exams = (state.exams || []).slice();
  if (kw) exams = exams.filter((x) => x.title.toLowerCase().includes(kw));
  exams.sort((a, b) => {
    if (sort === 'count') return b.questionCount - a.questionCount;
    if (sort === 'wrong') return (wrongByExam[b.id] || 0) - (wrongByExam[a.id] || 0);
    if (sort === 'name') return a.title.localeCompare(b.title, 'zh');
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });

  if (!exams.length) {
    list.innerHTML = state.exams?.length
      ? '<div class="empty-state">没有匹配的试卷</div>'
      : '<div class="empty-state">还没有题库<br/>展开下面的「导入新试卷」，拖一个 PDF 进虚线框</div>';
    return;
  }

  list.innerHTML = exams.map((x) => examCard(x, wrongByExam[x.id] || 0)).join('');
  list.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = () => navigate(`#/exam/${encodeURIComponent(el.dataset.open)}`);
  });
  list.querySelectorAll('[data-resume]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      navigate(`#/exam/${encodeURIComponent(el.dataset.resume)}?resume=1`);
    };
  });
  list.querySelectorAll('[data-wrong]').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      navigate(`#/wrongbook`);
    };
  });
  list.querySelectorAll('[data-del]').forEach((el) => {
    el.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`删除题库「${el.dataset.title}」？此操作不可撤销。`)) return;
      try {
        await api(`/exams/${encodeURIComponent(el.dataset.del)}`, { method: 'DELETE' });
        toast('已删除');
        loadLibraryData(true);
      } catch (err) { toast(err.message); }
    };
  });
}

/** 从试卷标题里认年份，做个角标 */
function yearBadge(title) {
  const m = String(title).match(/(20\d{2})/);
  return m ? m[1] : null;
}

function examCard(x, wrongCount) {
  const date = x.createdAt ? new Date(x.createdAt).toLocaleDateString('zh-CN') : '';
  const running = x.status === 'running';
  const year = yearBadge(x.title);
  const progressTxt = running && x.progress
    ? `${x.progress.stage || '解析中'} ${x.progress.done || 0}/${x.progress.total || '?'}`
    : `${x.questionCount} 题`;
  const answerTxt = running
    ? '正在解析'
    : (x.answeredCount === x.questionCount ? '答案齐全' : `缺 ${x.questionCount - x.answeredCount} 道答案`);
  const suspended = x.suspend && !running;
  const action = running
    ? '<button class="btn sm" disabled>解析中…</button>'
    : suspended
      ? `<button class="btn sm" data-resume="${esc(x.id)}">继续做题</button>`
      : `<button class="btn sm" data-open="${esc(x.id)}">开始练习</button>`;

  const suspendChip = suspended
    ? `<span class="chip orange">中断于 ${x.suspend.answered}/${x.suspend.total} 题</span>`
    : '';

  return `
    <div class="exam-item ${suspended ? 'has-suspend' : ''}">
      ${year ? `<div class="ei-year">${esc(year)}</div>` : '<div class="ei-year">卷</div>'}
      <div class="ei-main" ${running ? '' : `data-open="${esc(x.id)}" role="button" tabindex="0"`} style="${running ? '' : 'cursor:pointer'}">
        <div class="ei-title">${esc(x.title)}</div>
        <div class="ei-meta">
          <span>${esc(progressTxt)}</span>
          <span>${esc(answerTxt)}</span>
          ${suspendChip}
          ${x.practicedCount ? `<span class="chip blue">已刷 ${x.practicedCount}/${x.questionCount}</span>` : ''}
          ${wrongCount ? `<span class="chip orange">错题 ${wrongCount}</span>` : ''}
          ${running ? '<span class="chip blue">解析中</span>' : ''}
          ${x.status === 'error' ? '<span class="chip red">失败</span>' : ''}
          ${x.lastScore != null ? `<span>上次 ${x.lastScore} 分</span>` : ''}
          <span>${esc(date)}</span>
        </div>
      </div>
      <div class="ei-actions">
        ${action}
        <button class="icon-btn" data-del="${esc(x.id)}" data-title="${esc(x.title)}" title="删除">${icons.trash}</button>
      </div>
    </div>`;
}

async function uploadPdf(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) { toast('请选择 PDF 文件'); return; }
  const box = $('#import-progress');
  box.innerHTML = `
    <div class="progress-card">
      <div class="pc-head"><span class="spinner"></span><span>正在上传 ${esc(file.name)} …</span></div>
      <div class="pc-bar"><i></i></div>
    </div>`;
  try {
    const res = await fetch(`/api/exams?title=${encodeURIComponent(file.name.replace(/\.pdf$/i, ''))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf', 'X-Filename': encodeURIComponent(file.name) },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || '上传失败');
    state.importing = { id: data.id, title: data.title };
    showImportProgress(state.importing);
    loadExams(true);
  } catch (err) {
    box.innerHTML = `<div class="progress-card error"><div class="pc-head">上传失败：${esc(err.message)}</div></div>`;
  }
}

function showImportProgress({ id, title }) {
  const box = $('#import-progress');
  if (!box) return;
  box.innerHTML = `
    <div class="progress-card" id="pc">
      <div class="pc-head"><span class="spinner"></span><span>正在解析「${esc(title)}」…</span></div>
      <div class="pc-bar"><i style="width:2%"></i></div>
      <div class="pc-msg">准备中</div>
    </div>`;
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    try {
      const job = await api(`/exams/${encodeURIComponent(id)}/job`);
      const pc = $('#pc');
      if (!pc) { clearInterval(state.poll); return; }
      const total = job.total || 0;
      const done = job.done || 0;
      const pct = total ? Math.max(2, Math.round((done / total) * 100)) : 8;
      pc.querySelector('.pc-bar i').style.width = `${pct}%`;
      pc.querySelector('.pc-head span:last-child').textContent = job.stage || '解析中';
      pc.querySelector('.pc-msg').textContent = job.message || '';
      if (job.status === 'ready') {
        clearInterval(state.poll);
        state.poll = null;
        state.importing = null;
        pc.className = 'progress-card';
        pc.querySelector('.pc-head').innerHTML = `<span>解析完成</span>`;
        pc.querySelector('.pc-bar i').style.width = '100%';
        toast('解析完成，可以开始刷题了');
        loadExams(true);
      } else if (job.status === 'error') {
        clearInterval(state.poll);
        state.poll = null;
        state.importing = null;
        pc.className = 'progress-card error';
        pc.querySelector('.pc-head').innerHTML = `<span>解析失败</span>`;
        pc.querySelector('.pc-msg').textContent = job.message || '';
      }
    } catch { /* 忽略瞬时错误 */ }
  }, 1200);
}

/* ==========================================================================
   错题本
   ========================================================================== */
async function loadWrongbook(all = false) {
  try {
    state.wrong = await api(`/wrongbook${all ? '?all=1' : ''}`);
  } catch (err) {
    toast(`错题本加载失败：${err.message}`);
    state.wrong = { items: [], summary: { active: 0, mastered: 0, byExam: {} } };
  }
  return state.wrong;
}

async function renderWrongbook() {
  stopTimer();
  state.view = 'wrongbook';
  state.exam = null;
  const showAll = Boolean(state.wrongbookAll);

  app.innerHTML = `
    ${topbar({
      center: '错题本',
      back: '#/',
      right: `<button class="icon-btn" id="btn-wb-practice">${icons.shuffle}<span>开始重刷</span></button>
              <button class="icon-btn" id="btn-settings">${icons.gear}<span>设置</span></button>`,
    })}
    <div class="page">
      <div class="lib-head">
        <h1>错题本</h1>
        <div class="actions">
          <label class="wb-toggle"><input type="checkbox" id="wb-show-all" ${showAll ? 'checked' : ''}/> 显示已掌握</label>
          <button class="btn ghost sm" id="btn-wb-clear">清理已掌握</button>
        </div>
      </div>
      <div class="stat-row" id="wb-stat"></div>
      <div class="lib-toolbar">
        <select id="wb-exam" class="search-input" style="max-width:320px">
          <option value="">全部试卷</option>
        </select>
      </div>
      <div id="wb-list" class="wb-list"><div class="empty-state">加载中…</div></div>
    </div>`;

  $('#btn-settings').onclick = openSettings;
  $('#btn-wb-practice').onclick = () => navigate('#/wrongbook/practice');
  $('#wb-show-all').onchange = async (e) => {
    state.wrongbookAll = e.target.checked;
    await renderWrongbook();
  };
  $('#btn-wb-clear').onclick = async () => {
    if (!confirm('把「已掌握」的错题从错题本里清掉？（不影响题库）')) return;
    try {
      const r = await api('/wrongbook/clear-mastered', { method: 'POST' });
      toast(`已清理 ${r.removed} 条`);
      await renderWrongbook();
    } catch (err) { toast(err.message); }
  };
  $('#wb-exam').onchange = () => paintWrongbook();

  await loadWrongbook(showAll);
  paintWrongbook();
}

function paintWrongbook() {
  const list = $('#wb-list');
  const stat = $('#wb-stat');
  if (!list) return;
  const items = state.wrong?.items || [];
  const sum = state.wrong?.summary || { active: 0, mastered: 0 };

  if (stat) {
    stat.innerHTML = `
      <div class="stat-card"><b class="${sum.active ? 'warn' : ''}">${sum.active}</b><span>待复习</span></div>
      <div class="stat-card"><b>${sum.mastered}</b><span>已掌握</span></div>
      <div class="stat-card"><b>${new Set(items.map((i) => i.examId)).size}</b><span>涉及试卷</span></div>`;
  }

  const sel = $('#wb-exam');
  if (sel) {
    const byExam = new Map();
    for (const it of items) byExam.set(it.examId, it.examTitle);
    const cur = sel.value;
    sel.innerHTML = `<option value="">全部试卷（${items.length}）</option>` +
      [...byExam.entries()].map(([id, t]) => `<option value="${esc(id)}">${esc(t)}（${items.filter((i) => i.examId === id).length}）</option>`).join('');
    sel.value = cur;
  }

  const examId = sel?.value || '';
  const shown = examId ? items.filter((i) => i.examId === examId) : items;
  if (!shown.length) {
    list.innerHTML = '<div class="empty-state">这里还没有错题<br/>做一套卷子交卷后，答错的题会自动进来</div>';
    return;
  }

  list.innerHTML = shown.map((it) => `
    <div class="wb-item ${it.mastered ? 'mastered' : ''}">
      <div class="wb-head">
        <span class="wb-exam">${esc(it.examTitle)}</span>
        <span class="wb-no">第 ${it.no} 题</span>
        ${it.section ? `<span class="chip">${esc(it.section)}</span>` : ''}
        ${it.mastered ? '<span class="chip green">已掌握</span>' : `<span class="chip red">错 ${it.times || 1} 次</span>`}
        <span class="wb-actions">
          <button class="mini" data-goto="${esc(it.examId)}#${it.no}">看原题</button>
          <button class="mini" data-master="${esc(it.key)}" data-to="${it.mastered ? 0 : 1}">${it.mastered ? '取消已掌握' : '标记已掌握'}</button>
          <button class="mini" data-remove="${esc(it.key)}">移除</button>
        </span>
      </div>
      <div class="wb-stem">${esc((it.stem || '').slice(0, 160))}${(it.stem || '').length > 160 ? '…' : ''}</div>
      <div class="wb-meta">
        <span class="chip">你选 ${esc(it.picked || '—')}</span>
        <span class="chip green">答案 ${esc(it.answer || '待补')}</span>
      </div>
    </div>`).join('');

  list.querySelectorAll('[data-goto]').forEach((el) => {
    el.onclick = () => {
      const [id, no] = el.dataset.goto.split('#');
      navigate(`#/exam/${encodeURIComponent(id)}/${no}`);
    };
  });
  list.querySelectorAll('[data-master]').forEach((el) => {
    el.onclick = async () => {
      try {
        await api(`/wrongbook/${encodeURIComponent(el.dataset.master)}`, {
          method: 'PATCH',
          body: { mastered: el.dataset.to === '1' },
        });
        await loadWrongbook(Boolean(state.wrongbookAll));
        paintWrongbook();
      } catch (err) { toast(err.message); }
    };
  });
  list.querySelectorAll('[data-remove]').forEach((el) => {
    el.onclick = async () => {
      try {
        await api(`/wrongbook/${encodeURIComponent(el.dataset.remove)}`, { method: 'DELETE' });
        await loadWrongbook(Boolean(state.wrongbookAll));
        paintWrongbook();
        toast('已移除');
      } catch (err) { toast(err.message); }
    };
  });
}

/* ---------------------------------------------------------- 错题重刷（即时判分） */
async function renderWrongPractice() {
  stopTimer();
  state.view = 'wrongbook-practice';
  state.exam = null;
  state.wbPicked = {};
  state.wbGraded = {};

  await loadWrongbook(false);
  const items = (state.wrong?.items || []).filter((i) => !i.mastered);

  app.innerHTML = `
    ${topbar({
      center: `错题重刷（${items.length} 题）`,
      back: '#/wrongbook',
      right: `<span class="wb-score" id="wb-score">0 / ${items.length}</span>`,
    })}
    <div class="page">
      ${items.length ? '' : '<div class="empty-state">没有待复习的错题 🎉<br/>去<a href="#/">做套卷子</a>吧</div>'}
      <div id="wb-cards">${items.map((it) => wbCard(it)).join('')}</div>
    </div>`;

  const wrap = $('#wb-cards');
  wrap.addEventListener('click', async (e) => {
    const card = e.target.closest('.wb-card');
    if (!card) return;
    const key = card.dataset.key;
    const item = items.find((i) => i.key === key);
    if (!item) return;

    const opt = e.target.closest('.qopt');
    if (opt && !state.wbGraded[key]) {
      const label = opt.dataset.label;
      if (String(item.answer || '').length > 1) {
        const cur = new Set(canonAnswer(state.wbPicked[key]));
        if (cur.has(label)) cur.delete(label); else cur.add(label);
        state.wbPicked[key] = [...cur].sort().join('');
      } else {
        state.wbPicked[key] = label;
      }
      state.wbGraded[key] = true;
      card.outerHTML = wbCard(item);
      updateWbScore(items);
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (btn) {
      if (btn.dataset.act === 'explain') {
        btn.disabled = true;
        btn.textContent = '生成中…';
        try {
          const updated = await api(
            `/exams/${encodeURIComponent(item.examId)}/questions/${item.no}/explain`,
            { method: 'POST' },
          );
          item.explanation = updated.explanation;
          const el = wrap.querySelector(`[data-key="${CSS.escape(key)}"]`);
          if (el) el.outerHTML = wbCard(item);
        } catch (err) {
          toast(`生成解析失败：${err.message}`);
          btn.disabled = false;
          btn.textContent = '生成解析';
        }
      } else if (btn.dataset.act === 'master') {
        try {
          await api(`/wrongbook/${encodeURIComponent(key)}`, { method: 'PATCH', body: { mastered: true } });
          toast('已标记掌握');
          btn.textContent = '已掌握';
          btn.disabled = true;
        } catch (err) { toast(err.message); }
      }
      return;
    }

    const img = e.target.closest('.qfig img');
    if (img) openLightbox(img.src);
  });

  updateWbScore(items);
}

function updateWbScore(items) {
  const el = $('#wb-score');
  if (!el) return;
  let right = 0;
  let done = 0;
  for (const it of items) {
    if (!state.wbGraded[it.key]) continue;
    done++;
    if (canonAnswer(state.wbPicked[it.key]) === canonAnswer(it.answer)) right++;
  }
  el.textContent = `${right} / ${done || 0} 正确 · 共 ${items.length}`;
}

function wbCard(item) {
  const key = item.key;
  const graded = Boolean(state.wbGraded[key]);
  const picked = state.wbPicked[key] || '';
  const pickedSet = new Set(canonAnswer(picked));
  const keySet = new Set(canonAnswer(item.answer));
  const isRight = graded && canonAnswer(picked) === canonAnswer(item.answer);
  const multi = String(item.answer || '').length > 1;

  const opts = (item.options || []).map((o) => {
    const cls = ['qopt'];
    const chosen = pickedSet.has(o.label);
    const isKey = keySet.has(o.label);
    if (o.text === '') cls.push('no-text');
    if (graded) {
      if (chosen && isKey) cls.push('picked', 'correct');
      else if (chosen) cls.push('picked', 'wrong');
      else if (isKey) cls.push('answer-key');
    }
    return `<li class="${cls.join(' ')}" data-label="${esc(o.label)}">
      <span class="badge">${esc(o.label)}</span>
      <span class="qopt-text">${o.text === '' ? '见图' : esc(o.text)}</span>
    </li>`;
  }).join('');

  const figs = (item.figures || []).map((f) => f.parts.map((p) => `
    <div class="qfig"><img src="/api/media/${encodeURIComponent(item.examId)}/${encodeURIComponent(p.file)}"
      alt="配图" loading="lazy" /></div>`).join('')).join('');

  return `
  <article class="qcard wb-card ${graded ? 'graded' : ''}" data-key="${esc(key)}">
    <header class="qcard-head">
      <span class="wb-exam">${esc(item.examTitle)}</span>
      <span class="qno">第 ${item.no} 题</span>
      <span class="tag">${multi ? '多选题' : '单选题'}</span>
      ${item.section ? `<span class="chip">${esc(item.section)}</span>` : ''}
    </header>
    <div class="qstem">${esc(item.stem).replace(/〔图〕/g, '<span class="qmark">图</span>')}</div>
    ${figs ? `<div class="qfigs">${figs}</div>` : ''}
    <ul class="qopts">${opts}</ul>
    ${graded ? `
      <div class="qanalysis">
        <div class="qa-head">
          <span class="qa-title ${isRight ? 'right' : 'wrong'}">${isRight ? '答对了' : '答错'}</span>
          <span class="chip">你选 ${esc(picked || '—')}</span>
          <span class="chip green">答案 ${esc(item.answer || '待补')}</span>
        </div>
        <div class="qa-body ${item.explanation ? '' : 'empty'}">${esc(item.explanation || '暂无解析')}</div>
        <div class="qa-foot">
          ${item.explanation ? '' : '<button class="mini primary" data-act="explain">生成解析</button>'}
          <button class="mini" data-act="master">标记已掌握</button>
        </div>
      </div>` : ''}
  </article>`;
}

/* ==========================================================================
   做题历史
   ========================================================================== */
const MODE_LABEL = {
  full: ['整卷交卷', 'blue'],
  sprint: ['冲刺', 'orange'],
  suspend: ['中止', 'orange'],
};

async function renderHistory() {
  stopTimer();
  state.view = 'history';
  state.exam = null;

  let data;
  try {
    data = await api('/history');
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}</div></div>`;
    return;
  }
  const items = data.items || [];
  const sum = data.summary || {};

  app.innerHTML = `
    ${topbar({
      center: '刷题 · 做题历史',
      back: '#/',
      right: `<button class="icon-btn" id="btn-history">${icons.clock}<span>做题历史</span></button>
              <button class="icon-btn" id="btn-wrongbook">${icons.book}<span>错题本</span></button>
              <button class="icon-btn" id="btn-settings">${icons.gear}<span>设置</span></button>`,
    })}
    <div class="page">
      <div class="lib-head">
        <h1>做题历史</h1>
      </div>
      <div class="stat-row">
        <div class="stat-card"><b>${sum.count || 0}</b><span>次记录</span></div>
        <div class="stat-card"><b>${sum.avgScore == null ? '—' : `${sum.avgScore}`}</b><span>平均分</span></div>
        <div class="stat-card"><b>${sum.bestScore == null ? '—' : `${sum.bestScore}`}</b><span>最高分</span></div>
        <div class="stat-card"><b>${(sum.byMode?.sprint) || 0}</b><span>其中冲刺</span></div>
      </div>
      ${items.length ? '<div id="hist-list" class="hist-list"></div>'
    : '<div class="empty-state">还没有做题记录<br/>做一套卷子交卷后，这里会留下每一次的得分</div>'}
    </div>`;

  $('#btn-settings').onclick = openSettings;
  $('#btn-wrongbook').onclick = () => navigate('#/wrongbook');
  $('#btn-history').onclick = () => navigate('#/history');
  if (!items.length) return;

  const list = $('#hist-list');
  list.innerHTML = items.map((r) => {
    const [modeText, modeCls] = MODE_LABEL[r.mode] || [r.mode, ''];
    const date = r.at ? new Date(r.at).toLocaleString('zh-CN', { hour12: false }) : '';
    const mins = Math.round((r.durationMs || 0) / 1000);
    return `
      <div class="hist-item">
        <div class="hist-main">
          <div class="hist-title">
            <span class="hist-exam">${esc(r.examTitle)}</span>
            <span class="chip ${modeCls}">${esc(modeText)}</span>
            ${r.partial ? `<span class="chip">只判 ${r.total} 题</span>` : ''}
          </div>
          <div class="hist-meta">
            <span>${esc(date)}</span>
            <span>用时 ${fmtClock(mins)}</span>
            <span>对 ${r.correct} / 错 ${r.wrong} / 未答 ${r.blank}</span>
            <span>共 ${r.total} 题</span>
          </div>
        </div>
        <div class="hist-score">${r.score == null ? '—' : r.score}<i>分</i></div>
        <div class="hist-actions">
          <button class="mini" data-review="${esc(r.examId)}|${esc(r.id)}">复盘</button>
          <button class="mini" data-del="${esc(r.examId)}|${esc(r.id)}">删除</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-review]').forEach((b) => {
    b.onclick = () => {
      const [examId, id] = b.dataset.review.split('|');
      navigate(`#/exam/${encodeURIComponent(examId)}?attempt=${encodeURIComponent(id)}`);
    };
  });
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const [examId, id] = b.dataset.del.split('|');
      if (!confirm('删除这条作答记录？（不影响题库和错题本）')) return;
      try {
        await api(`/history/${encodeURIComponent(examId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('已删除');
        renderHistory();
      } catch (err) { toast(err.message); }
    };
  });
}

/* ==========================================================================
   按题型刷题（仿牛客「专项练习」）
   ========================================================================== */
async function renderTypes() {
  stopTimer();
  state.view = 'types';
  state.exam = null;

  let data;
  try {
    data = await api('/practice/types');
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}</div></div>`;
    return;
  }
  const types = data.types || [];
  const totalQ = types.reduce((s, t) => s + t.total, 0);
  const pg = data.progress || { practiced: 0, right: 0, wrong: 0, accuracy: null };

  app.innerHTML = `
    ${topbar({
      center: '刷题 · 按题型',
      back: '#/',
      right: `<button class="icon-btn" id="btn-history">${icons.clock}<span>做题历史</span></button>
              <button class="icon-btn" id="btn-wrongbook">${icons.book}<span>错题本</span></button>
              <button class="icon-btn" id="btn-settings">${icons.gear}<span>设置</span></button>`,
    })}
    <div class="page">
      ${modeTabs('type')}
      <div class="lib-head">
        <h1>按题型刷</h1>
        <div class="actions">
          <button class="btn ghost sm" id="btn-reset-progress">${icons.refresh}<span>重置进度</span></button>
        </div>
      </div>
      <div id="drill-resume"></div>
      <div class="stat-row">
        <div class="stat-card"><b>${types.length}</b><span>个题型</span></div>
        <div class="stat-card"><b>${totalQ}</b><span>道题</span></div>
        <div class="stat-card"><b>${pg.practiced || 0}</b><span>已刷题数</span></div>
        <div class="stat-card"><b>${pg.accuracy == null ? '—' : `${pg.accuracy}%`}</b><span>刷题正确率</span></div>
      </div>
      <p class="types-intro">每类都优先抽<b>没刷过</b>的题；刷完了自动从头循环。进度与错题本互不影响。</p>
      <div class="type-grid">
        ${types.map((t) => {
          const pct = t.total ? Math.round((t.practiced / t.total) * 100) : 0;
          return `
          <div class="type-card" data-type="${esc(t.name)}">
            <div class="tc-name">${esc(t.name)}</div>
            <div class="tc-meta">
              <span>${t.total} 题</span>
              <span>${t.exams} 套卷</span>
              ${t.figures ? `<span>含图 ${t.figures}</span>` : ''}
            </div>
            <div class="tc-progress">
              <div class="tc-track"><i style="width:${pct}%"></i></div>
              <span>已刷 ${t.practiced}/${t.total}</span>
            </div>
            <button class="btn ghost sm tc-btn">开始练习</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;

  $('#btn-settings').onclick = openSettings;
  $('#btn-wrongbook').onclick = () => navigate('#/wrongbook');
  $('#btn-history').onclick = () => navigate('#/history');
  $('#btn-reset-progress').onclick = () => {
    openModal({
      title: '重置刷题进度',
      sub: `会把「已刷 ${pg.practiced || 0} 题」的记录清零，题目本身和错题本都不受影响。`,
      body: '<p class="modal-note">之后按题型练习会重新从第一题开始算「没刷过」。</p>',
      actions: [
        { label: '取消', cls: 'ghost', onClick: closeModal },
        {
          label: '确认重置',
          onClick: async () => {
            try {
              const r = await api('/progress/reset', { method: 'POST', body: {} });
              closeModal();
              toast(`已重置 ${r.removed} 条刷题记录`);
              renderTypes();
            } catch (err) { toast(err.message); }
          },
        },
      ],
    });
  };
  document.querySelectorAll('[data-type]').forEach((el) => {
    el.onclick = () => {
      const t = types.find((x) => x.name === el.dataset.type);
      openTypePicker(el.dataset.type, t);
    };
  });

  // 上次中止的题型练习：给个「继续练习」入口
  try {
    const { session } = await api('/practice/session');
    const box = $('#drill-resume');
    if (session && box) {
      box.innerHTML = `
        <div class="notice">
          <span>上次「${esc(session.section)}」练到第 ${session.idx + 1}/${session.total} 题${session.limitSec ? `（冲刺 ${session.limitSec}s/题）` : ''}，还没做完</span>
          <button class="btn sm" id="btn-resume-drill">继续练习</button>
          <button class="mini" id="btn-drop-drill">放弃</button>
        </div>`;
      $('#btn-resume-drill').onclick = () => navigate(`#/types/${encodeURIComponent(session.section)}?resume=1`);
      $('#btn-drop-drill').onclick = async () => {
        await api('/practice/session', { method: 'DELETE' }).catch(() => {});
        box.innerHTML = '';
        toast('已放弃上次练习');
      };
    }
  } catch { /* 没有会话就跳过 */ }
}

function openTypePicker(section, stat) {
  const max = Math.max(1, Math.min(200, stat?.total || 200));
  const fresh = Math.max(0, (stat?.total || 0) - (stat?.practiced || 0));
  openModal({
    title: `练习：${section}`,
    sub: `共 ${stat?.total ?? '?'} 题，其中 ${fresh} 题还没刷过（会优先出这些）。`,
    body: `<div class="field">
        <label>题量</label>
        ${numberPicker({ id: 'tp-n', values: [10, 20, 30, 50], value: Math.min(20, max), min: 1, max, unit: ' 题' })}
        <div class="hint">没刷过的题不够时，会用最久没刷的题补上。</div>
      </div>
      <div class="field">
        <label>每题限时</label>
        <div class="num-picker">
          <div class="num-chips">
            <button type="button" class="num-chip active" data-for="tp-t" data-v="0">不限时</button>
            ${[30, 45, 60, 90].map((v) => `<button type="button" class="num-chip" data-for="tp-t" data-v="${v}">${v} 秒</button>`).join('')}
          </div>
          <div class="num-custom">
            <input id="tp-t" type="number" min="0" max="600" value="0" />
            <span>秒（0 = 不限时，选完限时就变成冲刺模式）</span>
          </div>
        </div>
      </div>`,
    actions: [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      {
        label: '开始',
        onClick: () => {
          const n = Math.min(max, Math.max(1, Number($('#tp-n').value) || 20));
          const t = Math.min(600, Math.max(0, Number($('#tp-t').value) || 0));
          closeModal();
          navigate(`#/types/${encodeURIComponent(section)}?n=${n}${t ? `&t=${t}` : ''}`);
        },
      },
    ],
  });
  bindNumberPicker('tp-n');
  bindNumberPicker('tp-t');
}

async function renderTypePractice(section) {
  stopTimer();
  state.view = 'type-practice';
  state.exam = null;
  const params = parseHash().params;
  const resume = params.get('resume') === '1';

  let items = [];
  let sess = null;
  let poolInfo = { unpracticed: null, total: null };

  if (resume) {
    try {
      const saved = await api('/practice/session/full');
      if (saved?.session && saved.items?.length) {
        items = saved.items;
        sess = saved.session;
      }
    } catch { /* 没有就退回新建 */ }
  }

  if (!items.length) {
    const limit = Number(params.get('n')) || 20;
    try {
      const data = await api(`/practice/questions?section=${encodeURIComponent(section)}&limit=${limit}`);
      items = data.items || [];
      poolInfo = { unpracticed: data.unpracticed, total: data.total };
    } catch (err) {
      app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}</div></div>`;
      return;
    }
  }
  if (!items.length) {
    app.innerHTML = `<div class="page"><div class="empty-state">这个题型暂时没有可用题目<br/><a href="#/types">换个题型</a></div></div>`;
    return;
  }

  const limitSec = Number(sess?.limitSec) || Number(params.get('t')) || 0;
  const results = sess?.results || {};
  let right = 0;
  let wrong = 0;
  const wrongList = [];
  for (const it of items) {
    const r = results[`${it.examId}#${it.no}`];
    if (!r) continue;
    if (r.correct) right += 1;
    else { wrong += 1; wrongList.push({ item: it, picked: r.picked }); }
  }

  state.drill = {
    section,
    items,
    idx: Math.min(Number(sess?.idx) || 0, items.length - 1),
    picked: '',
    submitted: false,
    correct: right,
    wrong,
    wrongList,
    result: { ...results },
    startAt: Date.now(),
    lastTick: Date.now(),
    elapsedMs: Number(sess?.elapsedMs) || 0,
    paused: false,
    limitSec,
    sprint: limitSec > 0,
    qStart: 0,
    finished: false,
    interval: null,
    poolUnpracticed: poolInfo.unpracticed,
    poolTotal: poolInfo.total,
  };

  app.innerHTML = `
    ${topbar({
      center: `题型练习 · ${section}${limitSec ? `（冲刺 ${limitSec}s/题）` : ''}`,
      back: '#/types',
      right: `<span class="wb-score" id="drill-score">${right} / ${right + wrong} 正确 · 共 ${items.length}</span>`,
    })}
    <div class="page">
      <div class="drill-head">
        <span id="drill-pos">${state.drill.idx + 1} / ${items.length}</span>
        <div class="sprint-track"><i id="drill-bar" style="width:${(state.drill.idx / items.length) * 100}%"></i></div>
        <span class="drill-clock" id="drill-clock">${fmtClock(Math.round(state.drill.elapsedMs / 1000))}</span>
        <button class="pause-btn" id="drill-pause" title="暂停计时">${icons.pause}</button>
        ${limitSec ? `<span class="drill-cd" id="drill-cd">${limitSec}</span>` : ''}
        <button class="mini" id="drill-reset">重置</button>
        <button class="mini" id="drill-suspend">中止</button>
      </div>
      ${poolInfo.total ? `<div class="drill-sub">该题型未刷 ${poolInfo.unpracticed ?? '?'} / 共 ${poolInfo.total} 题</div>` : ''}
      <div id="drill-card"></div>
    </div>`;

  $('#drill-pause').onclick = drillPause;
  $('#drill-reset').onclick = drillReset;
  $('#drill-suspend').onclick = drillSuspend;

  document.onkeydown = (e) => {
    if (state.view !== 'type-practice' || !state.drill || state.drill.finished) return;
    const k = e.key.toUpperCase();
    const map = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };
    const label = map[k] || (['A', 'B', 'C', 'D'].includes(k) ? k : null);
    if (!label) return;
    e.preventDefault();
    if (state.drill.submitted) { drillNext(); return; }
    drillPick(label);
  };

  state.drill.qStart = Date.now();
  if (state.drill.interval) clearInterval(state.drill.interval);
  state.drill.interval = setInterval(drillTick, 200);
  paintDrill();
  if (resume) toast(`已恢复上次练习：第 ${state.drill.idx + 1} 题`);
}

/** 计时：总计用时 + 冲刺倒计时（超时自动判错并跳下一题） */
function drillTick() {
  const d = state.drill;
  if (!d || d.finished) return;
  const now = Date.now();
  const delta = now - d.lastTick;
  d.lastTick = now;
  if (!d.paused) d.elapsedMs += delta;

  const clock = $('#drill-clock');
  if (clock) clock.textContent = fmtClock(Math.round(d.elapsedMs / 1000));

  if (d.sprint && !d.submitted) {
    const left = Math.max(0, d.limitSec * 1000 - (now - d.qStart));
    const cd = $('#drill-cd');
    if (cd) {
      cd.textContent = String(Math.ceil(left / 1000));
      cd.classList.toggle('warn', left <= d.limitSec * 250 && left > d.limitSec * 80);
      cd.classList.toggle('danger', left <= d.limitSec * 80);
    }
    if (left <= 0) {
      // 超时：按未作答记一次错，然后自动下一题
      const item = d.items[d.idx];
      d.submitted = true;
      d.wrong += 1;
      d.result[`${item.examId}#${item.no}`] = { picked: '', correct: false };
      d.wrongList.push({ item, picked: '' });
      paintDrill();
      setTimeout(() => { if (state.drill === d) drillNext(); }, 700);
    }
  }
}

function drillPause() {
  const d = state.drill;
  if (!d) return;
  d.paused = !d.paused;
  const btn = $('#drill-pause');
  if (btn) btn.innerHTML = d.paused ? icons.play : icons.pause;
  toast(d.paused ? '已暂停计时' : '继续计时');
}

function drillReset() {
  const d = state.drill;
  if (!d) return;
  openModal({
    title: '重置这次练习',
    sub: '清空本次作答并把计时归零，题目不变。已记录到题库的刷题进度不会回退。',
    body: '',
    actions: [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      {
        label: '确认重置',
        onClick: () => {
          closeModal();
          d.idx = 0;
          d.picked = '';
          d.submitted = false;
          d.correct = 0;
          d.wrong = 0;
          d.wrongList = [];
          d.result = {};
          d.elapsedMs = 0;
          d.lastTick = Date.now();
          d.qStart = Date.now();
          d.paused = false;
          const btn = $('#drill-pause');
          if (btn) btn.innerHTML = icons.pause;
          paintDrill();
          toast('已重置');
        },
      },
    ],
  });
}

/** 中止：把已答的记录进进度，再把现场存下来供「继续练习」 */
async function drillSuspend() {
  const d = state.drill;
  if (!d) return;
  const answered = Object.keys(d.result).length;
  openModal({
    title: '中止练习',
    sub: answered
      ? `已作答的 ${answered} 题会记进刷题进度（留空的不算），现场保存后可以继续。`
      : '还没有作答，中止只会保存现场，之后可以继续。',
    body: '',
    actions: [
      { label: '继续练习', cls: 'ghost', onClick: closeModal },
      {
        label: '确认中止',
        onClick: async () => {
          closeModal();
          try {
            const payload = Object.entries(d.result).map(([key, v]) => {
              const [examId, no] = key.split('#');
              return { examId, no: Number(no), picked: v.picked, correct: v.correct };
            });
            if (payload.length) {
              await api('/practice/record', { method: 'POST', body: { items: payload } });
            }
            await api('/practice/session', {
              method: 'POST',
              body: {
                section: d.section,
                items: d.items.map((x) => ({ examId: x.examId, no: x.no })),
                idx: d.idx,
                answers: {},
                results: d.result,
                elapsedMs: d.elapsedMs,
                limitSec: d.limitSec,
                mode: d.sprint ? 'sprint' : 'normal',
              },
            });
            cleanupDrill();
            navigate('#/types');
            toast('已中止，可在题型页「继续练习」');
          } catch (err) {
            toast(`中止失败：${err.message}`);
          }
        },
      },
    ],
  });
}

function cleanupDrill() {
  if (state.drill?.interval) clearInterval(state.drill.interval);
  if (state.drill) state.drill.interval = null;
  if (document.onkeydown) document.onkeydown = null;
}

function paintDrill() {
  const d = state.drill;
  const box = $('#drill-card');
  if (!box) return;
  if (d.idx >= d.items.length) { finishDrill(); return; }
  const item = d.items[d.idx];
  box.innerHTML = drillCard(item);

  box.querySelectorAll('.qopt').forEach((el) => {
    el.onclick = () => {
      if (d.submitted) return;
      drillPick(el.dataset.label);
    };
  });
  const submit = $('#drill-submit');
  if (submit) submit.onclick = drillSubmit;
  const next = $('#drill-next');
  if (next) next.onclick = drillNext;
  const exp = $('#drill-explain');
  if (exp) {
    exp.onclick = async () => {
      exp.disabled = true;
      exp.textContent = '生成中…';
      try {
        const updated = await api(
          `/exams/${encodeURIComponent(item.examId)}/questions/${item.no}/explain`,
          { method: 'POST' },
        );
        item.explanation = updated.explanation;
        paintDrill();
      } catch (err) {
        toast(`生成解析失败：${err.message}`);
        exp.disabled = false;
        exp.textContent = '生成解析';
      }
    };
  }
  const img = box.querySelector('.qfig img');
  if (img) img.onclick = () => openLightbox(img.src);

  const pos = $('#drill-pos');
  if (pos) pos.textContent = `${d.idx + 1} / ${d.items.length}`;
  const bar = $('#drill-bar');
  if (bar) bar.style.width = `${(d.idx / d.items.length) * 100}%`;
  const sc = $('#drill-score');
  if (sc) sc.textContent = `${d.correct} / ${d.correct + d.wrong} 正确 · 共 ${d.items.length}`;
  const clock = $('#drill-clock');
  if (clock) clock.textContent = fmtClock(Math.round(d.elapsedMs / 1000));
  const cd = $('#drill-cd');
  if (cd && d.sprint) {
    cd.textContent = String(d.limitSec);
    cd.classList.remove('warn', 'danger');
  }
}

function drillCard(item) {
  const d = state.drill;
  const pickedSet = new Set(canonAnswer(d.picked));
  const keySet = new Set(canonAnswer(item.answer));
  const multi = String(item.answer || '').length > 1;

  const opts = (item.options || []).map((o) => {
    const cls = ['qopt'];
    const chosen = pickedSet.has(o.label);
    const isKey = keySet.has(o.label);
    if (o.text === '') cls.push('no-text');
    if (d.submitted) {
      if (chosen && isKey) cls.push('picked', 'correct');
      else if (chosen) cls.push('picked', 'wrong');
      else if (isKey) cls.push('answer-key');
    } else if (chosen) {
      cls.push('picked');
    }
    return `<li class="${cls.join(' ')}" data-label="${esc(o.label)}">
      <span class="badge">${esc(o.label)}</span>
      <span class="qopt-text">${o.text === '' ? '见图' : esc(o.text)}</span>
    </li>`;
  }).join('');

  const figs = (item.figures || []).map((f) => f.parts.map((p) => `
    <div class="qfig"><img src="/api/media/${encodeURIComponent(item.examId)}/${encodeURIComponent(p.file)}"
      alt="配图" loading="lazy" /></div>`).join('')).join('');

  const right = d.submitted && canonAnswer(d.picked) === canonAnswer(item.answer);
  const actionRow = d.submitted
    ? `<div class="drill-actions">
         <button class="btn" id="drill-next">${d.idx + 1 >= d.items.length ? '看结果' : '下一题'}</button>
       </div>`
    : `<div class="drill-actions">
         <button class="btn" id="drill-submit" ${pickedSet.size ? '' : 'disabled'}>提交答案</button>
       </div>`;

  return `
    <article class="qcard drill-card">
      <header class="qcard-head">
        <span class="qno">${d.idx + 1}.</span>
        <span class="tag">${multi ? '多选题' : '单选题'}</span>
        <span class="chip">${esc(item.examTitle || '')}</span>
        ${item.section ? `<span class="chip">${esc(item.section)}</span>` : ''}
      </header>
      <div class="qstem">${esc(item.stem).replace(/〔图〕/g, '<span class="qmark">图</span>')}</div>
      ${figs ? `<div class="qfigs">${figs}</div>` : ''}
      <ul class="qopts">${opts}</ul>
      ${d.submitted ? `
        <div class="qanalysis">
          <div class="qa-head">
            <span class="qa-title ${right ? 'right' : 'wrong'}">${right ? '答对了' : '答错了'}</span>
            <span class="chip">你选 ${esc(d.picked || '—')}</span>
            <span class="chip green">正确答案 ${esc(item.answer)}</span>
          </div>
          <div class="qa-body ${item.explanation ? '' : 'empty'}">${esc(item.explanation || '这道题还没有解析，可以让模型现写一份。')}</div>
          ${item.explanation ? '' : '<div class="qa-foot"><button class="mini primary" id="drill-explain">生成解析</button></div>'}
        </div>` : ''}
      ${actionRow}
    </article>`;
}

function drillPick(label) {
  const d = state.drill;
  const item = d.items[d.idx];
  if (String(item.answer || '').length > 1) {
    const set = new Set(canonAnswer(d.picked));
    if (set.has(label)) set.delete(label); else set.add(label);
    d.picked = [...set].sort().join('');
  } else {
    d.picked = label;
  }
  paintDrill();
}

function drillSubmit() {
  const d = state.drill;
  if (d.submitted || !d.picked) return;
  const item = d.items[d.idx];
  d.submitted = true;
  const ok = canonAnswer(d.picked) === canonAnswer(item.answer);
  d.result[`${item.examId}#${item.no}`] = { picked: d.picked, correct: ok };
  if (ok) d.correct += 1;
  else { d.wrong += 1; d.wrongList.push({ item, picked: d.picked }); }
  paintDrill();
  // 冲刺模式不给停顿：看一眼答案就自动进下一题
  if (d.sprint) setTimeout(() => { if (state.drill === d && d.submitted) drillNext(); }, 1100);
}

function drillNext() {
  const d = state.drill;
  if (!d || d.finished) return;
  d.idx += 1;
  d.picked = '';
  d.submitted = false;
  d.qStart = Date.now();
  paintDrill();
}

function finishDrill() {
  const d = state.drill;
  if (d.finished) return;
  d.finished = true;
  cleanupDrill();
  const total = d.items.length;
  const done = d.correct + d.wrong;
  const score = done ? (d.correct / done) * 100 : 0;
  const usedSec = Math.round(d.elapsedMs / 1000);

  // 练完就把会话清掉，题型页不再提示"继续练习"
  api('/practice/session', { method: 'DELETE' }).catch(() => {});

  // 把这一组的作答回传：记刷题进度（这些题下次不再优先出），错题顺手进错题本
  const payload = Object.entries(d.result).map(([key, v]) => {
    const [examId, no] = key.split('#');
    return { examId, no: Number(no), picked: v.picked, correct: v.correct };
  });
  if (payload.length) {
    api('/practice/record', { method: 'POST', body: { items: payload } })
      .catch((err) => toast(`进度保存失败：${err.message}`));
  }

  $('#drill-card').innerHTML = `
    <div class="result-bar">
      <div class="rb-main">
        <span class="rb-score">${score.toFixed(1)}</span>
        <span class="rb-sub">分 · 答对 ${d.correct} / ${done} 题</span>
      </div>
      <div class="rb-nums">
        <span class="chip green">正确 ${d.correct}</span>
        <span class="chip red">错误 ${d.wrong}</span>
        <span class="chip blue">用时 ${fmtClock(usedSec)}</span>
        <span class="chip">题型 ${esc(d.section)}</span>
      </div>
      <div class="rb-actions">
        <button class="btn sm" id="drill-again">再来一组</button>
        <a class="btn ghost sm" href="#/types">换个题型</a>
        ${d.wrongList.length ? '<button class="btn ghost sm" id="drill-review">看错题</button>' : ''}
      </div>
    </div>
    <div id="drill-wrong"></div>`;

  $('#drill-again').onclick = () => navigate(`#/types/${encodeURIComponent(d.section)}?n=${total}`);
  const reviewBtn = $('#drill-review');
  if (reviewBtn) {
    reviewBtn.onclick = () => {
      const box = $('#drill-wrong');
      if (box.dataset.filled) { box.scrollIntoView({ behavior: 'smooth' }); return; }
      box.dataset.filled = '1';
      box.innerHTML = d.wrongList.map((w) => `
        <div class="wb-item">
          <div class="wb-head">
            <span class="wb-no">第 ${w.item.no} 题</span>
            <span class="chip">${esc(w.item.examTitle || '')}</span>
            <span class="chip">你选 ${esc(w.picked)}</span>
            <span class="chip green">答案 ${esc(w.item.answer)}</span>
            <span class="wb-actions">
              <a class="mini" href="#/exam/${encodeURIComponent(w.item.examId)}/${w.item.no}">看原题</a>
            </span>
          </div>
          <div class="wb-stem">${esc((w.item.stem || '').slice(0, 140))}</div>
        </div>`).join('');
      box.scrollIntoView({ behavior: 'smooth' });
    };
  }
  const bar = $('#drill-bar');
  if (bar) bar.style.width = '100%';
  const pos = $('#drill-pos');
  if (pos) pos.textContent = `${total} / ${total}`;
}

/* ==========================================================================
   冲刺模式：一题一屏、每题限时 60 秒、只能往前走
   ========================================================================== */
const SPRINT_LIMIT_MS = 60_000;

async function renderSprint(id) {
  stopTimer();
  state.view = 'sprint';
  let exam;
  try {
    exam = await api(`/exams/${encodeURIComponent(id)}`);
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}<br/><a href="#/">返回</a></div></div>`;
    return;
  }
  if (!exam.questions?.length) {
    app.innerHTML = `<div class="page"><div class="empty-state">这套卷还没有题目</div></div>`;
    return;
  }

  // ?n=20 只刷前 20 题；?t=45 每题 45 秒（默认 60）
  const params = parseHash().params;
  const limit = Number(params.get('n')) || 0;
  const perSec = Math.max(10, Math.min(600, Number(params.get('t')) || 60));
  // 图片题没有可点选项，冲刺里跳过
  const pool = exam.questions.filter((q) => q.kind !== 'image');
  const questions = limit > 0 ? pool.slice(0, limit) : pool;

  state.exam = exam;
  state.sprint = {
    exam,
    questions,
    idx: 0,
    answers: {},
    times: {},
    qStart: 0,
    lock: false,
    finished: false,
    totalStart: Date.now(),
    interval: null,
    limitMs: perSec * 1000,
  };

  app.innerHTML = `
    ${topbar({
      center: `冲刺模式 · ${exam.title}`,
      back: `#/exam/${encodeURIComponent(exam.id)}`,
      right: `<button class="icon-btn" id="btn-sprint-quit">${icons.close}<span>退出</span></button>`,
    })}
    <div class="page sprint-page">
      <div class="sprint-head">
        <div class="sprint-progress">
          <span id="sprint-pos">1 / ${questions.length}</span>
          <div class="sprint-track"><i id="sprint-bar"></i></div>
        </div>
        <div class="sprint-timer" id="sprint-timer">
          ${icons.clock}<b id="sprint-left">${perSec}</b><span>s</span>
        </div>
      </div>
      <div class="sprint-floor"><div class="sprint-track-time"><i id="sprint-timebar" style="width:100%"></i></div></div>
      <div id="sprint-card"></div>
      <div class="sprint-tip">每题 ${perSec} 秒，选完立刻进入下一题，不能回头改</div>
    </div>
    <div id="sprint-result"></div>
  `;

  $('#btn-sprint-quit').onclick = () => {
    if (state.sprint.finished) { navigate(`#/exam/${encodeURIComponent(exam.id)}`); return; }
    const sp = state.sprint;
    const answered = Object.values(sp.answers).filter(Boolean).length;
    openModal({
      title: '退出冲刺',
      sub: answered
        ? `已作答的 ${answered} 题会照常判分并记进错题本，作答进度也会保存，回到试卷页可以「继续做题」。`
        : '还没有作答，直接退出即可。',
      body: '',
      actions: [
        { label: '继续做题', cls: 'ghost', onClick: closeModal },
        {
          label: answered ? '保存并退出' : '退出',
          onClick: async () => {
            closeModal();
            const snap = await saveSprintProgress();
            // 快照只用来当场恢复，清掉，避免首页还挂着「继续做题」
            if (snap) {
              await api(`/exams/${encodeURIComponent(exam.id)}/suspend`, { method: 'DELETE' })
                .catch(() => { /* 清不掉不影响恢复 */ });
            }
            cleanupSprint();
            // 直接把快照交棒给试卷页，避免依赖 URL 往返
            state.resumeSnapshot = snap;
            navigate(`#/exam/${encodeURIComponent(exam.id)}`);
          },
        },
      ],
    });
  };

  // 键盘快捷作答（A-D / 1-4），冲刺模式按得快才练得出来
  document.onkeydown = (e) => {
    if (state.view !== 'sprint' || state.sprint?.finished) return;
    const k = e.key.toUpperCase();
    const map = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' };
    const label = map[k] || (['A', 'B', 'C', 'D'].includes(k) ? k : null);
    if (label) { e.preventDefault(); answerSprint(label); }
  };

  paintSprintQuestion();
  startSprintClock();

  // 冲刺中不保留旧的"答题卡/计时"状态
  saveLocal();
}

function cleanupSprint() {
  if (state.sprint?.interval) clearInterval(state.sprint.interval);
  if (state.sprint) state.sprint.interval = null;
  document.onkeydown = null;
}

/**
 * 中途退出冲刺：把已作答的题按「中止」的方式存下来
 * —— 只判已作答的题、错题进错题本、刷题进度落库，并留下中断快照供「继续做题」。
 */
async function saveSprintProgress() {
  const sp = state.sprint;
  if (!sp) return null;
  const answered = Object.keys(sp.answers).filter((k) => sp.answers[k]);
  if (!answered.length) return null;
  const usedMs = sp.elapsedMs || (Date.now() - sp.totalStart);
  try {
    await api(`/exams/${encodeURIComponent(sp.exam.id)}/suspend`, {
      method: 'POST',
      body: { answers: sp.answers, durationMs: usedMs, mode: 'sprint' },
    });
    toast(`已保存 ${answered.length} 题的作答与成绩`);
    return { answers: { ...sp.answers }, elapsedMs: usedMs };
  } catch (err) {
    toast(`保存失败：${err.message}`);
    return null;
  }
}

function paintSprintQuestion() {
  const sp = state.sprint;
  const q = sp.questions[sp.idx];
  const box = $('#sprint-card');
  if (!box || !q) return;
  box.innerHTML = sprintCard(q);
  box.querySelectorAll('.qopt').forEach((el) => {
    el.onclick = () => answerSprint(el.dataset.label);
  });
  const img = box.querySelector('.qfig img');
  if (img) img.onclick = () => openLightbox(img.src);
  const confirm = $('#sprint-confirm');
  if (confirm) confirm.onclick = () => nextSprint(false);

  const pos = $('#sprint-pos');
  if (pos) pos.textContent = `${sp.idx + 1} / ${sp.questions.length}`;
  const bar = $('#sprint-bar');
  if (bar) bar.style.width = `${((sp.idx) / sp.questions.length) * 100}%`;
}

function sprintCard(q) {
  const figs = (q.figures || []).map((f) => f.parts.map((p) => `
    <div class="qfig"><img src="/api/media/${encodeURIComponent(state.sprint.exam.id)}/${encodeURIComponent(p.file)}"
      alt="配图" loading="lazy" /></div>`).join('')).join('');
  const opts = q.options.map((o) => `
    <li class="qopt" data-label="${esc(o.label)}">
      <span class="badge">${esc(o.label)}</span>
      <span class="qopt-text">${o.text === '' ? '见图' : esc(o.text)}</span>
    </li>`).join('');
  return `
    <article class="qcard sprint-card">
      <header class="qcard-head">
        <span class="qno">${q.no}.</span>
        <span class="tag">${isMulti(q) ? '多选题' : '单选题'}</span>
        ${q.section ? `<span class="chip">${esc(q.section)}</span>` : ''}
      </header>
      <div class="qstem">${esc(q.stem).replace(/〔图〕/g, '<span class="qmark">图</span>')}</div>
      ${figs ? `<div class="qfigs">${figs}</div>` : ''}
      <ul class="qopts">${opts}</ul>
      ${isMulti(q) ? '<div class="sprint-confirm-row"><button class="btn sm" id="sprint-confirm" disabled>确定（多选题）</button></div>' : ''}
    </article>`;
}

function startSprintClock() {
  const sp = state.sprint;
  sp.qStart = Date.now();
  sp.lock = false;
  if (sp.interval) clearInterval(sp.interval);
  sp.interval = setInterval(tickSprint, 100);
  tickSprint();
}

function tickSprint() {
  const sp = state.sprint;
  if (!sp || sp.finished) return;
  const left = Math.max(0, (sp.limitMs || SPRINT_LIMIT_MS) - (Date.now() - sp.qStart));
  const sec = Math.ceil(left / 1000);
  const el = $('#sprint-left');
  if (el) el.textContent = String(sec);
  const bar = $('#sprint-timebar');
  if (bar) bar.style.width = `${(left / (sp.limitMs || SPRINT_LIMIT_MS)) * 100}%`;
  const timer = $('#sprint-timer');
  if (timer) {
    const lim = sp.limitMs || SPRINT_LIMIT_MS;
    timer.classList.toggle('warn', left <= lim * 0.25 && left > lim * 0.08);
    timer.classList.toggle('danger', left <= lim * 0.08);
  }
  if (left <= 0) nextSprint(true);
}

function answerSprint(label) {
  const sp = state.sprint;
  if (!sp || sp.lock || sp.finished) return;
  const q = sp.questions[sp.idx];

  if (isMulti(q)) {
    // 多选题：点一下切换选中，按「确定」才翻页
    const set = new Set(canonAnswer(sp.answers[q.no]));
    if (set.has(label)) set.delete(label); else set.add(label);
    sp.answers[q.no] = [...set].sort().join('');
    sp.times[q.no] = Date.now() - sp.qStart;
    const card = $('#sprint-card');
    card?.querySelectorAll('.qopt').forEach((el) => {
      el.classList.toggle('picked', set.has(el.dataset.label));
    });
    const confirm = $('#sprint-confirm');
    if (confirm) confirm.disabled = set.size === 0;
    return;
  }

  sp.lock = true;
  sp.answers[q.no] = label;
  sp.times[q.no] = Date.now() - sp.qStart;

  // 立刻在选项上给出对错反馈（450ms 后翻页）
  const card = $('#sprint-card');
  const chosen = card?.querySelector(`.qopt[data-label="${CSS.escape(label)}"]`);
  if (chosen) {
    const right = canonAnswer(label) === canonAnswer(q.answer);
    chosen.classList.add(right ? 'sprint-right' : 'sprint-wrong');
  }
  setTimeout(() => nextSprint(false), 450);
}

function nextSprint(timeout) {
  const sp = state.sprint;
  if (!sp || sp.finished) return;
  if (timeout) sp.lock = true;
  sp.idx += 1;
  if (sp.idx >= sp.questions.length) { finishSprint(); return; }
  paintSprintQuestion();
  startSprintClock();
}

async function finishSprint() {
  const sp = state.sprint;
  if (!sp || sp.finished) return;
  sp.finished = true;
  cleanupSprint();

  const qs = sp.questions;
  let correct = 0, wrong = 0, blank = 0;
  const wrongList = [];
  for (const q of qs) {
    const a = sp.answers[q.no];
    if (!a) { blank++; continue; }
    if (!q.answer) continue;
    if (canonAnswer(a) === canonAnswer(q.answer)) correct++;
    else { wrong++; wrongList.push(q); }
  }
  const answered = correct + wrong;
  const totalMs = Date.now() - sp.totalStart;
  const avg = answered ? Math.round(Object.values(sp.times).reduce((s, v) => s + v, 0) / answered) : 0;

  const bar = $('#sprint-bar');
  if (bar) bar.style.width = '100%';
  document.querySelector('.sprint-page')?.classList.add('sprint-done');
  const cardBox = $('#sprint-card');
  if (cardBox) cardBox.innerHTML = '';
  const tip = document.querySelector('.sprint-tip');
  if (tip) tip.remove();

  const slot = $('#sprint-result');
  slot.innerHTML = `
    <div class="page" style="padding-top:0">
      <div class="result-bar">
        <div class="rb-main">
          <span class="rb-score">${qs.length ? ((correct / qs.length) * 100).toFixed(1) : '0.0'}</span>
          <span class="rb-sub">分 · 答对 ${correct} / ${qs.length} 题</span>
        </div>
        <div class="rb-nums">
          <span class="chip green">正确 ${correct}</span>
          <span class="chip red">错误 ${wrong}</span>
          <span class="chip">未答（超时）${blank}</span>
          <span class="chip blue">总用时 ${fmtClock(Math.round(totalMs / 1000))}</span>
          <span class="chip blue">平均 ${(avg / 1000).toFixed(1)} 秒/题</span>
        </div>
        <div class="rb-actions">
          <button class="btn sm" id="sprint-again">再来一次</button>
          <button class="btn ghost sm" id="sprint-review">看错题（${wrongList.length}）</button>
          <a class="btn ghost sm" href="#/exam/${encodeURIComponent(sp.exam.id)}">回到普通模式</a>
        </div>
      </div>
      <div id="sprint-wrong"></div>
    </div>`;

  $('#sprint-again').onclick = () => {
    const totalAll = sp.exam.questions?.length || 0;
    const qs = [];
    if (sp.questions.length < totalAll) qs.push(`n=${sp.questions.length}`);
    const t = Math.round((sp.limitMs || SPRINT_LIMIT_MS) / 1000);
    if (t !== 60) qs.push(`t=${t}`);
    navigate(`#/sprint/${encodeURIComponent(sp.exam.id)}${qs.length ? `?${qs.join('&')}` : ''}`);
  };
  $('#sprint-review').onclick = () => {
    const box = $('#sprint-wrong');
    if (!box) return;
    if (box.dataset.filled) { box.scrollIntoView({ behavior: 'smooth' }); return; }
    box.dataset.filled = '1';
    box.innerHTML = wrongList.length
      ? wrongList.map((q) => `
        <div class="wb-item">
          <div class="wb-head">
            <span class="wb-no">第 ${q.no} 题</span>
            ${q.section ? `<span class="chip">${esc(q.section)}</span>` : ''}
            <span class="chip">你选 ${esc(sp.answers[q.no] || '—')}</span>
            <span class="chip green">答案 ${esc(q.answer || '待补')}</span>
            <span class="wb-actions">
              <a class="mini" href="#/exam/${encodeURIComponent(sp.exam.id)}/${q.no}">看原题</a>
            </span>
          </div>
          <div class="wb-stem">${esc((q.stem || '').slice(0, 140))}</div>
        </div>`).join('')
      : '<div class="empty-state">没有错题，漂亮 👏</div>';
    box.scrollIntoView({ behavior: 'smooth' });
  };

  // 记录成绩并进错题本
  try {
    await api(`/exams/${encodeURIComponent(sp.exam.id)}/attempts`, {
      method: 'POST',
      body: {
        answers: sp.answers,
        durationMs: totalMs,
        pausedMs: 0,
        mode: 'sprint',
        questionNos: qs.map((q) => q.no),
      },
    });
  } catch (err) {
    toast(`保存成绩失败：${err.message}`);
  }
}

/* ==========================================================================
   答题页
   ========================================================================== */
async function renderExam(id) {
  stopTimer();
  state.view = 'exam';
  let exam;
  try {
    exam = await api(`/exams/${encodeURIComponent(id)}`);
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}<br/><a href="#/">返回题库</a></div></div>`;
    return;
  }
  // 还在解析中
  if (!exam.questions?.length) {
    app.innerHTML = `<div class="page"><div class="empty-state">题库还在解析中…<br/><a href="#/">返回题库</a></div></div>`;
    return;
  }

  const local = loadLocal(exam.id);
  state.exam = exam;
  state.answers = local.answers || {};
  state.marks = local.marks || {};
  state.notes = local.notes || {};
  state.graded = Boolean(local.graded);
  state.elapsed = Number(local.elapsed) || 0;
  state.paused = false;
  state.lastAttempt = exam.attempts?.[0] || null;

  // 「继续做题」：优先用冲刺退出时直接交过来的快照，其次用服务端保存的中断快照
  const handoff = state.resumeSnapshot;
  state.resumeSnapshot = null;
  const wantResume = parseHash().params.get('resume') === '1';
  if (handoff) {
    state.answers = { ...(handoff.answers || {}) };
    state.elapsed = Math.round((Number(handoff.elapsedMs) || 0) / 1000);
    state.graded = false;
    saveLocal();
    const n = Object.values(state.answers).filter(Boolean).length;
    setTimeout(() => toast(`已恢复到上次进度（已答 ${n} 题）`), 300);
  } else if (wantResume && exam.suspended) {
    const sus = exam.suspended;
    state.answers = { ...(sus.answers || {}) };
    state.elapsed = Math.round((Number(sus.elapsedMs) || 0) / 1000);
    state.graded = false;
    saveLocal();
    api(`/exams/${encodeURIComponent(exam.id)}/suspend`, { method: 'DELETE' })
      .catch(() => { /* 清不掉也不影响继续做题 */ });
    const n = Object.values(state.answers).filter(Boolean).length;
    setTimeout(() => toast(`已恢复到上次进度（已答 ${n} 题）`), 300);
  }

  // 「复盘」：按某条历史记录还原当时的作答并直接判分
  const attemptId = parseHash().params.get('attempt');
  state.reviewAttempt = null;
  if (attemptId) {
    const a = (exam.attempts || []).find((x) => x.id === attemptId);
    if (a) {
      state.reviewAttempt = a;
      state.answers = { ...(a.answers || {}) };
      state.graded = true;
      state.paused = true;
      state.elapsed = Math.round((a.durationMs || 0) / 1000);
    }
  }

  const total = exam.questions.length;
  const answered = Object.keys(state.answers).filter((k) => state.answers[k]).length;

  // 换卷下拉需要别的试卷列表；错题范围要知道本卷哪些题在错题本里
  try {
    const [list, wb] = await Promise.all([api('/exams'), api('/wrongbook')]);
    state.examList = list.exams || [];
    const cat = new Set();
    for (const it of wb.items || []) if (it.examId === exam.id) cat.add(it.no);
    state.wrongNos = cat;
  } catch {
    state.examList = [];
    state.wrongNos = new Set();
  }
  state.scope = 'all';

  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <a class="icon-btn back-btn" href="#/" title="返回题库">${icons.back}</a>
        <div class="timer" id="timer">${icons.clock}<span id="clock">00:00</span></div>
        <button class="pause-btn" id="btn-pause" title="暂停计时">${icons.pause}</button>
        <select class="exam-switch" id="exam-switch" title="切换试卷">
          ${(state.examList.length ? state.examList : [{ id: exam.id, title: exam.title }])
            .map((e) => `<option value="${esc(e.id)}" ${e.id === exam.id ? 'selected' : ''}>${esc(e.title)}</option>`)
            .join('')}
        </select>
      </div>
      <div class="topbar-center">${esc(exam.title)}</div>
      <div class="topbar-right">
        <button class="icon-btn" id="btn-sprint" title="冲刺模式：一题一屏，每题 60 秒">${icons.flash}<span>冲刺</span></button>
        <button class="icon-btn" id="btn-reset" title="清空作答并归零计时">${icons.refresh}<span>重置</span></button>
        <button class="icon-btn" id="btn-settings">${icons.gear}<span>设置</span></button>
        <button class="icon-btn" id="btn-download">${icons.download}<span>下载</span></button>
        <button class="icon-btn" id="btn-suspend" title="只提交已做的题，之后可继续">${icons.pauseCircle}<span>中止</span></button>
        <button class="icon-btn" id="btn-submit">${icons.submit}<span>交卷</span></button>
      </div>
    </div>
    <div class="page" id="page">
      <div id="review-slot"></div>
      <div id="result-slot"></div>
      <div id="repair-slot"></div>
      <div class="section-card">
        <h1>综合知识 <span>（${total}题）</span>
          ${exam.officialAnswers
            ? `<span class="chip green" style="margin-left:10px;vertical-align:2px">答案：粉笔官方解析</span>`
            : `<span class="chip orange" style="margin-left:10px;vertical-align:2px">答案由模型生成，仅供参考</span>`}
        </h1>
        <p>请根据题目要求，在四个选项中选出一个最恰当的答案。</p>
      </div>
      <div class="scope-bar" id="scope-bar"></div>
      <div id="cards"></div>
    </div>
    <button class="sheet-toggle" id="sheet-toggle">
      <b>答题卡</b><span id="sheet-count">${answered}/${total}</span>
    </button>
    <div class="sheet-mask" id="sheet-mask"></div>
    <aside class="sheet" id="sheet">
      <div class="sheet-head">
        <h2>答题卡</h2>
        <button class="icon-btn close" id="sheet-close">${icons.close}</button>
      </div>
      <div class="sheet-legend" id="sheet-legend"></div>
      <div class="sheet-body" id="sheet-body"></div>
      <div class="sheet-foot">
        <button class="btn block" id="sheet-submit">交卷</button>
      </div>
    </aside>
  `;

  renderScopeBar();
  renderCards();
  renderSheet();
  renderResult();
  renderRepairBanner();
  renderReviewBanner();
  startTimer();

  $('#exam-switch').onchange = (e) => {
    const next = e.target.value;
    if (next && next !== exam.id) navigate(`#/exam/${encodeURIComponent(next)}`);
  };
  $('#btn-sprint').onclick = openSprintPicker;
  $('#btn-reset').onclick = confirmResetExam;

  $('#btn-settings').onclick = openSettings;
  $('#btn-download').onclick = () => {
    location.href = `/api/exams/${encodeURIComponent(exam.id)}/export`;
  };
  $('#btn-submit').onclick = () => confirmSubmit();
  $('#btn-suspend').onclick = confirmSuspend;
  $('#sheet-submit').onclick = () => confirmSubmit();
  $('#btn-pause').onclick = togglePause;
  $('#sheet-toggle').onclick = openSheet;
  $('#sheet-close').onclick = closeSheet;
  $('#sheet-mask').onclick = closeSheet;

  bindCards();

  // 深链接：#/exam/<id>/<题号> 直接跳到该题
  const jump = parseHash().q;
  if (jump) {
    // 浏览器对 hash 导航会做滚动位置恢复，延后一帧再跳，免得被它覆盖
    setTimeout(() => {
      const card = $(`#q-${jump}`);
      if (!card) return;
      card.scrollIntoView({ block: 'start' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1600);
    }, 150);
  }
}

/* ------------------------------------------------------------------ 练习范围 */
const SCOPES = [
  ['all', '全部'],
  ['undone', '未做'],
  ['wrong', '错题'],
  ['marked', '标记'],
];

function visibleQuestions() {
  const qs = state.exam?.questions || [];
  switch (state.scope) {
    case 'undone': return qs.filter((q) => !state.answers[q.no]);
    case 'wrong': return qs.filter((q) => state.wrongNos?.has(q.no));
    case 'marked': return qs.filter((q) => state.marks[q.no]);
    default: return qs;
  }
}

function scopeCount(key) {
  const qs = state.exam?.questions || [];
  if (key === 'undone') return qs.filter((q) => !state.answers[q.no]).length;
  if (key === 'wrong') return qs.filter((q) => state.wrongNos?.has(q.no)).length;
  if (key === 'marked') return qs.filter((q) => state.marks[q.no]).length;
  return qs.length;
}

function renderScopeBar() {
  const el = $('#scope-bar');
  if (!el) return;
  el.innerHTML = `
    <span class="scope-label">练习范围</span>
    ${SCOPES.map(([k, label]) => `
      <button class="scope-chip ${state.scope === k ? 'active' : ''}" data-scope="${k}">
        ${label}<i>${scopeCount(k)}</i>
      </button>`).join('')}
    <span class="scope-hint" id="scope-hint"></span>`;
  el.querySelectorAll('[data-scope]').forEach((b) => {
    b.onclick = () => {
      state.scope = b.dataset.scope;
      renderScopeBar();
      renderCards();
      renderSheet();
      const n = visibleQuestions().length;
      const hint = $('#scope-hint');
      if (hint) hint.textContent = n ? `当前显示 ${n} 题` : '这个范围里没有题目';
    };
  });
}

/* ------------------------------------------------------------------ 题卡 */
const canonAnswer = (s) => [...String(s || '').toUpperCase().replace(/[^A-H]/g, '')].sort().join('');
const isMulti = (q) => String(q.answer || '').length > 1;

function renderCards() {
  const wrap = $('#cards');
  if (!wrap) return;
  const qs = visibleQuestions();
  if (!qs.length) {
    wrap.innerHTML = `<div class="empty-state">这个范围里没有题目<br/>
      <button class="mini" id="scope-reset">显示全部</button></div>`;
    const reset = $('#scope-reset');
    if (reset) reset.onclick = () => { state.scope = 'all'; renderScopeBar(); renderCards(); renderSheet(); };
    return;
  }
  wrap.innerHTML = qs.map((q) => questionCard(q)).join('');
}

function questionCard(q, examIdOverride) {
  const picked = state.answers[q.no] || '';
  const pickedSet = new Set(canonAnswer(picked));
  const graded = state.graded;
  const key = q.answer || '';
  const keySet = new Set(canonAnswer(key));
  const multi = isMulti(q);
  const isRight = graded && picked && key && canonAnswer(picked) === canonAnswer(key);
  const mediaId = examIdOverride || state.exam.id;

  const opts = q.options.map((o) => {
    const cls = ['qopt'];
    const chosen = pickedSet.has(o.label);
    const isKey = keySet.has(o.label);
    if (o.text === '') cls.push('no-text');
    if (graded) {
      if (chosen && isKey) cls.push('picked', 'correct');
      else if (chosen) cls.push('picked', 'wrong');
      else if (isKey) cls.push('answer-key');
    } else if (chosen) {
      cls.push('picked');
    }
    const label = o.text === '' ? '见图' : esc(o.text);
    return `<li class="${cls.join(' ')}" data-label="${esc(o.label)}">
      <span class="badge">${esc(o.label)}</span>
      <span class="qopt-text">${label}</span>
    </li>`;
  }).join('');

  const figs = (q.figures || []).map((f) => f.parts.map((p) => `
    <div class="qfig ${p.h > p.w ? 'tall' : ''}">
      <img src="/api/media/${encodeURIComponent(mediaId)}/${encodeURIComponent(p.file)}"
           alt="第${q.no}题配图" loading="lazy" />
    </div>`).join('')).join('');

  const marked = state.marks[q.no];
  const note = state.notes[q.no] || '';
  // 图片题：题干与选项都是一张截图，本地只有「(本题题干与选项为一张截图)」这句占位说明
  const isImage = q.kind === 'image';
  const stem = isImage ? '' : esc(q.stem).replace(/〔图〕/g, '<span class="qmark">图</span>');
  const isEssay = !isImage && (q.kind === 'essay' || !(q.options || []).length);

  const essayBox = isEssay ? `
    <div class="essay-box">
      <div class="essay-label">参考答案</div>
      <div class="essay-text">${esc(q.answerText || '原卷未给参考答案，可参考下方解析。')}</div>
    </div>` : '';

  const imageHint = isImage ? `
    <div class="essay-box">
      <div class="essay-label">图片题</div>
      <div class="essay-text">题干与选项都在这张截图里，本地无法拆出可点的 ABCD，因此本题只作阅读，不参与判分。</div>
    </div>` : '';

  return `
  <article class="qcard ${graded ? 'graded' : ''}" data-no="${q.no}" id="q-${q.no}">
    <header class="qcard-head">
      <span class="qno">${q.no}.</span>
      <span class="tag">${isImage ? '图片题' : isEssay ? '论述题' : (multi ? '多选题' : '单选题')}</span>
      ${q.section ? `<span class="chip">${esc(q.section)}</span>` : ''}
      ${q.answerSource === 'fenbi' ? '<span class="chip green">官方答案</span>' : ''}
      <span class="qcard-tools">
        <button class="tool-btn ${marked ? 'active' : ''}" data-act="mark" title="标记">${marked ? icons.starFill : icons.star}</button>
        <button class="tool-btn" data-act="note" title="笔记">${icons.pencil}</button>
      </span>
    </header>
    ${stem ? `<div class="qstem">${stem}</div>` : ''}
    ${figs ? `<div class="qfigs">${figs}</div>` : ''}
    ${isImage ? imageHint : isEssay ? essayBox : `<ul class="qopts">${opts}</ul>`}
    ${analysisBlock(q, isRight, picked, key)}
    <div class="qnote-wrap" ${note ? '' : 'hidden'}>
      <textarea class="qnote" placeholder="写点什么，帮助自己记住这道题…">${esc(note)}</textarea>
    </div>
  </article>`;
}

function analysisBlock(q, isRight, picked, key) {
  const isImage = q.kind === 'image';
  // 图片题没有可点的选项，直接展开阅读
  const show = state.graded || isImage;
  const confMap = { high: ['高置信', 'green'], medium: ['中等置信', 'blue'], low: ['低置信', ''], };
  const conf = confMap[q.confidence] || ['未标注', ''];
  const sourceMap = {
    llm: '模型推理', vision: '视觉模型', manual: '人工修订', failed: '解析失败',
    fenbi: '粉笔答案',
  };
  const official = q.answerSource === 'fenbi';
  const isEssay = !isImage && (q.kind === 'essay' || !(q.options || []).length);
  const src = sourceMap[q.answerSource] || '未标注';
  const verdict = isImage ? '仅阅读' : !picked ? '未作答' : !key ? '待定' : (isRight ? '回答正确' : '回答错误');
  const verdictCls = !picked ? '' : !key ? 'orange' : (isRight ? 'green' : 'red');
  // 官方答案就只标来源，不再显示"置信度"（容易让人以为还是模型猜的）
  const qualityChips = isImage
    ? `<span class="chip green">粉笔标准答案</span>
       <span class="chip">${q.explanationSource === 'fenbi' ? '粉笔官方解析' : '解析由模型生成'}</span>`
    : isEssay
      ? `<span class="chip">论述题 · 参考作答</span>
         <span class="chip">${q.explanationSource === 'fenbi' ? '粉笔官方解析' : '解析由模型生成'}</span>`
      : official
        ? `<span class="chip green">粉笔标准答案</span>
           <span class="chip">${q.explanationSource === 'fenbi' ? '粉笔官方解析' : '解析由模型生成'}</span>`
        : `<span class="chip ${conf[1]}">${conf[0]}</span><span class="chip">${esc(src)}</span>`;
  const keypointChip = (q.keypoints || []).length
    ? `<span class="chip blue">考点 ${esc(q.keypoints.slice(0, 2).join(' / '))}</span>`
    : '';
  const footNote = isEssay
    ? (q.explanationSource === 'fenbi' ? '答案与解析均来自粉笔解析页' : '解析由本地模型生成')
    : official
      ? (q.explanationSource === 'fenbi'
        ? '答案与解析均来自粉笔解析页'
        : '答案来自粉笔官方解析，解析文字由本地模型按该答案撰写')
      : '答案由本地模型生成，可能出错，可手动修订';
  const needExplain = !q.explanation && q.answer;

  return `
  <div class="qanalysis ${show ? '' : 'hidden'}" data-analysis>
    <div class="qa-head">
      <span class="qa-title ${isImage ? '' : isRight ? 'right' : (picked && !isRight ? 'wrong' : '')}">${verdict}</span>
      ${isImage ? '' : `<span class="chip ${verdictCls}">${picked ? `你的答案 ${esc(picked)}` : '你的答案 —'}</span>`}
      <span class="chip green">正确答案 ${key ? esc(key) : (q.answerText ? '见参考答案' : '待补')}</span>
      ${qualityChips}
      ${keypointChip}
    </div>
    <div class="qa-body ${q.explanation ? '' : 'empty'}">${esc(q.explanation || (needExplain ? '这道题还没有解析，可以让模型现写一份。' : '（暂无解析）'))}</div>
    <div class="qa-foot">
      <span>${footNote}</span>
      ${needExplain ? '<button class="mini primary" data-act="explain">生成解析</button>' : ''}
      <a class="mini" href="#/edit/${encodeURIComponent(state.exam.id)}/${q.no}" data-act="edit">编辑本题</a>
      <button class="mini" data-act="fix">修订答案</button>
      <button class="mini" data-act="reanalyze">重新解析</button>
      <button class="mini" data-act="wrongbook">加入错题</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ 题目编辑 */
async function renderEditor(examId, no) {
  stopTimer();
  state.view = 'edit';
  let exam;
  try {
    exam = await api(`/exams/${encodeURIComponent(examId)}`);
  } catch (err) {
    app.innerHTML = `<div class="page"><div class="empty-state">加载失败：${esc(err.message)}</div></div>`;
    return;
  }
  state.exam = exam;
  const q = exam.questions.find((x) => x.no === Number(no));
  if (!q) {
    app.innerHTML = `<div class="page"><div class="empty-state">题目不存在</div></div>`;
    return;
  }
  const nos = exam.questions.map((x) => x.no);
  const at = nos.indexOf(q.no);
  const prev = at > 0 ? nos[at - 1] : null;
  const next = at >= 0 && at < nos.length - 1 ? nos[at + 1] : null;
  const page = q.page || 1;
  const sections = [...new Set(exam.questions.map((x) => x.section).filter(Boolean))];
  const opts = q.options || [];
  const isEssay = q.kind === 'essay' || (!opts.length && q.kind !== 'image');

  const optFields = [0, 1, 2, 3].map((i) => {
    const o = opts[i];
    return `<div class="edit-opt">
      <span class="badge">${'ABCD'[i]}</span>
      <input id="e-opt-${i}" value="${esc(o ? o.text : '')}" placeholder="选项 ${'ABCD'[i]} 内容" />
    </div>`;
  }).join('');

  app.innerHTML = `
    ${topbar({
      center: `编辑 · 第 ${q.no} 题`,
      back: `#/exam/${encodeURIComponent(exam.id)}/${q.no}`,
      right: `<a class="icon-btn" href="#/exam/${encodeURIComponent(exam.id)}/${prev ?? q.no}" title="上一题">${icons.back}</a>
              <a class="icon-btn" href="#/exam/${encodeURIComponent(exam.id)}/${next ?? q.no}" title="下一题">${icons.next}</a>
              <button class="icon-btn" id="e-save" title="保存">${icons.submit}<span>保存</span></button>`,
    })}
    <div class="page">
      <div class="edit-head">
        <div>
          <h1>第 ${q.no} 题</h1>
          <div class="edit-meta">
            <span class="chip">${esc(exam.title)}</span>
            <span class="chip">原卷第 ${page} 页</span>
            ${q.editedAt ? `<span class="chip orange">已于 ${new Date(q.editedAt).toLocaleString('zh-CN', { hour12: false })} 手工修订</span>` : ''}
          </div>
        </div>
        <div class="edit-actions">
          <button class="btn ghost sm" id="e-reload">放弃修改</button>
          <button class="btn sm" id="e-save2">保存修改</button>
        </div>
      </div>

      <div class="edit-wrap">
        <div class="edit-form">
          <div class="edit-row2">
            <div class="field">
              <label>题型</label>
              <select id="e-kind">
                ${[['text', '单选题'], ['figure', '图形题'], ['essay', '论述题'], ['image', '图片题']]
    .map(([v, t]) => `<option value="${v}" ${q.kind === v ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>分类</label>
              <input id="e-section" list="e-sections" value="${esc(q.section || '')}" />
              <datalist id="e-sections">${sections.map((s) => `<option value="${esc(s)}"></option>`).join('')}</datalist>
            </div>
          </div>

          <div class="field">
            <label>题干</label>
            <textarea id="e-stem" rows="6" placeholder="题干文字">${esc(q.stem || '')}</textarea>
            <div class="hint">〔图〕是配图占位标记，保留它会在这里显示对应图片。</div>
          </div>

          <div class="field">
            <label>选项</label>
            <div class="edit-opts">${optFields}</div>
          </div>

          <div class="edit-row2">
            <div class="field">
              <label>正确答案</label>
              <input id="e-answer" value="${esc(q.answer || '')}" placeholder="如 A 或 AD" />
            </div>
            <div class="field">
              <label>考点</label>
              <input id="e-keypoints" value="${esc((q.keypoints || []).join(' / '))}" placeholder="用 / 或 , 分隔" />
            </div>
          </div>

          <div class="field">
            <label>解析</label>
            <textarea id="e-expl" rows="10" placeholder="解析正文">${esc(q.explanation || '')}</textarea>
          </div>

          ${isEssay ? `<div class="field">
            <label>参考答案（论述题）</label>
            <textarea id="e-answertext" rows="3">${esc(q.answerText || '')}</textarea>
          </div>` : ''}
        </div>

        <div class="edit-pdf">
          <div class="edit-pdf-head">
            <span>原卷对照</span>
            <button class="mini" id="pdf-prev">←</button>
            <input id="pdf-page" type="number" min="1" value="${page}" />
            <button class="mini" id="pdf-next">→</button>
            <button class="mini" id="pdf-go">跳转</button>
            <a class="mini" id="pdf-open" target="_blank" rel="noopener">打开 PDF</a>
          </div>
          <div class="edit-pdf-body">
            <img id="pdf-img" alt="原卷第 ${page} 页" />
            <div class="edit-pdf-tip" id="pdf-tip" hidden></div>
          </div>
        </div>
      </div>
    </div>`;

  const pdfUrl = (p) => `/api/exams/${encodeURIComponent(exam.id)}/pdf#page=${p}`;
  const pageImg = (p) => `/api/exams/${encodeURIComponent(exam.id)}/page/${p}.png?v=2`;
  const img = $('#pdf-img');
  const tip = $('#pdf-tip');
  const showPage = (p) => {
    const n = Math.max(1, Number(p) || 1);
    $('#pdf-page').value = n;
    tip.hidden = true;
    img.hidden = false;
    img.src = pageImg(n);
    $('#pdf-open').href = pdfUrl(n);
  };
  img.onerror = () => {
    img.hidden = true;
    tip.hidden = false;
    tip.textContent = '这一页渲染不出来（可能超出卷面页数），可以点「打开 PDF」看原文件。';
  };
  showPage(page);
  $('#pdf-open').href = pdfUrl(page);
  $('#pdf-prev').onclick = () => showPage(Number($('#pdf-page').value) - 1);
  $('#pdf-next').onclick = () => showPage(Number($('#pdf-page').value) + 1);
  $('#pdf-go').onclick = () => showPage($('#pdf-page').value);
  $('#pdf-page').onkeydown = (e) => { if (e.key === 'Enter') showPage($('#pdf-page').value); };

  const collect = () => ({
    kind: $('#e-kind').value,
    section: $('#e-section').value.trim(),
    stem: $('#e-stem').value,
    options: [0, 1, 2, 3].map((i) => $(`#e-opt-${i}`).value),
    answer: $('#e-answer').value.trim().toUpperCase(),
    keypoints: $('#e-keypoints').value,
    explanation: $('#e-expl').value,
    ...(isEssay ? { answerText: $('#e-answertext').value } : {}),
  });

  const save = async () => {
    const body = collect();
    // 选项清空到只剩一两项时保留原样，避免把图题误删
    if (!body.options.some((t) => t.trim())) delete body.options;
    try {
      await api(`/exams/${encodeURIComponent(exam.id)}/questions/${q.no}`, { method: 'PATCH', body });
      toast('已保存');
      navigate(`#/exam/${encodeURIComponent(exam.id)}/${q.no}`);
    } catch (err) {
      toast(`保存失败：${err.message}`);
    }
  };
  $('#e-save').onclick = save;
  $('#e-save2').onclick = save;
  $('#e-reload').onclick = () => {
    if (confirm('放弃本次修改？')) navigate(`#/exam/${encodeURIComponent(exam.id)}/${q.no}`);
  };
  document.onkeydown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
}

/* ------------------------------------------------------------------ 题卡事件 */
function bindCards() {
  const wrap = $('#cards');
  wrap.addEventListener('click', async (e) => {
    const card = e.target.closest('.qcard');
    if (!card) return;
    const no = Number(card.dataset.no);
    const q = state.exam.questions.find((x) => x.no === no);

    const opt = e.target.closest('.qopt');
    if (opt && !state.graded) {
      selectOption(no, opt.dataset.label);
      return;
    }

    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'mark') toggleMark(no);
      else if (act === 'note') card.querySelector('.qnote-wrap').toggleAttribute('hidden');
      else if (act === 'fix') promptFixAnswer(q);
      else if (act === 'reanalyze') reanalyze(q);
      else if (act === 'explain') explainOnly(q, actBtn);
      else if (act === 'wrongbook') markWrong(no);
      return;
    }

    const img = e.target.closest('.qfig img');
    if (img) openLightbox(img.src);
  });

  wrap.addEventListener('input', (e) => {
    const ta = e.target.closest('.qnote');
    if (!ta) return;
    const no = Number(ta.closest('.qcard').dataset.no);
    state.notes[no] = ta.value;
    saveLocal();
  });
}

function isCorrect(q) {
  const picked = state.answers[q.no];
  return Boolean(picked && q.answer && canonAnswer(picked) === canonAnswer(q.answer));
}

function selectOption(no, label) {
  const q = state.exam.questions.find((x) => x.no === no);
  if (q && isMulti(q)) {
    // 多选题：点一下切换选中，答案按字母排序存
    const cur = new Set(canonAnswer(state.answers[no]));
    if (cur.has(label)) cur.delete(label);
    else cur.add(label);
    state.answers[no] = [...cur].sort().join('');
  } else {
    state.answers[no] = label;
  }
  saveLocal();
  const card = $(`#q-${no}`);
  if (card) {
    card.outerHTML = questionCard(q);
    bindCardInner();
  }
  renderSheet();
  updateSheetCount();
}

// innerHTML 整体替换后需要重新挂载图片/文本框的局部事件（事件委托在 #cards 上，故只需保持 DOM 一致）
function bindCardInner() { /* 事件委托已覆盖，无需额外绑定 */ }

function markWrong(no) {
  if (state.marks[no]) { toast('这道题已经标记过了'); return; }
  state.marks[no] = true;
  saveLocal();
  const q = state.exam.questions.find((x) => x.no === no);
  const card = $(`#q-${no}`);
  if (card) card.outerHTML = questionCard(q);
  renderSheet();
  toast(isCorrect(q) ? '这题你答对了，仍已标记' : '已标记为错题');
}

function toggleMark(no) {
  state.marks[no] = !state.marks[no];
  saveLocal();
  const q = state.exam.questions.find((x) => x.no === no);
  const card = $(`#q-${no}`);
  if (card) card.outerHTML = questionCard(q);
  renderSheet();
}

/* ------------------------------------------------------------------ 答题卡 */
function renderSheet() {
  const body = $('#sheet-body');
  if (!body) return;
  const groups = new Map();
  for (const q of state.exam.questions) {
    const key = q.section || '未分类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }
  body.innerHTML = [...groups.entries()].map(([name, qs]) => `
    <div class="sheet-group">
      <h3>${esc(name)}（${qs.length}）</h3>
      <div class="sheet-grid">
        ${qs.map((q) => {
          const cls = ['sheet-cell'];
          const picked = state.answers[q.no];
          if (state.graded) {
            if (picked && q.answer) cls.push(canonAnswer(picked) === canonAnswer(q.answer) ? 'correct' : 'wrong');
            else if (picked) cls.push('answered');
          } else if (picked) cls.push('answered');
          if (state.marks[q.no]) cls.push('marked');
          return `<button class="${cls.join(' ')}" data-goto="${q.no}">${q.no}</button>`;
        }).join('')}
      </div>
    </div>`).join('');

  body.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = () => {
      closeSheet();
      let card = $(`#q-${b.dataset.goto}`);
      if (!card) {
        // 目标题不在当前练习范围里：切回"全部"再定位
        state.scope = 'all';
        renderScopeBar();
        renderCards();
        renderSheet();
        card = $(`#q-${b.dataset.goto}`);
      }
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        card.classList.add('flash');
        setTimeout(() => card.classList.remove('flash'), 1300);
      }
    };
  });

  const legend = $('#sheet-legend');
  if (legend) {
    legend.innerHTML = state.graded
      ? '<span><i style="background:#eef4ff;border:1px solid #2f7bf6"></i>正确</span><span><i style="background:#fff1f1;border:1px solid #e5484d"></i>错误</span><span><i style="background:#fff;border:1px solid #e6eaf1"></i>未答</span><span><i style="background:#f0872a"></i>标记</span>'
      : '<span><i style="background:#eef4ff;border:1px solid #2f7bf6"></i>已答</span><span><i style="background:#fff;border:1px solid #e6eaf1"></i>未答</span><span><i style="background:#f0872a"></i>标记</span>';
  }
  updateSheetCount();
}

function updateSheetCount() {  const el = $('#sheet-count');
  if (!el) return;
  const answered = Object.values(state.answers).filter(Boolean).length;
  el.textContent = `${answered}/${state.exam.questions.length}`;
}

const openSheet = () => { $('#sheet').classList.add('open'); $('#sheet-mask').classList.add('open'); };
const closeSheet = () => { $('#sheet').classList.remove('open'); $('#sheet-mask').classList.remove('open'); };

/* ------------------------------------------------------------------ 复盘横幅 */
function renderReviewBanner() {
  const slot = $('#review-slot');
  if (!slot) return;
  const a = state.reviewAttempt;
  if (!a) { slot.innerHTML = ''; return; }
  const [modeText] = MODE_LABEL[a.mode] || [a.mode || '整卷交卷'];
  const when = a.at ? new Date(a.at).toLocaleString('zh-CN', { hour12: false }) : '';
  slot.innerHTML = `
    <div class="notice">
      <span>正在复盘 <b>${esc(when)}</b> 的那次「${esc(modeText)}」记录（${a.correct} / ${a.total}）</span>
      <button class="btn sm" id="btn-exit-review">退出复盘，重新做这套</button>
    </div>`;
  $('#btn-exit-review').onclick = () => {
    state.reviewAttempt = null;
    state.graded = false;
    state.paused = false;
    state.answers = {};
    state.elapsed = 0;
    saveLocal();
    renderExam(state.exam.id);
  };
}

/* ------------------------------------------------------------------ 补全答案 */
function renderRepairBanner() {
  const slot = $('#repair-slot');
  if (!slot) return;
  // 论述题本来就没有 ABCD 答案，不算"缺答案"
  const missing = (state.exam?.questions || [])
    .filter((q) => !q.answer && q.kind !== 'essay')
    .map((q) => q.no);
  if (!missing.length) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <div class="notice">
      <span>还有 ${missing.length} 道题没有拿到答案（${missing.slice(0, 10).join('、')}${missing.length > 10 ? ' …' : ''}）</span>
      <button class="btn sm" id="btn-repair">补全答案</button>
      <span class="notice-hint" id="repair-state">也可以点进题目手动修订</span>
    </div>`;
  const btn = $('#btn-repair');
  if (btn) btn.onclick = doRepair;
}

async function doRepair() {
  const btn = $('#btn-repair');
  const note = $('#repair-state');
  if (btn) { btn.disabled = true; btn.textContent = '补全中…'; }
  try {
    const res = await api(`/exams/${encodeURIComponent(state.exam.id)}/repair`, { method: 'POST' });
    if (note) note.textContent = `开始补全 ${res.missing || 0} 道题，可能需要一两分钟`;
    clearInterval(state.poll);
    state.poll = setInterval(async () => {
      try {
        const job = await api(`/exams/${encodeURIComponent(state.exam.id)}/job`);
        if (note && job.total) note.textContent = `${job.stage || ''} ${job.done || 0}/${job.total}`;
        if (job.status === 'ready') {
          clearInterval(state.poll);
          state.poll = null;
          toast('补全完成');
          await renderExam(state.exam.id);
        } else if (job.status === 'error') {
          clearInterval(state.poll);
          state.poll = null;
          toast(`补全失败：${job.message || ''}`);
          if (btn) { btn.disabled = false; btn.textContent = '补全答案'; }
        }
      } catch { /* 忽略瞬时错误 */ }
    }, 1500);
  } catch (err) {
    toast(`补全失败：${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '补全答案'; }
  }
}

/* ------------------------------------------------------------------ 重置作答 */
function openSprintPicker() {
  if (!state.exam) return;
  const total = state.exam.questions.length;
  const startN = Math.min(20, total);
  openModal({
    title: '冲刺模式',
    sub: `一题一屏、每题限时，选完立刻进入下一题且不能回改。本卷共 ${total} 题。`,
    body: `
      <div class="field">
        <label>做多少题</label>
        ${numberPicker({ id: 'sp-n', values: [10, 20, 40, total], value: startN, min: 1, max: total, unit: ' 题' })}
      </div>
      <div class="field">
        <label>每题限时</label>
        ${numberPicker({ id: 'sp-t', values: [30, 45, 60, 90], value: 60, min: 10, max: 600, unit: ' 秒' })}
        <div class="hint">时间到自动跳到下一题，该题记为未答。</div>
      </div>`,
    actions: [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      {
        label: '开始冲刺',
        onClick: () => {
          const n = Math.min(total, Math.max(1, Number($('#sp-n').value) || startN));
          const t = Math.min(600, Math.max(10, Number($('#sp-t').value) || 60));
          closeModal();
          const qs = [];
          if (n !== total) qs.push(`n=${n}`);
          if (t !== 60) qs.push(`t=${t}`);
          navigate(`#/sprint/${encodeURIComponent(state.exam.id)}${qs.length ? `?${qs.join('&')}` : ''}`);
        },
      },
    ],
  });
  bindNumberPicker('sp-n');
  bindNumberPicker('sp-t');
}

function confirmResetExam() {
  if (!state.exam) return;
  const answered = Object.values(state.answers).filter(Boolean).length;
  openModal({
    title: '重置答题',
    sub: answered
      ? `会清空已作答的 ${answered} 题，并把计时器归零；标记和笔记会保留。`
      : '当前还没有作答，重置只会把计时器归零；标记和笔记会保留。',
    body: '',
    actions: [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      { label: '确认重置', onClick: () => { closeModal(); resetExam(); } },
    ],
  });
}

function resetExam() {
  state.answers = {};
  state.graded = false;
  state.elapsed = 0;
  state.paused = false;
  saveLocal();
  renderCards();
  renderSheet();
  renderResult();
  renderScopeBar();
  paintClock();
  const btn = $('#btn-pause');
  if (btn) btn.innerHTML = icons.pause;
  $('#timer')?.classList.remove('paused');
  const rs = $('#result-slot');
  if (rs) rs.innerHTML = '';
  toast('已清空作答，计时归零');
}

/* ------------------------------------------------------------------ 计时 */
function startTimer() {
  stopTimer();
  paintClock();
  state.timer = setInterval(() => {
    if (!state.paused) {
      state.elapsed += 1;
      if (state.elapsed % 10 === 0) saveLocal();
      paintClock();
    }
  }, 1000);
}
function stopTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
function paintClock() {
  const el = $('#clock');
  if (el) el.textContent = fmtClock(state.elapsed);
}
function togglePause() {
  state.paused = !state.paused;
  const btn = $('#btn-pause');
  const timer = $('#timer');
  if (btn) btn.innerHTML = state.paused ? icons.play : icons.pause;
  if (timer) timer.classList.toggle('paused', state.paused);
  if (state.paused) toast('已暂停计时');
}

/* ------------------------------------------------------------------ 交卷与结果 */
function confirmSubmit() {
  const total = state.exam.questions.length;
  const answered = Object.values(state.answers).filter(Boolean).length;
  const rest = total - answered;
  const msg = state.graded
    ? '重新批改一次？已作答的答案会重新统计。'
    : `已作答 ${answered} 题，还有 ${rest} 题未作答。确认交卷？`;
  openModal({
    title: '交卷',
    sub: msg,
    body: '',
    actions: [
      { label: '继续作答', cls: 'ghost', onClick: closeModal },
      { label: '确认交卷', onClick: () => { closeModal(); doSubmit(); } },
    ],
  });
}

async function doSubmit() {
  state.graded = true;
  state.paused = true;
  saveLocal();
  closeSheet();
  renderCards();
  renderResult();
  renderSheet();
  window.scrollTo({ top: 0, behavior: 'smooth' });

  try {
    const res = await api(`/exams/${encodeURIComponent(state.exam.id)}/attempts`, {
      method: 'POST',
      body: { answers: state.answers, durationMs: state.elapsed * 1000, pausedMs: 0 },
    });
    state.lastAttempt = res.attempt;
    renderResult();
    toast(`交卷完成：答对 ${res.attempt.correct} / ${res.attempt.total}`);
  } catch (err) {
    toast(`本地批改完成，保存成绩失败：${err.message}`);
  }
  updateSheetCount();
}

/* ------------------------------------------------------------------ 中止 / 继续 */
function confirmSuspend() {
  const answered = Object.values(state.answers).filter(Boolean).length;
  const total = state.exam.questions.length;
  if (!answered) { toast('还没有作答，先做几题再中止吧'); return; }
  openModal({
    title: '中止做题',
    sub: `只提交已作答的 ${answered} 题（留空的 ${total - answered} 题不判分、也不进错题本）。`
      + '进度会保存下来，之后可以点「继续做题」接着做。',
    body: '',
    actions: [
      { label: '继续做题', cls: 'ghost', onClick: closeModal },
      { label: '确认中止', onClick: () => { closeModal(); doSuspend(); } },
    ],
  });
}

async function doSuspend() {
  const exam = state.exam;
  const answered = Object.values(state.answers).filter(Boolean).length;
  try {
    const res = await api(`/exams/${encodeURIComponent(exam.id)}/suspend`, {
      method: 'POST',
      body: { answers: state.answers, durationMs: state.elapsed * 1000 },
    });
    state.suspended = res.suspended || null;
    state.graded = true;
    state.paused = true;
    saveLocal();
    renderCards();
    renderSheet();
    renderResult({ suspended: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast(`已中止：提交 ${answered} 题，进度已保存`);
  } catch (err) {
    toast(`中止失败：${err.message}`);
  }
}

/** 从结果条上「继续做题」：取消判分状态，接着做剩下的 */
async function resumeFromSuspend() {
  const exam = state.exam;
  state.graded = false;
  state.paused = false;
  state.suspended = null;
  saveLocal();
  const rs = $('#result-slot');
  if (rs) rs.innerHTML = '';
  renderCards();
  renderSheet();
  paintClock();
  const btn = $('#btn-pause');
  if (btn) btn.innerHTML = icons.pause;
  $('#timer')?.classList.remove('paused');
  try {
    await api(`/exams/${encodeURIComponent(exam.id)}/suspend`, { method: 'DELETE' });
  } catch { /* 忽略 */ }
  toast('继续做题');
}

function renderResult(opts = {}) {
  const slot = $('#result-slot');
  if (!slot || !state.graded) { if (slot) slot.innerHTML = ''; return; }
  const all = state.exam.questions;
  // 中止模式下只统计已作答的题，留空的不算"未答"
  const suspended = Boolean(opts.suspended || state.suspended);
  const qs = suspended ? all.filter((q) => state.answers[q.no]) : all;
  // 图片题没有可点的选项，不参与判分
  const readonlyCount = qs.filter((q) => q.kind === 'image').length;
  let correct = 0, wrong = 0, blank = 0, pending = 0;
  for (const q of qs) {
    if (q.kind === 'image') continue;
    const picked = state.answers[q.no];
    if (!picked) blank++;
    else if (!q.answer) pending++;
    else if (canonAnswer(picked) === canonAnswer(q.answer)) correct++;
    else wrong++;
  }
  const total = qs.length - readonlyCount;
  const pct = (n) => (total ? (n / total) * 100 : 0);
  const score = total ? (correct / total) * 100 : 0;

  slot.innerHTML = `
    <div class="result-bar ${suspended ? 'is-suspended' : ''}">
      <div class="rb-main">
        <span class="rb-score">${score.toFixed(1)}</span>
        <span class="rb-sub">分 · 答对 ${correct} / ${total} 题${pending ? ` · ${pending} 题待补答案` : ''}</span>
        ${suspended ? '<span class="chip orange">本次中止：只判了已作答的题</span>' : ''}
      </div>
      <div class="rb-nums">
        <span class="chip green">正确 ${correct}</span>
        <span class="chip red">错误 ${wrong}</span>
        <span class="chip">未答 ${blank}</span>
        ${pending ? `<span class="chip orange">待定 ${pending}</span>` : ''}
        ${readonlyCount ? `<span class="chip">仅阅读 ${readonlyCount}</span>` : ''}
        <span class="chip blue">用时 ${fmtClock(state.elapsed)}</span>
        ${suspended ? `<span class="chip orange">已保存 ${total} 题进度</span>` : ''}
      </div>
      <div class="meter">
        <i class="m-correct" style="width:${pct(correct)}%"></i>
        <i class="m-wrong" style="width:${pct(wrong)}%"></i>
        <i class="m-blank" style="width:${pct(blank + pending)}%"></i>
      </div>
      <div class="rb-actions">
        ${suspended
          ? '<button class="btn sm" id="btn-resume">继续做题</button>'
          : '<button class="btn ghost sm" id="btn-review-wrong">只看得错的题</button>'}
        <button class="btn ghost sm" id="btn-show-all">显示全部</button>
        <button class="btn ghost sm" id="btn-submit-again">再批改一次</button>
        <button class="btn ghost sm" id="btn-restart">重新开始</button>
      </div>
    </div>`;

  const bind = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  bind('#btn-resume', () => resumeFromSuspend());
  bind('#btn-review-wrong', () => {
    qs.forEach((q) => {
      const card = $(`#q-${q.no}`);
      if (!card) return;
      const ok = state.answers[q.no] && q.answer
        && canonAnswer(state.answers[q.no]) === canonAnswer(q.answer);
      card.style.display = ok ? 'none' : '';
    });
    toast('已隐藏答对的题');
  });
  bind('#btn-show-all', () => {
    qs.forEach((q) => { const card = $(`#q-${q.no}`); if (card) card.style.display = ''; });
  });
  bind('#btn-submit-again', () => confirmSubmit());
  bind('#btn-restart', () => {
    openModal({
      title: '重新开始',
      sub: '会清空这次练习的作答、标记和计时，题库本身不受影响。',
      body: '',
      actions: [
        { label: '取消', cls: 'ghost', onClick: closeModal },
        {
          label: '清空并重做',
          onClick: () => {
            try { localStorage.removeItem(LS_KEY(state.exam.id)); } catch { /* 忽略 */ }
            closeModal();
            state.answers = {};
            state.marks = {};
            state.notes = {};
            state.graded = false;
            state.elapsed = 0;
            state.paused = false;
            state.lastAttempt = null;
            renderExam(state.exam.id);
            window.scrollTo({ top: 0 });
            toast('已清空，重新开始');
          },
        },
      ],
    });
  });
}

/* ------------------------------------------------------------------ 修订答案 */
function promptFixAnswer(q) {
  const labels = q.options.map((o) => o.label);
  openModal({
    title: `修订第 ${q.no} 题`,
    sub: '改完会保存到题库，下次打开仍然生效。',
    body: `
      <div class="field">
        <label>正确答案</label>
        <select id="fix-answer">
          <option value="">（清除答案）</option>
          ${labels.map((l) => `<option value="${l}" ${q.answer === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="field">
        <label>解析</label>
        <textarea id="fix-expl">${esc(q.explanation || '')}</textarea>
      </div>`,
    actions: [
      { label: '取消', cls: 'ghost', onClick: closeModal },
      {
        label: '保存',
        onClick: async () => {
          const answer = $('#fix-answer').value || null;
          const explanation = $('#fix-expl').value;
          try {
            const updated = await api(
              `/exams/${encodeURIComponent(state.exam.id)}/questions/${q.no}`,
              { method: 'PATCH', body: { answer, explanation } },
            );
            Object.assign(q, updated);
            closeModal();
            renderCards();
            renderSheet();
            renderResult();
            toast('已保存');
          } catch (err) { toast(err.message); }
        },
      },
    ],
  });
}

/** 只补解析：不改动已验证的标准答案 */
async function explainOnly(q, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const updated = await api(
      `/exams/${encodeURIComponent(state.exam.id)}/questions/${q.no}/explain`,
      { method: 'POST' },
    );
    const idx = state.exam.questions.findIndex((x) => x.no === q.no);
    state.exam.questions[idx] = updated;
    const card = $(`#q-${q.no}`);
    if (card) card.outerHTML = questionCard(updated);
    toast(`第 ${q.no} 题的解析已生成`);
  } catch (err) {
    toast(`生成解析失败：${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '生成解析'; }
  }
}

async function reanalyze(q) {
  const card = $(`#q-${q.no}`);
  const btn = card?.querySelector('[data-act="reanalyze"]');
  if (btn) { btn.disabled = true; btn.textContent = '解析中…'; }
  try {
    const updated = await api(
      `/exams/${encodeURIComponent(state.exam.id)}/questions/${q.no}/reanalyze`,
      { method: 'POST' },
    );
    const idx = state.exam.questions.findIndex((x) => x.no === q.no);
    state.exam.questions[idx] = updated;
    renderCards();
    renderSheet();
    toast(`第 ${q.no} 题已重新解析`);
  } catch (err) {
    toast(`重新解析失败：${err.message}`);
    if (btn) { btn.disabled = false; btn.textContent = '重新解析'; }
  }
}

/* ------------------------------------------------------------------ 设置 */
async function openSettings() {
  let cfg = state.config;
  try { cfg = await api('/config'); state.config = cfg; } catch { /* 用旧值 */ }
  cfg = cfg || { llm: {} };
  openModal({
    title: '设置',
    sub: '默认接本机 OpenAI 兼容代理，改完立即生效。',
    body: `
      <div class="field">
        <label>接口地址（含 /v1）</label>
        <input id="set-base" value="${esc(cfg.llm.baseUrl || '')}" placeholder="http://127.0.0.1:3050/v1" />
      </div>
      <div class="field">
        <label>文本模型</label>
        <input id="set-model" value="${esc(cfg.llm.model || '')}" placeholder="deepseek/deepseek-v4.1-flash" />
      </div>
      <div class="field">
        <label>视觉模型（图形题用）</label>
        <input id="set-vmodel" value="${esc(cfg.llm.visionModel || '')}" placeholder="deepseek/deepseek-v4-flash-vision-exp" />
      </div>
      <div class="field">
        <label>密钥</label>
        <input id="set-key" type="password" placeholder="${cfg.llm.hasApiKey ? `已配置（${esc(cfg.llm.apiKeyHint)}），留空则不修改` : '未配置，请填写'}" />
        <div class="hint">不会显示明文；留空表示保持原值。也可以写进项目根目录的 .env。</div>
      </div>`,
    actions: [
      { label: '关闭', cls: 'ghost', onClick: closeModal },
      {
        label: '保存',
        onClick: async () => {
          try {
            state.config = await api('/config', {
              method: 'POST',
              body: {
                baseUrl: $('#set-base').value.trim(),
                model: $('#set-model').value.trim(),
                visionModel: $('#set-vmodel').value.trim(),
                apiKey: $('#set-key').value.trim(),
              },
            });
            closeModal();
            toast('设置已保存');
          } catch (err) { toast(err.message); }
        },
      },
    ],
  });
}

/* ------------------------------------------------------------------ 弹层 */
function openModal({ title, sub, body, actions }) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      ${sub ? `<p class="modal-sub">${esc(sub)}</p>` : ''}
      ${body}
      <div class="modal-foot">
        ${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}
      </div>
    </div>`;
  mask.addEventListener('click', (e) => {
    if (e.target === mask) closeModal();
    const btn = e.target.closest('[data-i]');
    if (btn) actions[Number(btn.dataset.i)].onClick();
  });
  document.body.appendChild(mask);
  closeModal.current = () => mask.remove();
}
function closeModal() {
  if (closeModal.current) closeModal.current();
  closeModal.current = null;
}

function openLightbox(src) {
  const div = document.createElement('div');
  div.className = 'lightbox';
  div.innerHTML = `<img src="${src}" alt="题目配图" />`;
  div.onclick = () => div.remove();
  document.body.appendChild(div);
}

/* ------------------------------------------------------------------ 启动 */
(async function boot() {
  try { state.config = await api('/config'); } catch { /* 忽略 */ }
  await render();
})();

// 离开页面前落盘
window.addEventListener('beforeunload', saveLocal);
