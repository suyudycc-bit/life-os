// 唯一的資料存取與衍生計算模組（.claude/rules/data-integrity.md）
// UI 只呼叫這裡，不直接操作 supabase，也不自行計算完成率等數字。
import { supabase } from './supabase.js';
import { today, addDays, localDate, weekStart, dayStartISO, toLocalInput, fromLocalInput } from './dates.js';

function must({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// ===== 登入 =====
export async function getSession() {
  return must(await supabase.auth.getSession()).session;
}
export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}
export async function signIn(email, password) {
  return must(await supabase.auth.signInWithPassword({ email, password }));
}
export async function signUp(email, password) {
  return must(await supabase.auth.signUp({ email, password }));
}
export async function signOut() {
  must(await supabase.auth.signOut());
}

// ===== 領域 =====
export const DEFAULT_AREAS = [
  { name: '工作／BD／轉譯組', kind: 'work', color: '#3b6fd8', sort: 1 },
  { name: '轉職與職涯', kind: 'career', color: '#8a5cd6', sort: 2 },
  { name: '副業與接案', kind: 'side', color: '#e08a2e', sort: 3 },
  { name: '健康與習慣', kind: 'health', color: '#2f9e6b', sort: 4 },
];

export const AREA_KINDS = {
  work: '工作', career: '職涯', side: '副業', health: '健康', learning: '學習', life: '生活', media: '自媒體',
};

export async function listAreas() {
  return must(await supabase.from('areas').select('*').order('sort'));
}

/** 第一次登入時若沒有任何領域，建立四個預設領域 */
export async function ensureAreas() {
  const areas = await listAreas();
  if (areas.length) return areas;
  must(await supabase.from('areas').insert(DEFAULT_AREAS));
  return listAreas();
}

export async function createArea({ name, kind, color, on_board = false }, areas) {
  if (!name?.trim()) throw new Error('請輸入領域名稱');
  if (!AREA_KINDS[kind]) throw new Error('請選擇類型');
  if (areas.some((a) => a.name === name.trim())) throw new Error('已有同名領域');
  const sort = Math.max(0, ...areas.map((a) => a.sort)) + 1;
  return must(await supabase.from('areas').insert({ name: name.trim(), kind, color, sort, ...(on_board ? { on_board: true } : {}) }).select().single());
}

// ===== 任務 =====
const TASK_FIELDS = ['title', 'notes', 'area_id', 'project_id', 'goal_id', 'status', 'priority',
  'starred', 'due_date', 'scheduled_start', 'estimate_min', 'sort_order', 'links', 'case_no', 'work_type_id'];

function pickTask(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => TASK_FIELDS.includes(k)));
}

export async function listTasks() {
  return must(await supabase.from('tasks').select('*').order('created_at', { ascending: false }));
}

/** 新任務：若已手動排過序，放在最上面 */
export async function createTask(task, existing = []) {
  if (!task.title?.trim()) throw new Error('請輸入任務名稱');
  if (!task.area_id) throw new Error('請選擇領域');
  const orders = existing.map((t) => t.sort_order).filter((v) => v != null);
  const sort_order = orders.length ? Math.min(...orders) - 1 : null;
  return must(await supabase.from('tasks').insert(pickTask({ ...task, title: task.title.trim(), sort_order })).select().single());
}

/** 拖移後：依畫面上的新順序寫入 sort_order，只更新有變動的任務 */
export async function reorderTasks(orderedIds, tasksById) {
  const changed = orderedIds
    .map((id, i) => ({ id, sort_order: (i + 1) * 1000 }))
    .filter(({ id, sort_order }) => tasksById[id]?.sort_order !== sort_order);
  const results = await Promise.all(changed.map(({ id, sort_order }) =>
    supabase.from('tasks').update({ sort_order }).eq('id', id).select('id')));
  const updated = results.reduce((n, r) => n + must(r).length, 0);
  if (updated !== changed.length) throw new Error(`排序預期更新 ${changed.length} 筆，實際 ${updated} 筆`);
}

/**
 * 拖移後的完整順序：在「全部未完成任務」的目前順序中，把 draggedId 移到畫面上新鄰居的位置。
 * 篩選中拖移也不會打亂沒顯示的任務。
 */
export function moveTask(tasks, draggedId, nextId, prevId) {
  const order = tasks.filter(isOpen).sort(compareTasks).map((t) => t.id).filter((id) => id !== draggedId);
  let i = nextId ? order.indexOf(nextId) : -1;
  if (i < 0) i = prevId ? order.indexOf(prevId) + 1 : order.length;
  order.splice(i, 0, draggedId);
  return order;
}

/** 連結：一行一個，只接受 http(s) 且網域需含「.」，沒寫協定的自動補 https:// */
export function parseLinks(text) {
  return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
    const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    let u;
    try { u = new URL(url); } catch { u = null; }
    if (!u || /\s/.test(s) || !u.hostname.includes('.')) throw new Error(`連結格式不正確：${s}`);
    return u.href;
  });
}

// ===== 任務進度 memo =====
export async function listMemos() {
  return must(await supabase.from('task_memos').select('*').order('created_at', { ascending: false }));
}

export async function addMemo(taskId, body) {
  if (!body?.trim()) throw new Error('請輸入進度內容');
  return must(await supabase.from('task_memos').insert({ task_id: taskId, body: body.trim() }).select().single());
}

