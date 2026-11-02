// Phase W1：把舊「每日工作報告看板」的匯出檔轉成 Life OS 備份格式，再交給 data.planImport／runImport 寫入
// （沿用備份匯入的規則：只新增不覆蓋、新 id、同案件編號或同內容不重複匯入）。
// 舊看板是「每天一份五欄快照」；這裡把同一件工作（案件編號，沒有編號就用標題）跨天合併成一個任務。
// 純函式，不碰資料庫，可在 Node 直接測試。計畫與對應規則見 docs/08-work-board-migration.md。

export const EXPORT_APP = 'work-board-export';
const COLUMNS = ['new', 'inprogress', 'done', 'tomorrow', 'backlog'];
// 同一天同一件工作出現在多欄時，以「最前進」的那欄為準
const RANK = { done: 5, inprogress: 4, new: 3, tomorrow: 2, backlog: 1 };
const EFFORTS = new Set(['light', 'medium', 'heavy']);
const KEEP_DAYS = 30; // 已完成的工作只搬最近一個月（使用者決定）

const iso = (key) => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`; // 20261102 → 2026-11-02
const at = (key, hhmm) => `${iso(key)}T${hhmm}:00+08:00`;                         // 台北時間
const keyOf = (date) => date.replace(/-/g, '');
const dow = (key) => new Date(`${iso(key)}T12:00:00+08:00`).getUTCDay();
function addDaysKey(key, n) {
  const d = new Date(`${iso(key)}T12:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
/** 下一個工作日（跳過週六日，同原看板） */
export function nextWorkingKey(key) {
  let k = addDaysKey(key, 1);
  while (dow(k) === 0 || dow(k) === 6) k = addDaysKey(k, 1);
  return k;
}
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase();
const validUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol) ? new URL(u).href : null; } catch { return null; } };
const parseJson = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch { return {}; } };

/**
 * @param raw 舊看板匯出的 JSON（Apps Script 的 exportForLifeOS_，格式見 docs/08）
 * @param ctx { areas, areaId（放進哪個領域）, projects, workTags, today:'YYYY-MM-DD', newId:()=>string }
 * @returns { backup, stats }  backup 可直接交給 planImport
 */
export function convertBoardExport(raw, ctx) {
  if (raw?.app !== EXPORT_APP || !Array.isArray(raw.reports)) throw new Error('這不是舊工作看板的匯出檔（需要 app: "work-board-export"）');
  const newId = ctx.newId || (() => crypto.randomUUID());
  // 舊看板的工作全部放進使用者選的領域（匯入畫面上選；預設是列入工作看板的第一個領域）
  const area = ctx.areas.find((a) => a.id === ctx.areaId);
  if (!area) throw new Error('請選擇要把舊看板的工作放進哪個領域');

  const todayKey = keyOf(ctx.today);
  const all = raw.reports
    .filter((r) => /^\d{8}$/.test(String(r.dateKey)) && r.state && typeof r.state === 'object')
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  // 舊看板把工作「排到某天」時會先替那天建一份資料；未來日期只拿來當預定日，不代表看板現況
  const reports = all.filter((r) => String(r.dateKey) <= todayKey);
  const future = all.filter((r) => String(r.dateKey) > todayKey);
  if (!reports.length) throw new Error('匯出檔裡沒有任何一天的工作');
  const latest = String(reports.at(-1).dateKey);
  const cutoff = addDaysKey(todayKey, -KEEP_DAYS);

  // 1) 跨天合併成「案件」
  const cases = new Map();
  const itemToCase = new Map(); // 看板卡片 id → 案件 key（Wrap up 的投入程度用）
  for (const rep of reports) {
    const day = String(rep.dateKey);
    const seenToday = new Map();
    for (const col of COLUMNS) {
      for (const item of Array.isArray(rep.state[col]) ? rep.state[col] : []) {
        const text = String(item?.text || '').trim();
        if (!text) continue;
        const caseNo = /^WK-\d{6,}$/.test(String(item.caseNo || '')) ? String(item.caseNo) : null;
        const key = caseNo || `T:${norm(text)}`;
        const c = cases.get(key) || { key, caseNo, first: day, notes: [], lastNote: '' };
        cases.set(key, c);
        if (item.id) itemToCase.set(String(item.id), key);
        c.title = text.split(/\r?\n/)[0].slice(0, 300);
        if (text.includes('\n')) c.detail = text;
        if (item.url && validUrl(item.url)) c.url = validUrl(item.url);
        if (item.workType) c.workType = String(item.workType).replace(/^\u200B+/, '').trim();
        if (item.projectTag) c.projectTag = String(item.projectTag).replace(/^\u200B+/, '').trim();
        if (/^\d{8}$/.test(String(item.scheduledDate || ''))) c.scheduled = String(item.scheduledDate);
        const note = String(item.note || '').trim();
        if (note && note !== c.lastNote) { c.notes.push({ day, body: note }); c.lastNote = note; }
        const prev = seenToday.get(key);
        if (!prev || RANK[col] > RANK[prev]) seenToday.set(key, col);
      }
    }
    for (const [key, col] of seenToday) {
      const c = cases.get(key);
      c.last = day;
      c.column = col;
      if (col === 'done' && !c.doneDay) c.doneDay = day;
      if (col !== 'done') c.doneDay = null; // 之後又被拉回未完成
    }
  }

  // 1b) 排到未來日期的工作：記成預定日；只出現在未來的（例如排程後原日期被清掉）視為未完成
  for (const rep of future) {
    const day = String(rep.dateKey);
    for (const col of COLUMNS) {
      for (const item of Array.isArray(rep.state[col]) ? rep.state[col] : []) {
        const text = String(item?.text || '').trim();
        if (!text || col === 'done') continue;
        const caseNo = /^WK-\d{6,}$/.test(String(item.caseNo || '')) ? String(item.caseNo) : null;
        const key = caseNo || `T:${norm(text)}`;
        let c = cases.get(key);
        if (!c) {
          c = { key, caseNo, first: latest, notes: [], lastNote: '', title: text.split(/\r?\n/)[0].slice(0, 300), futureOnly: true };
          cases.set(key, c);
        }
        if (item.scheduleRole === 'previous') continue; // 「前一天提醒」不是預定日
        if (!c.scheduled || c.scheduled < day) c.scheduled = /^\d{8}$/.test(String(item.scheduledDate || '')) ? String(item.scheduledDate) : day;
      }
    }
  }

  // 2) 決定要搬哪些：最新一天還在看板上的未完成工作＋最近 30 天完成的
  const stats = { cases: cases.size, open: 0, doneRecent: 0, skippedOld: 0, removed: 0 };
  const removedTitles = [];
  const picked = [];
  for (const c of cases.values()) {
    if (c.futureOnly) { picked.push(c); stats.open++; continue; }
    if (c.column === 'done') {
      if (c.doneDay >= cutoff) { picked.push(c); stats.doneRecent++; } else stats.skippedOld++;
    } else if (c.last === latest) { picked.push(c); stats.open++; } else { stats.removed++; removedTitles.push(`${c.caseNo || ''} ${c.title}（最後出現 ${iso(c.last)}）`.trim()); } // 從看板上刪掉、沒完成的
  }

  // 3) 專案（專案標籤）與工作種類：同名沿用既有的，沒有才新增
  const projects = [];
  const projectByName = new Map(ctx.projects.filter((p) => p.area_id === area.id).map((p) => [p.name, p]));
  const projectId = (name) => {
    if (!name) return null;
    let p = projectByName.get(name);
    if (!p) {
      p = { id: newId(), area_id: area.id, name, status: 'active', created_at: at(latest, '09:00') };
      projectByName.set(name, p);
    }
    if (!projects.includes(p)) projects.push(p);
    return p.id;
  };
  const tagColor = new Map((raw.tags || []).filter((t) => t.group === '工作種類').map((t) => [String(t.label), t]));
  const workTags = [];
  const tagByLabel = new Map(ctx.workTags.map((t) => [t.label, t]));
  const workTypeId = (label) => {
    if (!label) return null;
    let t = tagByLabel.get(label);
    if (!t) {
      const src = tagColor.get(label);
      t = { id: newId(), label, color: /^#[0-9a-f]{6}$/i.test(src?.color || '') ? src.color : '#667085',
        active: src ? src.active !== false && src.active !== 'FALSE' : true, sort: Number(src?.sort_order) || 0 };
      tagByLabel.set(label, t);
    }
    if (!workTags.includes(t)) workTags.push(t);
    return t.id;
  };
  // 匯入時沒用到的工作種類也一起建立（原看板的標籤清單）
  for (const label of tagColor.keys()) workTypeId(label);

  // 4) 任務與進度紀錄
  const tasks = [];
  const memos = [];
  const taskIdByCase = new Map();
  for (const c of picked) {
    const id = newId();
    taskIdByCase.set(c.key, id);
    const status = c.futureOnly ? 'todo' : c.column === 'done' ? 'done' : c.column === 'inprogress' ? 'doing' : 'todo';
    let due = c.scheduled || null;
    if (!due && c.column === 'tomorrow') due = nextWorkingKey(latest);
    if (!due && status === 'done') due = c.doneDay; // 讓完成的工作算進那天的完成率
    tasks.push({
      id, area_id: area.id, project_id: projectId(c.projectTag), work_type_id: workTypeId(c.workType),
      title: c.title, notes: c.detail || null, status, priority: 2, starred: false,
      due_date: due ? iso(due) : null, case_no: c.caseNo, links: c.url ? [c.url] : [],
      created_at: at(c.first, '09:00'), completed_at: status === 'done' ? at(c.doneDay, '18:00') : null,
    });
    for (const n of c.notes) memos.push({ id: newId(), task_id: id, body: n.body.slice(0, 5000), created_at: at(n.day, '18:00') });
  }

  // 5) Wrap up → 每日復盤的工作欄位（最近 30 天；那天已有復盤列的會被 planImport 略過，不覆蓋）
  const reviews = [];
  for (const w of raw.wrapups || []) {
    const day = String(w.date_key || '');
    if (!/^\d{8}$/.test(day) || day < cutoff) continue;
    const ref = parseJson(w.reflection_json);
    const effort = {};
    for (const [itemId, level] of Object.entries(parseJson(w.effort_json))) {
      const tid = taskIdByCase.get(itemToCase.get(itemId));
      if (tid && EFFORTS.has(level)) effort[tid] = level;
    }
    // 工作的三題存在 work_reflection，不放進生活復盤的三格（工作與生活分開）
    const reflection = {
      achievement: String(ref.achievement || '').trim(), blocker: String(ref.blocker || '').trim(), attention: String(ref.attention || '').trim(),
    };
    const row = {
      id: newId(), review_date: iso(day), work_reflection: reflection,
      work_summary: String(w.summary_text || '').trim() || null,
      work_effort: effort, work_analysis: parseJson(w.analysis_json),
    };
    if (reflection.achievement || reflection.blocker || reflection.attention || row.work_summary) reviews.push(row);
  }

  // 舊看板存進 Google Sheet 時會在開頭加零寬空白（避免被當成公式），搬過來要拿掉
  const phrases = (raw.routines || []).map((r) => String(r.text || '').replace(/^\u200B+/, '').trim())
    .filter(Boolean).map((body, i) => ({ id: newId(), body: body.slice(0, 2000), sort: i }));

  return {
    stats: { ...stats, latest: iso(latest), cutoff: iso(cutoff), futureDays: future.length, removedTitles },
    backup: {
      app: 'life-os', version: 1, exported_at: new Date().toISOString(),
      tables: { areas: [area], projects, work_tags: workTags, tasks, task_memos: memos, daily_reviews: reviews, routine_phrases: phrases },
    },
  };
}