export async function deleteMemo(id) {
  const rows = must(await supabase.from('task_memos').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

/** 依任務分組，新的在前 */
export function memosByTask(memos) {
  const map = {};
  for (const m of memos) (map[m.task_id] ||= []).push(m);
  return map;
}

export async function updateTask(id, patch) {
  return must(await supabase.from('tasks').update(pickTask(patch)).eq('id', id).select().single());
}

/** 完成／取消完成；completed_at 由資料庫觸發器寫入（聯動規則 3）。若此任務正在計時，先結束計時 */
export async function setTaskDone(id, done, running = null) {
  if (done && running?.task_id === id) await stopTimer(running);
  return updateTask(id, { status: done ? 'done' : 'todo' });
}

export async function deleteTask(id) {
  const rows = must(await supabase.from('tasks').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

// ===== 計時（docs/02 計時規則）=====
// 統計讀取範圍：近 7 天與本週（取較早者）
export function entriesSince(day = today()) {
  const from = [addDays(day, -6), weekStart(day)].sort()[0];
  return dayStartISO(from);
}

export async function listEntries(sinceISO = entriesSince()) {
  return must(await supabase.from('time_entries').select('*').gte('started_at', sinceISO)
    .order('started_at', { ascending: false }));
}

export async function getRunningEntry() {
  return must(await supabase.from('time_entries').select('*').is('ended_at', null).maybeSingle());
}

/** 開始計時；同時只能有一個進行中（資料庫唯一索引把關）。待辦會自動改成進行中 */
export async function startTimer(task) {
  if (!isOpen(task)) throw new Error('已完成或放棄的任務不能計時');
  const { data: entry, error } = await supabase.from('time_entries').insert({
    task_id: task.id, area_id: task.area_id, started_at: new Date().toISOString(), source: 'timer',
  }).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('已有進行中的計時，請先暫停它');
    throw new Error(error.message);
  }
  if (task.status === 'todo') await updateTask(task.id, { status: 'doing' });
  return entry;
}

/** 暫停＝結束目前這筆 entry；duration_sec 與任務 actual_sec 由資料庫觸發器計算 */
export async function stopTimer(entry) {
  const rows = must(await supabase.from('time_entries').update({ ended_at: new Date().toISOString() })
    .eq('id', entry.id).is('ended_at', null).select('id'));
  if (rows.length !== 1) throw new Error('這筆計時已經結束了');
}

/** 手動補記：需填開始與結束時間 */
export async function addManualEntry(task, startedISO, endedISO) {
  if (!task) throw new Error('請選擇任務');
  if (!startedISO || !endedISO) throw new Error('請填開始與結束時間');
  if (endedISO <= startedISO) throw new Error('結束時間要晚於開始時間');
  if (endedISO > new Date().toISOString()) throw new Error('結束時間不能在未來');
  return must(await supabase.from('time_entries').insert({
    task_id: task.id, area_id: task.area_id, started_at: startedISO, ended_at: endedISO, source: 'manual',
  }).select().single());
}

export async function deleteEntry(id) {
  const rows = must(await supabase.from('time_entries').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0);

/** 一筆計時的秒數：已結束的讀資料庫算好的 duration_sec；進行中的算到 now（只供即時顯示） */
export function entrySeconds(e, now = Date.now()) {
  if (e.duration_sec != null) return e.duration_sec;
  const end = e.ended_at ? new Date(e.ended_at).getTime() : now;
  return Math.max(0, (end - new Date(e.started_at).getTime()) / 1000);
}

/**
 * 時間統計。用時以資料庫的 duration_sec 加總（顯示 h m s）；
 * 任務的實際用時讀資料庫觸發器累計的 actual_sec（秒）。
 * 一筆計時歸在它開始那天（台北時間）。進行中的計時不列入，畫面另外即時加上。
 */
export function timeStats(entries, tasks, day = today()) {
  const ws = weekStart(day);
  const we = addDays(ws, 6);
  const finished = entries.filter((e) => e.ended_at).map((e) => ({ ...e, day: localDate(e.started_at), sec: entrySeconds(e) }));
  const inWeek = finished.filter((e) => e.day >= ws && e.day <= we);

  const byArea = (list) => {
    const m = {};
    for (const e of list) m[e.area_id] = (m[e.area_id] || 0) + e.sec;
    return m;
  };
  // 領域占比：秒數多的在前，百分比四捨五入
  const share = (m) => {
    const total = sum(Object.values(m), (v) => v);
    return Object.entries(m).map(([area_id, sec]) => ({ area_id, sec, pct: total ? Math.round((100 * sec) / total) : 0 }))
      .sort((x, y) => y.sec - x.sec);
  };
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(day, i - 6);
    const list = finished.filter((e) => e.day === d);
    return { day: d, totalSec: sum(list, (e) => e.sec), byArea: byArea(list) };
  });

  // 本週任務：本週到期／排程，或本週有計時紀錄的任務
  const timedIds = new Set(inWeek.map((e) => e.task_id).filter(Boolean));
  const weekTasks = tasks.filter((t) => t.status !== 'dropped'
    && (timedIds.has(t.id) || ((d) => d && d >= ws && d <= we)(taskDay(t))))
    .map((t) => ({
      task: t,
      estimate: t.estimate_min, // 分鐘
      actualSec: t.actual_sec || 0,
      diffSec: t.estimate_min == null ? null : (t.actual_sec || 0) - t.estimate_min * 60, // 正數＝超時
    }))
    .sort((a, b) => b.actualSec - a.actualSec);
  const withEst = weekTasks.filter((r) => r.diffSec != null);

  return {
    weekStart: ws,
    weekEnd: we,
    todaySec: sum(finished.filter((e) => e.day === day), (e) => e.sec),
    weekSec: sum(inWeek, (e) => e.sec),
    weekEstimate: sum(weekTasks, (r) => r.estimate),
    weekDiffSec: withEst.length ? sum(withEst, (r) => r.diffSec) : null,
    last7,
    weekAreaShare: share(byArea(inWeek)),
    weekTasks,
  };
}

// ===== 日曆（不另存事件，直接讀 tasks；聯動規則 1）=====
/**
 * 把任務放到日曆的日子上：排程那天顯示時間；到期日若是另一天，再以「到期」出現一次。
 * @returns {Record<string, {task, kind: 'scheduled'|'due', time: string|null}[]>} day → 項目
 */
export function calendarItems(tasks, fromDay, toDay) {
  const map = {};
  const add = (day, item) => {
    if (day >= fromDay && day <= toDay) (map[day] ||= []).push(item);
  };
  for (const t of tasks) {
    if (t.status === 'dropped') continue;
    const sd = scheduledDay(t);
    if (sd) add(sd, { task: t, kind: 'scheduled', time: t.scheduled_start });
    if (t.due_date && t.due_date !== sd) add(t.due_date, { task: t, kind: 'due', time: null });
  }
  for (const list of Object.values(map)) {
    list.sort((a, b) => (isOpen(b.task) - isOpen(a.task))
      || (a.time ? 0 : 1) - (b.time ? 0 : 1)
      || (a.time || '').localeCompare(b.time || '')
      || compareTasks(a.task, b.task));
  }
  return map;
}

/**
 * 日曆上拖到另一天：排程的保留原本時刻、只換日期；到期的改 due_date。
 * 排程與到期在同一天時一起移動，避免拆成兩天。
 */
export function moveOnCalendar(task, kind, newDay) {
  const sd = scheduledDay(task);
  const patch = {};
  if (kind === 'scheduled' || (sd && sd === task.due_date)) {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(task.scheduled_start));
    patch.scheduled_start = new Date(`${newDay}T${time}:00+08:00`).toISOString();
  }
  if (kind === 'due' || task.due_date === sd) patch.due_date = newDay;
  return updateTask(task.id, patch);
}

// ===== 每日復盤 =====
export async function listEntriesOn(day) {
  return must(await supabase.from('time_entries').select('*')
    .gte('started_at', dayStartISO(day)).lt('started_at', dayStartISO(addDays(day, 1)))
    .order('started_at'));
}

export async function getReview(day) {
  return must(await supabase.from('daily_reviews').select('*').eq('review_date', day).maybeSingle());
}

/** 有寫過復盤的日期（新到舊） */
export async function listReviewDates(limit = 60) {
  const rows = must(await supabase.from('daily_reviews').select('*')
    .order('review_date', { ascending: false }).limit(limit));
  return rows.filter((r) => [r.gains, r.problems, r.tomorrow_improve].some((v) => v?.trim())); // 生活復盤（工作的 Wrap up 在工作看板）
}

/** 同一天只有一筆（unique user_id + review_date），存檔用 upsert */
export async function saveReview(day, { gains, problems, tomorrow_improve }) {
  const session = await getSession();
  return must(await supabase.from('daily_reviews').upsert({
    user_id: session.user.id, review_date: day, gains, problems, tomorrow_improve, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,review_date' }).select().single());
}

/** Wrap up my day（Phase W3，在工作看板上做）：只寫工作欄位，不動生活復盤的三格 */
export async function saveWrapUp(day, { work_reflection, work_effort, work_summary, work_analysis }) {
  const session = await getSession();
  return must(await supabase.from('daily_reviews').upsert({
    user_id: session.user.id, review_date: day, work_reflection, work_effort, work_summary, work_analysis, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,review_date' }).select().single());
}

/**
 * 復盤彙總（唯讀）：任務數與完成率讀 daily_summary；當日用時與領域占比讀當天的 time_entries
 * @param summary daily_summary 該日那一列
 * @param entries 當天開始的計時（已結束才算）
 */
export function reviewStats(summary, entries, tasks, day) {
  const finished = entries.filter((e) => e.ended_at);
  const byArea = {};
  for (const e of finished) byArea[e.area_id] = (byArea[e.area_id] || 0) + entrySeconds(e);
  const totalSec = Object.values(byArea).reduce((n, v) => n + v, 0);
  const dayTasks = tasks.filter((t) => t.status !== 'dropped' && summaryDay(t) === day).sort(compareTasks);
  return {
    tasksTotal: summary.tasks_total,
    tasksDone: summary.tasks_done,
    completionPct: summary.completion_pct,
    timeSec: totalSec,
    // 當日任務：實際（觸發器累計的 actual_sec）− 預計
    diffSec: summary.estimate_min ? (summary.actual_sec || 0) - summary.estimate_min * 60 : null,
    areaShare: Object.entries(byArea).map(([area_id, sec]) => ({
      area_id, sec, pct: totalSec ? Math.round((100 * sec) / totalSec) : 0,
    })).sort((a, b) => b.sec - a.sec),
    dayTasks,
  };
}

/**
 * 歷史復盤摘要：
 * - 完成的任務＝當天（台北）完成的（completed_at），不論原本哪天到期
 * - 進行中的任務＝當天到期或排程、目前仍未完成的
 */
export function dayDigest(tasks, day) {
  const done = tasks.filter((t) => t.status === 'done' && t.completed_at && localDate(t.completed_at) === day)
    .sort((a, b) => a.completed_at.localeCompare(b.completed_at));
  const open = tasks.filter((t) => isOpen(t) && taskDay(t) === day).sort(compareTasks);
  return { done, open };
}

// ===== 靈感知識庫（M6）=====
export async function listNotes() {
  return must(await supabase.from('notes').select('*').order('updated_at', { ascending: false }));
}

/** 標籤：逗號（半形／全形）或空白分隔，去掉開頭的 #，去重 */
export function parseTags(text) {
  const tags = String(text || '').split(/[,，、\s]+/).map((s) => s.replace(/^#+/, '').trim()).filter(Boolean);
  return [...new Set(tags)].slice(0, 20);
}

/** 新增或更新一則靈感；分類用領域（area_id，可不選） */
export async function saveNote(note) {
  const row = {
    title: note.title?.trim(),
    body: note.body?.trim() || null,
    area_id: note.area_id || null,
    tags: parseTags(note.tags),
    updated_at: new Date().toISOString(),
  };
  if (!row.title) throw new Error('請輸入標題');
  if (note.id) return must(await supabase.from('notes').update(row).eq('id', note.id).select().single());
  return must(await supabase.from('notes').insert(row).select().single());
}

export async function deleteNote(id) {
  const rows = must(await supabase.from('notes').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

/** 搜尋標題、正文、標籤（不分大小寫，空白分隔的每個字都要符合）；可再依領域、標籤篩選 */
export function searchNotes(notes, { q = '', areaId = '', tag = '' } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return notes.filter((n) => {
    if (areaId && n.area_id !== areaId) return false;
    if (tag && !(n.tags || []).includes(tag)) return false;
    const hay = [n.title, n.body, ...(n.tags || [])].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w.replace(/^#/, '')));
  });
}

/** 所有標籤與使用次數（多的在前） */
export function tagCounts(notes) {
  const m = {};
  for (const n of notes) for (const t of n.tags || []) m[t] = (m[t] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

// ===== 習慣養成（M7；只記「有沒有做」，不記錄診斷或病歷）=====
export async function listHabits() {
  return must(await supabase.from('habits').select('*').order('created_at'));
}

export async function listHabitLogs() {
  return must(await supabase.from('habit_logs').select('id, habit_id, log_date').order('log_date'));
}

export async function createHabit({ name, area_id, target_per_week }) {
  if (!name?.trim()) throw new Error('請輸入習慣名稱');
  return must(await supabase.from('habits').insert({
    name: name.trim(), area_id: area_id || null, target_per_week: Number(target_per_week) || 7,
  }).select().single());
}

export async function updateHabit(id, patch) {
  const row = {};
  if ('name' in patch) {
    if (!patch.name?.trim()) throw new Error('請輸入習慣名稱');
    row.name = patch.name.trim();
  }
  if ('area_id' in patch) row.area_id = patch.area_id || null;
  if ('target_per_week' in patch) row.target_per_week = Number(patch.target_per_week);
  if ('archived' in patch) row.archived = Boolean(patch.archived);
  return must(await supabase.from('habits').update(row).eq('id', id).select().single());
}

/** 刪除習慣會一併刪除它的打卡紀錄（habit_logs on delete cascade） */
export async function deleteHabit(id) {
  const rows = must(await supabase.from('habits').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

/** 打卡／取消打卡（同一習慣同一天只有一筆）；不能打未來的卡 */
export async function toggleHabitLog(habitId, day, logs) {
  if (day > today()) throw new Error('不能幫未來打卡');
  const hit = logs.find((l) => l.habit_id === habitId && l.log_date === day);
  if (hit) {
    const rows = must(await supabase.from('habit_logs').delete().eq('id', hit.id).select('id'));
    if (rows.length !== 1) throw new Error('取消打卡失敗');
    return false;
  }
  const { error } = await supabase.from('habit_logs').insert({ habit_id: habitId, log_date: day });
  if (error && error.code !== '23505') throw new Error(error.message); // 23505＝已打過卡（另一台裝置），視為成功
  return true;
}

/**
 * 每個習慣的近 7 天、連續天數、本週進度
 * 連續天數：從今天往回數連續有打卡的天數；今天還沒打不算中斷（從昨天開始數）
 */
export function habitStats(habits, logs, day = today()) {
  const byHabit = {};
  for (const l of logs) (byHabit[l.habit_id] ||= new Set()).add(l.log_date);
  const ws = weekStart(day);
  const last7Days = Array.from({ length: 7 }, (_, i) => addDays(day, i - 6));
  return habits.map((h) => {
    const set = byHabit[h.id] || new Set();
    let d = set.has(day) ? day : addDays(day, -1);
    let streak = 0;
    while (set.has(d)) { streak++; d = addDays(d, -1); }
    const weekCount = [...set].filter((x) => x >= ws && x <= day).length;
    return {
      habit: h,
      last7: last7Days.map((x) => ({ day: x, done: set.has(x) })),
      doneToday: set.has(day),
      streak,
      weekCount,
      weekTarget: h.target_per_week,
      weekMet: weekCount >= h.target_per_week,
      total: set.size,
    };
  });
}

// ===== 專案與目標（M9）=====
export const PROJECT_STATUS = { active: '進行中', paused: '暫停', done: '完成' };
export const GOAL_STATUS = { active: '進行中', done: '達成', dropped: '放棄' };

// ===== 工作看板（Phase W）=====
export async function listWorkTags() {
  return must(await supabase.from('work_tags').select('*').order('sort').order('label'));
}

/**
 * 五欄看板（docs/08）：不存每日快照，由任務狀態與日期即時算出，所以任務管理、日曆、總覽看到的是同一份。
 * 本日：新接（今天新增、還沒開始）／進行中（狀態進行中，或今天到期、已過期）／已完成（今天完成）
 * 後續：明天預計（排到下一個工作日）／累積未完成（其他未完成）
 */
export const BOARD_COLUMNS = [
  { id: 'new', label: '新接工作', group: 'today', hint: '今天新開、還沒開始' },
  { id: 'inprogress', label: '進行中工作', group: 'today', hint: '正在處理，或今天到期、已過期' },
  { id: 'done', label: '已完成工作', group: 'today', hint: '今天完成' },
  { id: 'tomorrow', label: '明天預計處理項目', group: 'next', hint: '排到下一個工作日' },
  { id: 'backlog', label: '累積未完成工作', group: 'next', hint: '未完成，不是下一個工作日要做的' },
];

/** 下一個工作日（跳過週六日，同舊看板） */
export function nextWorkingDay(day) {
  let d = addDays(day, 1);
  const dow = (x) => new Date(`${x}T12:00:00+08:00`).getUTCDay();
  while (dow(d) === 0 || dow(d) === 6) d = addDays(d, 1);
  return d;
}

/** 工作看板上的任務：領域有「列入工作看板」（使用者自己在看板的「列入設定」勾選） */
export const isWorkTask = (t, areasById) => areasById[t.area_id]?.on_board === true;
/** 列入看板的領域（看板新增工作時預設用第一個） */
export const boardAreas = (areas) => areas.filter((a) => a.on_board === true);

/** 設定哪些領域列入工作看板：onIds 以外的都取消 */
export async function setBoardAreas(areas, onIds) {
  const want = new Set(onIds);
  const changed = areas.filter((a) => (a.on_board === true) !== want.has(a.id));
  for (const a of changed) {
    const rows = must(await supabase.from('areas').update({ on_board: want.has(a.id) }).eq('id', a.id).select('id'));
    if (rows.length !== 1) throw new Error(`更新領域「${a.name}」失敗`);
  }
  return changed.length;
}

/** 任務在 day 這天的看板欄位；不在看板上（放棄、別天完成）回傳 null */
export function boardColumnOf(t, day) {
  if (t.status === 'dropped') return null;
  if (t.status === 'done') return t.completed_at && localDate(t.completed_at) === day ? 'done' : null;
  if (t.status === 'doing') return 'inprogress';
  const d = taskDay(t);
  if (localDate(t.created_at) === day && (!d || d <= day)) return 'new';
  if (d && d <= day) return 'inprogress';
  if (d === nextWorkingDay(day)) return 'tomorrow';
  return 'backlog';
}

/** day 這天的五欄：{ new: [...], inprogress: [...], ... } */
export function boardColumns(tasks, areasById, day) {
  const cols = Object.fromEntries(BOARD_COLUMNS.map((c) => [c.id, []]));
  for (const t of tasks) {
    if (!isWorkTask(t, areasById)) continue;
    const c = boardColumnOf(t, day);
    if (c) cols[c].push(t);
  }
  for (const id of Object.keys(cols)) cols[id].sort(compareTasks);
  cols.done.sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return cols;
}

// 有時間的排程換到別天時保留時間（台北時間）
const shiftScheduled = (ts, day) => (ts ? fromLocalInput(`${day}T${toLocalInput(ts).slice(11, 16)}`) : null);

/** 拖到某一欄要改什麼（「已完成」另走 setTaskDone）；不能放的情況丟錯誤訊息 */
export function boardMovePatch(t, toCol, day) {
  const d = taskDay(t);
  const next = nextWorkingDay(day);
  switch (toCol) {
    case 'new':
      if (localDate(t.created_at) !== day) throw new Error('「新接」只放今天新增的工作；要今天做請拖到「進行中」');
      return d && d > day ? { status: 'todo', due_date: null, scheduled_start: null } : { status: 'todo' };
    case 'inprogress':
      return { status: 'doing' };
    case 'tomorrow':
      return { status: 'todo', due_date: next, scheduled_start: shiftScheduled(t.scheduled_start, next) };
    case 'backlog':
      // 已經排在下一個工作日之後的保留原日期；其他清掉日期
      return d && d > next ? { status: 'todo' } : { status: 'todo', due_date: null, scheduled_start: null };
    default:
      throw new Error('不明的欄位');
  }
}

// ===== 案件總覽（Phase W4）：一個案件＝一個工作任務 =====
export const CASE_STATUS = { open: '未完成', doing: '進行中', todo: '待辦', done: '已完成', dropped: '放棄', all: '全部' };
const normTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 案件清單（只有列入工作看板的領域）：最後活動＝最新進度、完成、建立三者最晚的那天
 * @returns {{task, lastDay, firstDay, memoCount, search}[]}
 */
export function caseRows(tasks, areasById, memosByTask, projects, workTags) {
  return tasks.filter((t) => isWorkTask(t, areasById)).map((t) => {
    const memos = memosByTask[t.id] || [];
    const days = [localDate(t.created_at), t.completed_at && localDate(t.completed_at), memos[0] && localDate(memos[0].created_at)].filter(Boolean);
    const project = projects.find((p) => p.id === t.project_id)?.name || '';
    const workType = workTags.find((w) => w.id === t.work_type_id)?.label || '';
    return {
      task: t, firstDay: localDate(t.created_at), lastDay: days.sort().at(-1), memoCount: memos.length, project, workType,
      search: [t.case_no, t.title, t.notes, project, workType, ...(t.links || []), ...memos.map((m) => m.body)].join(' ').toLowerCase(),
    };
  });
}

export function filterCases(rows, { q = '', status = 'open', projectId = '', workTypeId = '', sort = 'recent' } = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ok = (r) => {
    const s = r.task.status;
    if (status === 'open' && !(s === 'todo' || s === 'doing')) return false;
    if (!['open', 'all'].includes(status) && s !== status) return false;
    if (projectId && r.task.project_id !== projectId) return false;
    if (workTypeId && r.task.work_type_id !== workTypeId) return false;
    return words.every((w) => r.search.includes(w));
  };
  const by = {
    recent: (a, b) => b.lastDay.localeCompare(a.lastDay) || String(b.task.case_no).localeCompare(String(a.task.case_no)),
    case: (a, b) => String(b.task.case_no || '').localeCompare(String(a.task.case_no || '')),
    created: (a, b) => b.firstDay.localeCompare(a.firstDay),
  }[sort] || (() => 0);
  return rows.filter(ok).sort(by);
}

/** 合併建議：同一個標題（忽略大小寫與空白）卻有多個案件；最早的案件編號當保留的那個 */
export function mergeSuggestions(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = normTitle(r.task.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1)
    .map((g) => g.sort((a, b) => String(a.task.case_no || '~').localeCompare(String(b.task.case_no || '~')) || a.firstDay.localeCompare(b.firstDay)));
}

/** 某個任務的全部計時（案件歷程用；state.entries 只有近期） */
export async function listEntriesForTask(taskId) {
  return must(await supabase.from('time_entries').select('*').eq('task_id', taskId).order('started_at', { ascending: false }));
}

/**
 * 合併案件：把 dropIds 的進度紀錄與計時搬到 keep，連結合併，最後刪掉重複的任務。
 * 實際用時由資料庫觸發器依搬過來的計時重算。回傳搬動的筆數。
 */
export async function mergeCases(keep, drops) {
  if (!keep || !drops.length || drops.some((d) => d.id === keep.id)) throw new Error('請選擇要保留的案件和要合併的案件');
  let memos = 0;
  let entries = 0;
  for (const d of drops) {
    memos += must(await supabase.from('task_memos').update({ task_id: keep.id }).eq('task_id', d.id).select('id')).length;
    entries += must(await supabase.from('time_entries').update({ task_id: keep.id }).eq('task_id', d.id).select('id')).length;
  }
  const links = [...new Set([...(keep.links || []), ...drops.flatMap((d) => d.links || [])])];
  const patch = { links };
  if (drops.some((d) => d.status === 'doing') && keep.status === 'todo') patch.status = 'doing';
  await updateTask(keep.id, patch);
  for (const d of drops) await deleteTask(d.id);
  return { memos, entries, deleted: drops.length };
}

// ===== 常用詞組（Phase W4）=====
export async function listPhrases() {
  return must(await supabase.from('routine_phrases').select('*').order('sort').order('created_at'));
}
export async function savePhrase({ id, body }, phrases = []) {
  const text = String(body || '').trim();
  if (!text) throw new Error('請輸入詞組內容');
  if (text.length > 2000) throw new Error('詞組最多 2000 字');
  if (id) return must(await supabase.from('routine_phrases').update({ body: text }).eq('id', id).select().single());
  const sort = Math.max(0, ...phrases.map((p) => p.sort || 0)) + 1;
  return must(await supabase.from('routine_phrases').insert({ body: text, sort }).select().single());
}
export async function deletePhrase(id) {
  const rows = must(await supabase.from('routine_phrases').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

/** 下一個案件編號（WK-000123）：目前最大的加一 */
export function nextCaseNo(tasks) {
  const max = tasks.reduce((m, t) => Math.max(m, Number(/^WK-(\d+)$/.exec(t.case_no || '')?.[1] || 0)), 0);
  return `WK-${String(max + 1).padStart(6, '0')}`;
}

/** 在看板新增工作：自動給案件編號；編號被搶先用掉時（另一台裝置同時新增）重試一次 */
export async function createWorkTask(task, tasks) {
  try {
    return await createTask({ ...task, case_no: nextCaseNo(tasks) }, tasks);
  } catch (e) {
    if (!/duplicate|23505/.test(e.message)) throw e;
    return createTask({ ...task, case_no: nextCaseNo(await listTasks()) }, tasks);
  }
}

export async function listProjects() {
  return must(await supabase.from('projects').select('*').order('created_at'));
}

export async function listGoals() {
  return must(await supabase.from('goals').select('*').order('created_at'));
}

export async function saveProject(p) {
  const row = {
    name: p.name?.trim(), area_id: p.area_id, status: p.status || 'active',
    next_action: p.next_action?.trim() || null, notes: p.notes?.trim() || null, updated_at: new Date().toISOString(),
    start_date: p.start_date || null, end_date: p.end_date || null,
  };
  if (!row.name) throw new Error('請輸入專案名稱');
  if (row.start_date && row.end_date && row.end_date < row.start_date) throw new Error('結束日不能早於開始日');
  if (!row.area_id) throw new Error('請選擇領域');
  if (!PROJECT_STATUS[row.status]) throw new Error('狀態不正確');
  if (p.id) return must(await supabase.from('projects').update(row).eq('id', p.id).select().single());
  return must(await supabase.from('projects').insert(row).select().single());
}

export async function saveGoal(g) {
  const row = { title: g.title?.trim(), area_id: g.area_id, due_date: g.due_date || null, status: g.status || 'active' };
  if (!row.title) throw new Error('請輸入目標');
  if (!row.area_id) throw new Error('請選擇領域');
  if (!GOAL_STATUS[row.status]) throw new Error('狀態不正確');
  if (g.id) return must(await supabase.from('goals').update(row).eq('id', g.id).select().single());
  return must(await supabase.from('goals').insert(row).select().single());
}

/** 刪除專案或目標：掛在上面的任務不會被刪，只會取消關聯（on delete set null） */
export async function deleteProject(id) {
  const rows = must(await supabase.from('projects').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}
export async function deleteGoal(id) {
  const rows = must(await supabase.from('goals').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

/** 進度＝已完成任務／全部任務（不含放棄的） */
export function progressOf(tasks, key, id) {
  const list = tasks.filter((t) => t[key] === id && t.status !== 'dropped');
  const done = list.filter((t) => t.status === 'done').length;
  return { total: list.length, done, pct: list.length ? Math.round((100 * done) / list.length) : 0, tasks: list.sort(compareTasks) };
}

/**
 * 專案的「下一步」：有手寫的 next_action 就用它；沒有就自動遞補成專案裡排最前面的未完成任務
 * （順序同任務管理與專案卡片的拖移排序）。勾掉後下一件自動往上遞補。
 * @returns {{kind:'manual', text:string} | {kind:'task', task:object} | null}
 */
export function nextStepOf(project, tasks) {
  if (project.next_action?.trim()) return { kind: 'manual', text: project.next_action.trim() };
  const t = tasks.filter((x) => x.project_id === project.id && isOpen(x)).sort(compareTasks)[0];
  return t ? { kind: 'task', task: t } : null;
}

/** 總覽：各領域進行中專案的下一步 */
export function activeProjectsByArea(projects, areas) {
  return areas.map((a) => ({ area: a, projects: projects.filter((p) => p.area_id === a.id && p.status === 'active') }))
    .filter((g) => g.projects.length);
}

/**
 * 甘特圖資料。專案的時間條：有填開始／結束日就用；沒填的那一端用掛在專案上的任務日期推算（inferred）。
 * 任務以「到期日，沒有則排程日」標在專案那一列；目標以期限當里程碑。
 */
export function ganttData(projects, goals, tasks, day = today()) {
  const rows = projects.map((p) => {
    const pr = progressOf(tasks, 'project_id', p.id);
    const marks = pr.tasks.map((t) => ({ task: t, day: taskDay(t) })).filter((m) => m.day).sort((a, b) => a.day.localeCompare(b.day));
    const tStart = marks[0]?.day;
    const tEnd = marks.at(-1)?.day;
    let start = p.start_date || tStart || null;
    let end = p.end_date || tEnd || null;
    if (start && !end) end = start;
    if (end && !start) start = end;
    if (start && end && end < start) [start, end] = [end, start];
    return { project: p, start, end, inferred: !p.start_date || !p.end_date, progress: pr, marks };
  });
  const milestones = goals.filter((g) => g.due_date && g.status !== 'dropped').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const dates = [day, ...rows.flatMap((r) => [r.start, r.end, ...r.marks.map((m) => m.day)]), ...milestones.map((g) => g.due_date)].filter(Boolean).sort();
  return { rows, milestones, min: dates[0], max: dates.at(-1) };
}

// ===== 資料與備份（M8）=====
// 匯出／匯入的資料表，順序＝匯入順序（先被參照的在前）
export const BACKUP_TABLES = ['areas', 'projects', 'goals', 'work_tags', 'tasks', 'task_memos', 'time_entries',
  'daily_reviews', 'notes', 'habits', 'habit_logs', 'routine_phrases'];
export const BACKUP_LABELS = {
  areas: '領域', projects: '專案', goals: '目標', tasks: '任務', task_memos: '進度 memo', time_entries: '計時紀錄',
  daily_reviews: '每日復盤', notes: '靈感', habits: '習慣', habit_logs: '打卡',
  work_tags: '工作種類', routine_phrases: '常用詞組',
};
const PAGE = 1000; // 一次讀 1000 筆，分頁讀完，避免被 API 單次筆數上限截斷

async function fetchAll(table) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await supabase.from(table).select('*').order('id').range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** 匯出全部資料（不含 user_id，換帳號也能匯入） */
export async function exportAll() {
  const tables = {};
  for (const t of BACKUP_TABLES) {
    tables[t] = (await fetchAll(t)).map(({ user_id, ...row }) => row);
  }
  return { app: 'life-os', version: 1, exported_at: new Date().toISOString(), tables };
}

// 各表的關聯欄位 → 參照的表（匯入時要換成新 id）
const BACKUP_REFS = {
  projects: { area_id: 'areas' },
  goals: { area_id: 'areas' },
  tasks: { area_id: 'areas', project_id: 'projects', goal_id: 'goals', work_type_id: 'work_tags' },
  task_memos: { task_id: 'tasks' },
  time_entries: { area_id: 'areas', task_id: 'tasks' },
  notes: { area_id: 'areas' },
  habits: { area_id: 'areas' },
  habit_logs: { habit_id: 'habits' },
};
// 內容比對用的鍵：id 不同但內容相同（例如同一份備份第二次匯入到另一個帳號）也視為已存在
const NATURAL_KEY = {
  areas: (r) => r.name,
  projects: (r) => `${r.name}|${r.created_at}`,
  goals: (r) => `${r.title}|${r.created_at}`,
  tasks: (r) => `${r.title}|${r.created_at}`,
  task_memos: (r) => `${r.task_id}|${r.body}|${r.created_at}`,
  time_entries: (r) => `${r.task_id}|${r.started_at}|${r.ended_at}`,
  daily_reviews: (r) => r.review_date,
  notes: (r) => `${r.title}|${r.created_at}`,
  habits: (r) => `${r.name}|${r.created_at}`,
  habit_logs: (r) => `${r.habit_id}|${r.log_date}`,
  work_tags: (r) => r.label,
  routine_phrases: (r) => r.body,
};
// 必填的關聯：找不到對應就整筆略過（其餘找不到就設為空）
const REQUIRED_REFS = { tasks: ['area_id'], task_memos: ['task_id'], time_entries: ['area_id'], habit_logs: ['habit_id'],
  projects: ['area_id'], goals: ['area_id'] };

/**
 * 匯入前的計畫（不寫入）：只新增、不覆蓋、不刪除。
 * - 目前帳號已有同一筆（同 id）→ 略過，所以重複匯入同一份備份不會變兩份
 * - 領域同名 → 併入既有領域
 * - 新增的資料一律給新 id 並改寫關聯，匯入到另一個帳號也不會撞號
 * - 同一天的復盤、同一習慣同一天的打卡已存在、進行中的計時 → 略過
 */
export async function planImport(backup) {
  if (backup?.app !== 'life-os' || !backup.tables) throw new Error('這不是 Life OS 的備份檔');
  const current = {};
  for (const t of BACKUP_TABLES) current[t] = await fetchAll(t);
  const has = Object.fromEntries(BACKUP_TABLES.map((t) => [t, new Set(current[t].map((r) => r.id))]));
  const byKey = Object.fromEntries(BACKUP_TABLES.map((t) => [t, new Map(current[t].map((r) => [NATURAL_KEY[t](r), r.id]))]));
  const idMap = Object.fromEntries(BACKUP_TABLES.map((t) => [t, {}])); // 備份 id → 匯入後的 id
  const byCase = new Map(current.tasks.filter((r) => r.case_no).map((r) => [r.case_no, r.id]));
  const plan = {};
  for (const t of BACKUP_TABLES) {
    const rows = Array.isArray(backup.tables[t]) ? backup.tables[t] : [];
    const add = [];
    let skip = 0;
    for (const raw of rows) {
      const { user_id, ...r } = raw;
      if (has[t].has(r.id)) { idMap[t][r.id] = r.id; skip++; continue; }
      let ok = true;
      for (const [col, ref] of Object.entries(BACKUP_REFS[t] || {})) {
        if (r[col] == null) continue;
        const mapped = idMap[ref][r[col]];
        if (mapped) r[col] = mapped;
        else if (REQUIRED_REFS[t]?.includes(col)) ok = false;
        else r[col] = null;
      }
      // 復盤的投入程度以任務 id 為鍵，也要換成新 id（找不到的任務就丟掉那一筆）
      if (t === 'daily_reviews' && r.work_effort && typeof r.work_effort === 'object') {
        r.work_effort = Object.fromEntries(Object.entries(r.work_effort)
          .map(([k, v]) => [idMap.tasks[k], v]).filter(([k]) => k));
      }
      // 關聯換成新 id 之後再比內容，才能比對到「已匯入過、id 不同」的那筆
      // 任務有案件編號時，同編號就是同一件工作（改過標題也算），避免撞到唯一索引
      const same = ok && ((t === 'tasks' && r.case_no && byCase.get(r.case_no)) || byKey[t].get(NATURAL_KEY[t](r)));
      if (same) { idMap[t][r.id] = same; skip++; continue; }
      if (!ok || (t === 'time_entries' && !r.ended_at)) { skip++; continue; }
      const newId = crypto.randomUUID();
      idMap[t][r.id] = newId;
      add.push({ ...r, id: newId });
      byKey[t].set(NATURAL_KEY[t](r), newId);
      if (t === 'tasks' && r.case_no) byCase.set(r.case_no, newId);
    }
    plan[t] = { add, skip };
  }
  return plan;
}

/** 依計畫寫入；回傳每張表實際新增的筆數 */
export async function runImport(plan) {
  const result = {};
  for (const t of BACKUP_TABLES) {
    const rows = plan[t]?.add || [];
    let n = 0;
    for (let i = 0; i < rows.length; i += 500) {
      n += must(await supabase.from(t).insert(rows.slice(i, i + 500)).select('id')).length;
    }
    result[t] = n;
  }
  return result;
}

// ===== Google 日曆同步（Phase 5.5）=====
export const ICS_PREFIX = 'https://calendar.google.com/calendar/ical/';

export async function getCalendarSync() {
  return must(await supabase.from('calendar_sync').select('*').maybeSingle());
}

async function upsertCalendarSync(patch) {
  const session = await getSession();
  return must(await supabase.from('calendar_sync').upsert(
    { user_id: session.user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' },
  ).select().single());
}

/** 儲存 Google 日曆「iCal 格式私密網址」；空字串＝停止讀取 */
export function saveIcsUrl(url) {
  const v = String(url || '').trim();
  if (v && !v.startsWith(ICS_PREFIX)) throw new Error('請貼 Google 日曆的「iCal 格式私密網址」，開頭是 https://calendar.google.com/calendar/ical/');
  if (v && !v.endsWith('.ics')) throw new Error('網址應以 .ics 結尾，請確認有複製完整');
  return upsertCalendarSync({ google_ics_url: v || null });
}

export function setPushEnabled(on) {
  return upsertCalendarSync({ push_enabled: Boolean(on) });
}

async function invokeFn(name, body = {}) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // 函式回傳的錯誤訊息在 error.context 裡
    let msg = error.message;
    try { msg = (await error.context?.json())?.error || msg; } catch { /* 忽略 */ }
    if (/Failed to send|not found|404/i.test(msg)) msg = '找不到同步服務，請先依 docs/06-google-sync-setup.md 部署 Edge Functions';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

/** 立即同步（讀＋寫），回傳本人的同步結果 */
export async function syncGoogleNow() {
  const data = await invokeFn('google-sync');
  return data?.results?.[0] || null;
}

/** 取得 Google 授權網址，整頁轉過去 */
export async function startGoogleConnect() {
  const back = new URL(location.href);
  back.hash = '';
  back.searchParams.delete('google');
  back.searchParams.delete('google_msg');
  const data = await invokeFn('google-oauth-start', { return_to: back.toString() });
  location.href = data.url;
}

/** 外部會議（唯讀），fromDay～toDay（台北日期，含頭尾） */
export async function listExternalEvents(fromDay, toDay) {
  return must(await supabase.from('external_events').select('*')
    .gte('starts_at', dayStartISO(addDays(fromDay, -1))).lt('starts_at', dayStartISO(addDays(toDay, 1)))
    .order('starts_at'));
}

/** 依台北日期分組；跨天的全天活動在每一天都出現 */
export function externalByDay(events, fromDay, toDay) {
  const map = {};
  for (const e of events) {
    const first = localDate(e.starts_at);
    // ends_at 是「結束的那一刻」，全天活動的結束日不算在內
    const last = e.ends_at ? localDate(new Date(new Date(e.ends_at).getTime() - 1)) : first;
    for (let d = first; d <= last && d <= toDay; d = addDays(d, 1)) {
      if (d >= fromDay) (map[d] ||= []).push(e);
    }
  }
  for (const list of Object.values(map)) list.sort((a, b) => (b.all_day - a.all_day) || a.starts_at.localeCompare(b.starts_at));
  return map;
}

// ===== 衍生規則 =====
function scheduledDay(t) {
  return t.scheduled_start ? localDate(t.scheduled_start) : null;
}

/** 任務的代表日期：due_date 優先，否則 scheduled_start 的台北日期（與 daily_summary 相同） */
export function taskDay(t) {
  return t.due_date || scheduledDay(t);
}

/** 任務在統計與復盤上屬於哪一天（同 daily_summary，migration 20261104b）：已完成＝完成那天；未完成＝到期／排程日 */
export function summaryDay(t) {
  return t.status === 'done' && t.completed_at ? localDate(t.completed_at) : taskDay(t);
}

/** 「當日應處理」：due_date 或 scheduled_start 落在當日、且 status≠dropped（docs/02 聯動規則 6） */
export function isDueOn(t, day) {
  return t.status !== 'dropped' && (t.due_date === day || scheduledDay(t) === day);
}

export const isOpen = (t) => t.status === 'todo' || t.status === 'doing';

export const RANGES = {
  all: '全部',
  today: '今天',
  week: '未來 7 天',
  overdue: '已過期',
  nodate: '未排日期',
};

/**
 * 任務列表篩選
 * @param {{range:string, areaId:string, priority:string, showDone:boolean}} f
 */
export function filterTasks(tasks, f, day = today()) {
  const weekEnd = addDays(day, 6);
  return tasks.filter((t) => {
    if (!f.showDone && !isOpen(t)) return false;
    if (f.areaId && t.area_id !== f.areaId) return false;
    if (f.priority && String(t.priority) !== String(f.priority)) return false;
    const d = taskDay(t);
    switch (f.range) {
      case 'today': return isDueOn(t, day);
      case 'week': return d != null && d >= day && d <= weekEnd;
      case 'overdue': return d != null && d < day && isOpen(t);
      case 'nodate': return d == null;
      default: return true;
    }
  }).sort(compareTasks);
}

/** 排序：未完成在前 → 手動順序（sort_order）→ 星標 → 優先級 → 日期（無日期最後） */
export function compareTasks(a, b) {
  const ao = a.sort_order ?? Infinity;
  const bo = b.sort_order ?? Infinity;
  return (isOpen(b) - isOpen(a))
    || (ao === bo ? 0 : ao < bo ? -1 : 1)
    || (b.starred - a.starred)
    || (a.priority - b.priority)
    || (taskDay(a) || '9999').localeCompare(taskDay(b) || '9999');
}

export function openCount(tasks) {
  return tasks.filter(isOpen).length;
}

/** 總覽所需的今日資料 */
export function todayOverview(tasks, day = today()) {
  const due = tasks.filter((t) => isDueOn(t, day));
  const todo = due.filter(isOpen).sort(compareTasks);
  // 今日最重要的 3 件事：未完成的星標任務，今天到期者優先
  const top3 = tasks.filter((t) => t.starred && isOpen(t))
    .sort((a, b) => (isDueOn(b, day) - isDueOn(a, day)) || compareTasks(a, b))
    .slice(0, 3);
  return { todo, top3 };
}

/** 當日彙總數字讀資料庫 view daily_summary（聯動規則 4） */
export async function getDailySummary(day = today(), { work = false } = {}) {
  // 工作／生活分開算（migration 20261104b 的 is_work）；還沒執行那個 migration 時退回舊的整體彙總
  let res = await supabase.from('daily_summary').select('*').eq('day', day).eq('is_work', work).maybeSingle();
  if (res.error && /is_work/.test(res.error.message || '')) res = await supabase.from('daily_summary').select('*').eq('day', day).maybeSingle();
  const row = must(res);
  return row || { day, tasks_total: 0, tasks_done: 0, completion_pct: null, actual_min: 0, estimate_min: 0, actual_sec: 0 };
}
