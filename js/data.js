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
  supabase.auth.onAuthStateChange((event, session) => cb(session, event));
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

// ===== 密碼（docs/09「修改密碼與忘記密碼」）=====
// Supabase 預設最少 6 碼（supabase/auth 原始碼 defaultMinPasswordLength = 6；後台可調高）
export const PASSWORD_MIN = 6;

/** 已登入時修改密碼：先用目前密碼重新驗證，再更新。錯誤訊息已轉成中文 */
export async function changePassword(currentPassword, newPassword) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('登入已失效，請重新登入');
  const check = await supabase.auth.signInWithPassword({ email: session.user.email, password: currentPassword });
  if (check.error) throw new Error(authErrorText(check.error.message, '目前密碼不正確'));
  await updatePassword(newPassword);
}

/** 直接設定新密碼（忘記密碼的信件連結回來後用；此時已有臨時登入狀態） */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(authErrorText(error.message));
}

/** 寄重設密碼信；redirectTo 是信件連結回來的網址，必須在 Supabase 後台的 Redirect URLs 名單內 */
export async function requestPasswordReset(email, redirectTo) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw new Error(authErrorText(error.message));
  return data;
}

/** 把 Supabase Auth 的英文錯誤轉成看得懂的中文；認不得的保留原文 */
export function authErrorText(msg = '', invalidCredentials = 'Email 或密碼錯誤') {
  const m = String(msg);
  if (/invalid login credentials/i.test(m)) return invalidCredentials;
  if (/different from the old password/i.test(m)) return '新密碼不能和目前的密碼相同';
  const len = m.match(/at least (\d+) characters/i);
  if (len) return `密碼太短，至少要 ${len[1]} 碼`;
  if (/weak|pwned|leaked/i.test(m)) return `密碼強度不足，請換一個更難猜的密碼（${m}）`;
  if (/session missing|session not found|jwt expired|invalid jwt/i.test(m)) return '登入已失效（重設連結可能已過期），請重新登入或重新申請重設密碼';
  if (/reauthenticat/i.test(m)) return `Supabase 後台開啟了「修改密碼需重新驗證」，目前介面尚未支援（${m}）`;
  if (/rate limit|security purposes|too many/i.test(m)) return '請求太頻繁，請稍後再試';
  if (/failed to fetch|network/i.test(m)) return '連線失敗，請確認網路後再試';
  if (/redirect/i.test(m)) return `重設連結的網址不被允許，請到 Supabase 後台把網站網址加進 Redirect URLs（${m}）`;
  return m;
}

// ===== 領域 =====
export const DEFAULT_AREAS = [
  // 20261105：開放給其他人用，新帳號的預設改成通用名稱（舊帳號已有領域，不受影響）；工作預設列入工作看板
  { name: '工作', kind: 'work', color: '#3b6fd8', sort: 1, on_board: true },
  { name: '職涯與學習', kind: 'career', color: '#8a5cd6', sort: 2 },
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
  'starred', 'due_date', 'scheduled_start', 'estimate_min', 'sort_order', 'links', 'case_no', 'work_type_id',
  'board_parked', 'work_project_tag_id']; // 20261106：看板停在累積未完成、看板專案標籤

function pickTask(obj) {
  if (obj.links != null) assertWebLinks(obj.links); // 資安 20261111：任務連結只收 http(s)
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

/**
 * 專案卡片新增任務：排在這個專案最後一件未完成任務的後面（不搶「下一步」）；專案還沒有任務時照一般新增。
 * 順序用和拖移相同的 moveTask＋reorderTasks 寫入，任務管理頁看到的順序一致。
 */
export async function createTaskAtProjectEnd(task, existing = []) {
  const last = existing.filter((t) => t.project_id === task.project_id && isOpen(t)).sort(compareTasks).at(-1);
  const created = await createTask(task, existing);
  if (!last) return created;
  const all = [...existing, created];
  await reorderTasks(moveTask(all, created.id, null, last.id), Object.fromEntries(all.map((t) => [t.id, t])));
  return created;
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
  await trashDelete('task_memos', id); // 20261106：先進垃圾桶，30 天內可還原
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
  await trashDelete('tasks', id); // 20261106：先進垃圾桶，30 天內可還原
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
  await trashDelete('time_entries', id); // 20261106：先進垃圾桶，30 天內可還原
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
  return rows.filter((r) => REVIEW_NOTE_KEYS.some((k) => r[k]?.trim())); // 生活復盤（工作的 Wrap up 在工作看板）
}

/** 生活復盤的手寫欄（晚上）：收獲、問題、明日改進＋顯化規劃的里程碑、感恩（migration 20261108_manifest） */
export const REVIEW_NOTE_KEYS = ['gains', 'problems', 'tomorrow_improve', 'milestones', 'gratitude'];
/** 顯化規劃的早上兩欄：今日身分、肯定語（同一筆 daily_reviews） */
export const REVIEW_INTENT_KEYS = ['identity', 'affirmation'];
const REVIEW_TEXT_KEYS = [...REVIEW_NOTE_KEYS, ...REVIEW_INTENT_KEYS];

/**
 * 同一天只有一筆（unique user_id + review_date），存檔用 upsert。
 * 只寫傳進來的欄位（undefined 的不寫），所以總覽存今日身分不會蓋掉晚上的復盤，反之亦然（同 saveMood）。
 */
export async function saveReview(day, fields) {
  const row = {};
  for (const k of REVIEW_TEXT_KEYS) {
    if (fields[k] !== undefined) row[k] = typeof fields[k] === 'string' ? (fields[k].trim() || null) : (fields[k] ?? null);
  }
  if (!Object.keys(row).length) throw new Error('沒有要儲存的欄位');
  const session = await getSession();
  return must(await supabase.from('daily_reviews').upsert({
    user_id: session.user.id, review_date: day, ...row, updated_at: new Date().toISOString(),
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
  await trashDelete('notes', id); // 20261106：先進垃圾桶，30 天內可還原
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
  await trashDelete('habits', id); // 20261106：先進垃圾桶，30 天內可還原
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
 * 本日：新接（今天新增、還沒開始）／進行中（狀態進行中，或今天到期、已過期，或之前新接沒填日期還沒做完）／已完成（今天完成）
 * 後續：明天預計（排到下一個工作日）／累積未完成（其他未完成）
 */
export const BOARD_COLUMNS = [
  { id: 'new', label: '新接工作', group: 'today', hint: '今天新開、還沒開始' },
  { id: 'inprogress', label: '進行中工作', group: 'today', hint: '正在處理、今天到期或已過期，或之前新接還沒做完' },
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
  // 20261106：拖進「累積未完成」的會留在那裡，直到日期排到今天／下一個工作日或被拖到別欄
  if (t.board_parked && !(d && d <= nextWorkingDay(day))) return 'backlog';
  const created = localDate(t.created_at);
  if (created === day && (!d || d <= day)) return 'new';
  if (d && d <= day) return 'inprogress';
  // 20261107：以前在「新接」、沒填日期也沒拖去累積的，下一個工作日起自動在「進行中」（不用手動拖）。
  // 只看 board_parked 上線（20261106）之後建立的：更早拖去累積未完成的當時沒有標記，不能把它們拉回來。
  if (!d && created < day && created >= BOARD_CARRY_SINCE) return 'inprogress';
  if (d === nextWorkingDay(day)) return 'tomorrow';
  return 'backlog';
}
/** 沒日期的工作從這天建立的起，隔日自動進行中（這天起拖去累積未完成才會記 board_parked） */
export const BOARD_CARRY_SINCE = '2026-11-06';

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
      return d && d > day ? { status: 'todo', due_date: null, scheduled_start: null, board_parked: false } : { status: 'todo', board_parked: false };
    case 'inprogress':
      return { status: 'doing', board_parked: false };
    case 'tomorrow':
      return { status: 'todo', due_date: next, scheduled_start: shiftScheduled(t.scheduled_start, next), board_parked: false };
    case 'backlog':
      // 已經排在下一個工作日之後的保留原日期；其他清掉日期。標記 board_parked 才不會因「今天新增」彈回新接
      return d && d > next ? { status: 'todo', board_parked: true } : { status: 'todo', due_date: null, scheduled_start: null, board_parked: true };
    default:
      throw new Error('不明的欄位');
  }
}

// ===== 案件總覽（Phase W4）：一個案件＝同一個案件編號的所有工作任務（20261111 起可多張卡；沒有編號的一張卡一個案件）=====
export const CASE_STATUS = { open: '未完成', doing: '進行中', todo: '待辦', done: '已完成', dropped: '放棄', all: '全部' };
const normTitle = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * 案件清單（只有列入工作看板的領域）：同案號的卡併成一列（caseGroups）。
 * task＝代表卡（還有未完成的就是最新那張未完成的，否則最新那張），title＝最新一張卡的標題，status＝有未完成的卡就是未完成；
 * 第一天＝最早建立，最後活動＝所有卡的最新進度、完成、建立最晚的那天；進度數與搜尋涵蓋所有卡
 * @returns {{key, task, tasks, title, status, lastDay, firstDay, memoCount, search}[]}
 */
export function caseRows(tasks, areasById, memosByTask, projects, workTags) {
  return caseGroups(tasks.filter((t) => isWorkTask(t, areasById))).map((cards) => {
    const task = caseLead(cards);
    const memos = cards.flatMap((t) => memosByTask[t.id] || []);
    const days = cards.flatMap((t) => [localDate(t.created_at), t.completed_at && localDate(t.completed_at)])
      .concat(memos.map((m) => localDate(m.created_at))).filter(Boolean).sort();
    const project = projects.find((p) => p.id === task.project_id)?.name || '';
    const workType = workTags.find((w) => w.id === task.work_type_id)?.label || '';
    return {
      key: caseKeyOf(task), task, tasks: cards, title: cards.at(-1).title, status: caseStatus(cards),
      firstDay: days[0], lastDay: days.at(-1), memoCount: memos.length, project, workType,
      search: [task.case_no, ...cards.flatMap((t) => [t.title, t.notes, ...(t.links || [])]), project, workType, ...memos.map((m) => m.body)]
        .join(' ').toLowerCase(),
    };
  });
}

export function filterCases(rows, { q = '', status = 'open', projectId = '', workTypeId = '', sort = 'recent' } = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ok = (r) => {
    const s = r.status || r.task.status; // 20261111：案件的狀態（有未完成的卡就是未完成）
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

/** 合併建議：同一個標題（忽略大小寫與空白）卻有多個案件編號（同案號的卡已併成一列）；最早的案件編號當保留的那個 */
export function mergeSuggestions(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = normTitle(r.title ?? r.task.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter((g) => g.length > 1)
    // 沒有編號的排後面（原本用 '~' 墊底，但 localeCompare 會把符號排在英數字前面，20261111 修正）
    .map((g) => g.sort((a, b) => (a.task.case_no ? 0 : 1) - (b.task.case_no ? 0 : 1)
      || String(a.task.case_no || '').localeCompare(String(b.task.case_no || '')) || a.firstDay.localeCompare(b.firstDay)));
}

/** 某個任務的全部計時（案件歷程用；state.entries 只有近期） */
export async function listEntriesForTask(taskId) {
  return must(await supabase.from('time_entries').select('*').eq('task_id', taskId).order('started_at', { ascending: false }));
}

// 合併案件：20261111 起改成 mergeCaseNos（只改案號，不搬進度、不刪卡），見檔案末段

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
  await trashDelete('routine_phrases', id); // 20261106：先進垃圾桶，30 天內可還原
}

/** 下一個案件編號（WK-000123）：目前最大的加一 */
export function nextCaseNo(tasks) {
  const max = tasks.reduce((m, t) => Math.max(m, Number(/^WK-(\d+)$/.exec(t.case_no || '')?.[1] || 0)), 0);
  return `WK-${String(max + 1).padStart(6, '0')}`;
}

/** 在看板新增工作：沒指定案號（沿用既有案件，20261111）就給下一個案件編號 */
export async function createWorkTask(task, tasks) {
  return createTask({ ...task, case_no: task.case_no || nextCaseNo(tasks) }, tasks);
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
  if ('period' in g) row.period = g.period || null; // Phase J：沒傳就不動，專案頁編輯目標不會清掉期間
  if ('project_id' in g) row.project_id = g.project_id || null; // 20261106：沒傳就不動
  if ('mainline' in g) row.mainline = Boolean(g.mainline); // 20261108 身分主線：沒傳就不動（年度頁勾達成、規劃表匯入都不會清掉）
  if (row.period && !isPeriod(row.period)) throw new Error('期間格式不正確');
  if (!row.title) throw new Error('請輸入目標');
  if (!row.area_id) throw new Error('請選擇領域');
  if (!GOAL_STATUS[row.status]) throw new Error('狀態不正確');
  if (g.id) return must(await supabase.from('goals').update(row).eq('id', g.id).select().single());
  return must(await supabase.from('goals').insert(row).select().single());
}

/** 刪除專案或目標：掛在上面的任務不會被刪，只會取消關聯（on delete set null） */
export async function deleteProject(id) {
  await trashDelete('projects', id); // 20261106：先進垃圾桶，30 天內可還原
}
export async function deleteGoal(id) {
  await trashDelete('goals', id); // 20261106：先進垃圾桶，30 天內可還原
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

/**
 * 顯化規劃・身分主線任務（總覽早上區塊；不另存，每次由 goals／projects／tasks 算出）。
 * - 有勾 mainline 的目標（未放棄）：列它們所屬專案（goals.project_id，未完成的專案）的下一步，
 *   同一專案只列一次；下一步一律用 nextStepOf（與專案卡片同一函式），勾完會自動遞補。
 * - 沒有任何主線目標：列生活領域進行中專案的下一步，最多 3 個（依領域順序；沒有下一步的略過）。
 * @returns {{ mode:'mainline'|'fallback', items:{project, goals:object[], step}[], unlinked:object[] }}
 *   unlinked＝主線目標但沒掛專案（只在 mainline 模式）
 */
export function mainlineSteps(st, max = 3) {
  const mainGoals = st.goals.filter((g) => g.mainline && g.status !== 'dropped');
  if (mainGoals.length) {
    const byProject = new Map();
    const unlinked = [];
    for (const g of mainGoals) {
      const p = g.project_id && st.projects.find((x) => x.id === g.project_id);
      if (!p || p.status === 'done') { if (!g.project_id) unlinked.push(g); continue; }
      if (!byProject.has(p.id)) byProject.set(p.id, { project: p, goals: [], step: nextStepOf(p, st.tasks) });
      byProject.get(p.id).goals.push(g);
    }
    return { mode: 'mainline', items: [...byProject.values()], unlinked };
  }
  const items = activeProjectsByArea(st.life.projects, st.life.areas)
    .flatMap((grp) => grp.projects)
    .map((p) => ({ project: p, goals: [], step: nextStepOf(p, st.tasks) }))
    .filter((x) => x.step)
    .slice(0, max);
  return { mode: 'fallback', items, unlinked: [] };
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
  'daily_reviews', 'notes', 'habits', 'habit_logs', 'routine_phrases',
  'period_reviews', 'future_events', 'media_items', 'bucket_items',
  'inbox_items', 'contact_stages', 'contacts', 'contact_logs',
  'reflections', // 20261108 內在整理（參照 tasks、areas，所以排在它們之後）
  'feedback', // 20261111 回饋匣（不參照其他表）
  'quotes']; // 20261112 佳句本（參照 media_items）
export const BACKUP_LABELS = {
  areas: '領域', projects: '專案', goals: '目標', tasks: '任務', task_memos: '進度 memo', time_entries: '計時紀錄',
  daily_reviews: '每日復盤', notes: '靈感', habits: '習慣', habit_logs: '打卡',
  work_tags: '工作種類', routine_phrases: '常用詞組',
  period_reviews: '月／季／年回顧', future_events: 'Future Log', media_items: '書影單', bucket_items: '想做清單',
  inbox_items: '待看清單', contact_stages: '跟進階段', contacts: '跟進對象', contact_logs: '聯絡紀錄',
  reflections: '內在整理', feedback: '回饋', quotes: '佳句本',
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
  goals: { area_id: 'areas', project_id: 'projects' },
  tasks: { area_id: 'areas', project_id: 'projects', goal_id: 'goals', work_type_id: 'work_tags', work_project_tag_id: 'work_tags' },
  task_memos: { task_id: 'tasks' },
  time_entries: { area_id: 'areas', task_id: 'tasks' },
  notes: { area_id: 'areas' },
  habits: { area_id: 'areas', project_id: 'projects', goal_id: 'goals' },
  habit_logs: { habit_id: 'habits' },
  future_events: { area_id: 'areas' },
  media_items: { area_id: 'areas', note_id: 'notes' },
  bucket_items: { area_id: 'areas' },
  inbox_items: { area_id: 'areas' },
  contacts: { stage_id: 'contact_stages' },
  contact_logs: { contact_id: 'contacts' },
  reflections: { task_id: 'tasks', area_id: 'areas' },
  quotes: { media_id: 'media_items' },
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
  work_tags: (r) => `${r.kind || 'type'}|${r.label}`,
  routine_phrases: (r) => r.body,
  period_reviews: (r) => r.period,
  future_events: (r) => `${r.month}|${r.day ?? ''}|${r.title}`,
  media_items: (r) => `${r.kind}|${r.title}|${r.created_at}`,
  bucket_items: (r) => `${r.title}|${r.created_at}`,
  inbox_items: (r) => `${r.url || ''}|${r.created_at}`,
  contact_stages: (r) => r.label,
  contacts: (r) => `${r.name}|${r.created_at}`,
  contact_logs: (r) => `${r.contact_id}|${r.log_date}|${r.created_at}`,
  reflections: (r) => `${r.kind}|${r.entry_date}|${r.created_at}`,
  feedback: (r) => `${r.created_at}|${r.body}`,
  quotes: (r) => `${r.body}|${r.created_at}`,
};
// 必填的關聯：找不到對應就整筆略過（其餘找不到就設為空）
const REQUIRED_REFS = { contact_logs: ['contact_id'], tasks: ['area_id'], task_memos: ['task_id'], time_entries: ['area_id'], habit_logs: ['habit_id'],
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
  // 20261111：案件編號可重複（一個案件多張卡），不能再用案號當同一筆；改用「案號＋建立時間」（改過標題也認得）
  const caseKey = (r) => `${r.case_no}|${r.created_at}`;
  const byCase = new Map(current.tasks.filter((r) => r.case_no).map((r) => [caseKey(r), r.id]));
  const plan = { _droppedLinks: 0 }; // 資安 20261111：備份檔裡不是 http(s) 的連結丟掉的個數
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
      // 任務有案件編號時，同編號、同建立時間就是同一張卡（改過標題也算）；其餘照內容比對（標題＋建立時間）
      const same = ok && ((t === 'tasks' && r.case_no && byCase.get(caseKey(r))) || byKey[t].get(NATURAL_KEY[t](r)));
      if (same) { idMap[t][r.id] = same; skip++; continue; }
      if (!ok || (t === 'time_entries' && !r.ended_at)) { skip++; continue; }
      plan._droppedLinks += cleanImportLinks(t, r);
      if (t === 'inbox_items' && !r.url && !r.title?.trim() && !r.body?.trim()) { skip++; continue; } // 只有壞連結的待看項目
      const newId = crypto.randomUUID();
      idMap[t][r.id] = newId;
      add.push({ ...r, id: newId });
      byKey[t].set(NATURAL_KEY[t](r), newId);
      if (t === 'tasks' && r.case_no) byCase.set(caseKey(r), newId);
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

/**
 * 讀網頁標題（Edge Function link-title；瀏覽器因 CORS 讀不到別的網站）。
 * 回傳 { title, reason }：讀到標題時 title 有值；讀不到時 title 為空、reason 說明原因（不丟錯，呼叫端照常新增）。
 */
export async function fetchLinkTitle(url, { timeoutMs = 8000 } = {}) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { title: '', reason: '不是 http／https 網址' };
  try {
    const call = supabase.functions.invoke('link-title', { body: { url } });
    const late = new Promise((r) => { setTimeout(() => r({ data: null, error: { message: 'timeout' } }), timeoutMs); });
    const { data, error } = await Promise.race([call, late]);
    if (error) {
      let msg = error.message || '';
      if (error.context?.status === 404) return { title: '', reason: '讀標題服務還沒部署' };
      try { msg = (await error.context?.json())?.error || msg; } catch { /* 忽略 */ }
      if (/timeout/i.test(msg)) return { title: '', reason: '讀取逾時' };
      if (/Failed to send|not found|404|fetch/i.test(msg)) return { title: '', reason: '讀標題服務還沒部署或連不上' };
      return { title: '', reason: msg || '讀取失敗' };
    }
    const title = String(data?.title || '').trim();
    return title ? { title, reason: '' } : { title: '', reason: data?.error || '這個網頁沒有提供標題（可能需要登入）' };
  } catch (e) {
    return { title: '', reason: e.message || '讀取失敗' };
  }
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

// ===== 手帳（Phase J）：期間、回顧、Future Log、Year in Pixels、書影單、想做清單 =====
// 共用資料層：年度頁、月度頁、書影單、想做清單都只呼叫這裡（migration 20261105_journal.sql）

/** 期間字串：'2026'（年）、'2026-Q4'（季）、'2026-11'（月） */
export function isPeriod(p) {
  return /^[0-9]{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/.test(String(p || ''));
}
export const yearOf = (day) => day.slice(0, 4);
export const monthOf = (day) => day.slice(0, 7);
export const quarterOf = (day) => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
/** 期間的第一天與最後一天（台北日期，含頭尾） */
export function periodRange(period) {
  if (!isPeriod(period)) throw new Error('期間格式不正確');
  const y = Number(period.slice(0, 4));
  let m1 = 1, m2 = 12;
  if (/-Q/.test(period)) { const q = Number(period.slice(-1)); m1 = q * 3 - 2; m2 = q * 3; }
  else if (period.length === 7) { m1 = m2 = Number(period.slice(5)); }
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(y, m2, 0)).getUTCDate();
  return { from: `${y}-${pad(m1)}-01`, to: `${y}-${pad(m2)}-${pad(last)}` };
}
/** 下一個月：'2026-12' → '2027-01' */
export function nextMonth(month) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
/** 掛在某期間的目標（goals 同一份；傳 '2026' 只拿年度目標，不含季、月） */
export const goalsOfPeriod = (goals, period) => goals.filter((g) => g.period === period);

// --- 期間回顧（月／季／年）---
export async function getPeriodReview(period) {
  if (!isPeriod(period)) throw new Error('期間格式不正確');
  return must(await supabase.from('period_reviews').select('*').eq('period', period).maybeSingle());
}
export async function savePeriodReview(period, { wins, lessons, next_focus }) {
  if (!isPeriod(period)) throw new Error('期間格式不正確');
  const session = await getSession();
  return must(await supabase.from('period_reviews').upsert({
    user_id: session.user.id, period, wins: wins?.trim() || null, lessons: lessons?.trim() || null,
    next_focus: next_focus?.trim() || null, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,period' }).select().single());
}

// --- 終點身分（顯化規劃・階段二，migration 20261108_manifest）---
// 存在年度那一筆 period_reviews（period='YYYY'）；只寫這兩欄，不碰 wins／lessons／next_focus。
// savePeriodReview 也只寫自己的三欄，所以兩邊各存各的、不會互相覆蓋。
export const VISION_SENSES = [
  ['see', '看到', '那時的你每天看到什麼？房間、窗外、桌上、身邊的人'],
  ['hear', '聽到', '聽到什麼聲音、別人怎麼稱呼你、你說話的語氣'],
  ['touch', '摸到', '手上拿著什麼、身體的感覺、穿著的質感'],
  ['smell', '聞到', '空氣、咖啡、書頁、海邊……'],
  ['taste', '嚐到', '早餐、慶祝時的味道'],
  ['feel', '我感受到', '心裡的狀態：踏實、自由、被信任……'],
];
const VISION_KEYS = VISION_SENSES.map(([k]) => k);
/** 只留六個鍵、去頭尾空白、空的丟掉 */
export function cleanVisionSenses(v) {
  const out = {};
  for (const k of VISION_KEYS) {
    const t = typeof v?.[k] === 'string' ? v[k].trim() : '';
    if (t) out[k] = t;
  }
  return out;
}
export async function saveVision(year, { vision_identity, vision_senses }) {
  const period = String(year);
  if (!/^[0-9]{4}$/.test(period)) throw new Error('終點身分只存在年度（例如 2026）');
  const session = await getSession();
  return must(await supabase.from('period_reviews').upsert({
    user_id: session.user.id, period, vision_identity: vision_identity?.trim() || null,
    vision_senses: cleanVisionSenses(vision_senses), updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,period' }).select().single());
}

// --- 身分主線（goals.mainline，只有一份；年度頁、目標對話框、專案卡片、總覽都讀它）---
export const MAINLINE_SUGGEST_MAX = 3; // 建議上限：超過時提示、要使用者確認，但不硬擋
/** 目前所有主線（不分年份；放棄的不算） */
export const mainlineGoals = (goals) => goals.filter((g) => g.mainline && g.status !== 'dropped')
  .sort((a, b) => (a.status === 'done') - (b.status === 'done') || (a.created_at || '').localeCompare(b.created_at || ''));
/**
 * 某一年可以勾成主線的候選：未放棄、未達成、還不是主線，且
 * (1) period 是這一年或這一年的季／月（'2026'、'2026-Q1'、'2026-03'），或
 * (2) 沒有 period、但掛在專案底下（長期目標通常掛專案、不指定期間）。
 * 有 period 但屬於別年的不列（避免把去年的目標拉進今年的主線）。
 */
export function mainlineCandidates(goals, year) {
  const y = String(year);
  return goals.filter((g) => !g.mainline && g.status === 'active'
    && (g.period ? g.period.slice(0, 4) === y : Boolean(g.project_id)))
    .sort((a, b) => (a.period || '').localeCompare(b.period || '') || (a.created_at || '').localeCompare(b.created_at || ''));
}
export async function setGoalMainline(id, on) {
  const rows = must(await supabase.from('goals').update({ mainline: Boolean(on) }).eq('id', id).select('id, mainline'));
  if (rows.length !== 1) throw new Error(`預期更新 1 個目標，實際 ${rows.length} 個（可能已被刪除）`);
  return rows[0];
}

// --- Future Log ---
export async function listFutureEvents(year) {
  return must(await supabase.from('future_events').select('*')
    .gte('month', `${year}-01`).lte('month', `${year}-12`).order('month').order('day'));
}
export async function saveFutureEvent(e) {
  const row = { month: e.month, day: e.day ? Number(e.day) : null, title: e.title?.trim(), area_id: e.area_id || null };
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(row.month || '')) throw new Error('月份格式不正確');
  if (!row.title) throw new Error('請輸入事件');
  if (row.day != null && !(row.day >= 1 && row.day <= Number(periodRange(row.month).to.slice(8)))) throw new Error('日期超出這個月');
  if (e.id) return must(await supabase.from('future_events').update(row).eq('id', e.id).select().single());
  return must(await supabase.from('future_events').insert(row).select().single());
}
export async function deleteFutureEvent(id) {
  await trashDelete('future_events', id); // 20261106：先進垃圾桶，30 天內可還原
}

// --- Year in Pixels：心情／能量存在當天的 daily_reviews（只寫這兩欄，不動復盤文字）---
export const MOOD_LEVELS = { 1: '很糟', 2: '不太好', 3: '普通', 4: '不錯', 5: '很好' };
export async function saveMood(day, { mood, energy }) {
  const row = {};
  if (mood !== undefined) row.mood = mood ? Number(mood) : null;
  if (energy !== undefined) row.energy = energy ? Number(energy) : null;
  for (const v of Object.values(row)) if (v != null && !(v >= 1 && v <= 5)) throw new Error('請選 1～5');
  const session = await getSession();
  return must(await supabase.from('daily_reviews').upsert({
    user_id: session.user.id, review_date: day, ...row, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,review_date' }).select().single());
}
/** 一年的心情／能量：{ 'YYYY-MM-DD': { mood, energy } } */
export async function listMoods(year) {
  const rows = must(await supabase.from('daily_reviews').select('*')
    .gte('review_date', `${year}-01-01`).lte('review_date', `${year}-12-31`));
  return Object.fromEntries(rows.filter((r) => r.mood || r.energy).map((r) => [r.review_date, { mood: r.mood ?? null, energy: r.energy ?? null }]));
}

// --- 書影單 ---
export const MEDIA_KINDS = { book: '書', movie: '電影', tv: '影集', podcast: 'Podcast', course: '課程' };
export const MEDIA_STATUS = { want: '想看', doing: '進行中', done: '看完', dropped: '放棄' };
export async function listMedia() {
  return must(await supabase.from('media_items').select('*').order('created_at', { ascending: false }));
}
export async function saveMedia(m) {
  const row = {
    kind: m.kind, title: m.title?.trim(), creator: m.creator?.trim() || null,
    release_year: m.release_year ? Number(m.release_year) : null,
    cover_url: m.cover_url?.trim() || null, link_url: m.link_url?.trim() || null,
    status: m.status || 'want', rating: m.rating ? Number(m.rating) : null, review: m.review?.trim() || null,
    started_on: m.started_on || null, finished_on: m.finished_on || null,
    tags: Array.isArray(m.tags) ? m.tags : parseTags(m.tags), area_id: m.area_id || null,
    updated_at: new Date().toISOString(),
  };
  if ('note_id' in m) row.note_id = m.note_id || null;
  if ('sort_order' in m) row.sort_order = m.sort_order ?? null;
  if (!MEDIA_KINDS[row.kind]) throw new Error('請選擇類型');
  if (!row.title) throw new Error('請輸入名稱');
  if (!MEDIA_STATUS[row.status]) throw new Error('狀態不正確');
  if (row.cover_url && !/^https:\/\//.test(row.cover_url)) throw new Error('封面網址要以 https:// 開頭');
  if (row.link_url && !/^https?:\/\//.test(row.link_url)) throw new Error('連結要以 http:// 或 https:// 開頭');
  if (row.rating != null && !(row.rating >= 1 && row.rating <= 5)) throw new Error('評分是 1～5');
  // 標成看完時自動補完成日（台北今天），之後可以改
  if (row.status === 'done' && !row.finished_on) row.finished_on = today();
  if (row.started_on && row.finished_on && row.finished_on < row.started_on) throw new Error('看完日不能早於開始日');
  if (m.id) return must(await supabase.from('media_items').update(row).eq('id', m.id).select().single());
  return must(await supabase.from('media_items').insert(row).select().single());
}
export async function deleteMedia(id) {
  await trashDelete('media_items', id); // 20261106：先進垃圾桶，30 天內可還原
}
/** 把心得存進靈感知識庫（同一筆只建一則；已存過就更新那一則） */
export async function saveMediaReviewToNote(m) {
  if (!m.review?.trim()) throw new Error('先寫心得再存進知識庫');
  const title = `${MEDIA_KINDS[m.kind]}｜${m.title}`;
  const body = [m.creator && `作者／創作者：${m.creator}`, m.rating && `評分：${'★'.repeat(m.rating)}`, m.link_url, '', m.review.trim()]
    .filter((x) => x !== null && x !== undefined && x !== false).join('\n');
  const note = await saveNote({ id: m.note_id || undefined, title, body, area_id: m.area_id, tags: ['書影單', MEDIA_KINDS[m.kind], ...(m.tags || [])].join(' ') });
  if (note.id !== m.note_id) must(await supabase.from('media_items').update({ note_id: note.id }).eq('id', m.id).select('id'));
  return note;
}
/** 某年看完的數量，依類型：{ book: 3, movie: 5, ... , total: 8 } */
export function mediaDoneCount(items, year) {
  const out = { total: 0 };
  for (const m of items) {
    if (m.status !== 'done' || !m.finished_on || m.finished_on.slice(0, 4) !== String(year)) continue;
    out[m.kind] = (out[m.kind] || 0) + 1;
    out.total++;
  }
  return out;
}

// --- 想做清單 ---
export async function listBucket() {
  return must(await supabase.from('bucket_items').select('*').order('created_at', { ascending: false }));
}
export async function saveBucket(b) {
  const row = { title: b.title?.trim(), category: b.category?.trim() || null, area_id: b.area_id || null,
    done_on: b.done_on || null, note: b.note?.trim() || null };
  if ('sort_order' in b) row.sort_order = b.sort_order ?? null;
  if (!row.title) throw new Error('請輸入想做的事');
  if (b.id) return must(await supabase.from('bucket_items').update(row).eq('id', b.id).select().single());
  return must(await supabase.from('bucket_items').insert(row).select().single());
}
export async function deleteBucket(id) {
  await trashDelete('bucket_items', id); // 20261106：先進垃圾桶，30 天內可還原
}

// ===== 手帳（Phase J）介面用的衍生計算：月度手帳、想做清單 =====
// 放在共用資料層之後、不改上面任何函式；月度頁（views/month.js）與想做清單（views/bucket.js）只呼叫這裡。

/** 上／下一個月：shiftMonth('2026-01', -1) → '2025-12' */
export function shiftMonth(month, n) {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5));
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

/**
 * 月誌（bullet journal 的日期直列）：這個月每天一行，列出那天到期或排程的任務（同日曆的 calendarItems，
 * 放棄的不列）與 Future Log 事件（有 day 的放在那天，只到月的放在 undated）。
 * @param tasks 呼叫端傳生活那一份（state.life.tasks）
 */
export function monthJournal(tasks, month, events = []) {
  const { from, to } = periodRange(month);
  const items = calendarItems(tasks, from, to);
  const mine = events.filter((e) => e.month === month);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dow = new Date(`${d}T12:00:00+08:00`).getUTCDay(); // 0=週日
    days.push({ day: d, dow, weekend: dow === 0 || dow === 6, items: items[d] || [],
      events: mine.filter((e) => e.day === Number(d.slice(8))) });
  }
  return { days, undated: mine.filter((e) => e.day == null) };
}

/**
 * 遷移候選（只在「本月」頁做）：還沒完成、代表日期（到期日，沒有就排程日）已經過了的任務。
 * group：'last'＝上個月、'earlier'＝更早、'this'＝本月已過期。
 */
export function migrationCandidates(tasks, day = today()) {
  const month = monthOf(day);
  const last = shiftMonth(month, -1);
  return tasks.filter((t) => isOpen(t) && taskDay(t) && taskDay(t) < day)
    .map((t) => {
      const d = taskDay(t);
      return { task: t, day: d, group: d >= `${month}-01` ? 'this' : monthOf(d) === last ? 'last' : 'earlier' };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || compareTasks(a.task, b.task));
}
export const MIGRATE_ACTIONS = { forward: '遷移到本月', later: '排到下個月', drop: '不做了' };

/**
 * 遷移：一律改任務本身，不複製（docs/02「月度遷移」）。
 * - forward：到期日改成 targetDay（本月、今天以後的某天）
 * - later：到期日改成下個月 1 日
 * - drop：狀態改「放棄」（正在計時的先停止計時）
 * 有排程時間的任務，排程日一起搬到新日期、保留原本時刻（同日曆拖移），免得任務還掛在舊的那天。
 * @returns 實際更新的筆數（不等於選取筆數時丟錯）
 */
export async function migrateTasks(ids, action, { targetDay, tasks, running = null, day = today() } = {}) {
  if (!MIGRATE_ACTIONS[action]) throw new Error('遷移動作不正確');
  if (!ids?.length) throw new Error('請先選擇任務');
  const byId = Object.fromEntries(tasks.map((t) => [t.id, t]));
  const month = monthOf(day);
  let newDay = null;
  if (action === 'forward') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay || '')) throw new Error('請選遷移到哪一天');
    if (targetDay < day || monthOf(targetDay) !== month) throw new Error('只能遷移到本月今天以後的日子');
    newDay = targetDay;
  }
  if (action === 'later') newDay = `${nextMonth(month)}-01`;
  const patches = ids.map((id) => {
    const t = byId[id];
    if (!t || !isOpen(t)) throw new Error('有任務已經完成或不存在，請重新整理');
    if (action === 'drop') return { id, patch: { status: 'dropped' } };
    const patch = { due_date: newDay };
    if (t.scheduled_start) patch.scheduled_start = fromLocalInput(`${newDay}T${toLocalInput(t.scheduled_start).slice(11, 16)}`);
    return { id, patch };
  });
  if (action === 'drop' && running && ids.includes(running.task_id)) await stopTimer(running);
  const results = await Promise.all(patches.map(({ id, patch }) =>
    supabase.from('tasks').update(patch).eq('id', id).select('id')));
  const updated = results.reduce((n, r) => n + must(r).length, 0);
  if (updated !== ids.length) throw new Error(`遷移預期更新 ${ids.length} 筆，實際 ${updated} 筆`);
  return updated;
}

/**
 * 月回顧的數字（唯讀）：
 * - doneCount：這個月完成的任務（完成那天落在本月，同 summaryDay）
 * - timeSec：這個月開始、已結束的計時加總（資料庫的 duration_sec）
 * - goalsDone／goalsTotal：月目標達成數／總數（放棄的不算）
 * @param tasks、entries 呼叫端傳生活那一份
 */
export function monthStats({ tasks, entries, goals, month }) {
  const doneCount = tasks.filter((t) => t.status === 'done' && monthOf(summaryDay(t) || '') === month).length;
  const timeSec = entries.filter((e) => e.ended_at && monthOf(localDate(e.started_at)) === month)
    .reduce((n, e) => n + entrySeconds(e), 0);
  const mg = goalsOfPeriod(goals, month).filter((g) => g.status !== 'dropped');
  return { doneCount, timeSec, goalsDone: mg.filter((g) => g.status === 'done').length, goalsTotal: mg.length };
}

// --- 想做清單：排序、分類 ---
export const BUCKET_CATEGORIES = ['想去的地方', '想學的東西', '想體驗的事', '想完成的事'];
/** 分類建議：常用分類＋自己用過的 */
export function bucketCategories(items) {
  return [...new Set([...BUCKET_CATEGORIES, ...items.map((b) => b.category).filter(Boolean)])];
}
/** 未完成在前；有 sort_order（拖移過）的依它，否則新的在前；已完成的依完成日新到舊 */
export function compareBucket(a, b) {
  const ad = a.done_on ? 1 : 0, bd = b.done_on ? 1 : 0;
  if (ad !== bd) return ad - bd;
  if (ad) return b.done_on.localeCompare(a.done_on) || (b.created_at || '').localeCompare(a.created_at || '');
  const ao = a.sort_order ?? Infinity, bo = b.sort_order ?? Infinity;
  return (ao === bo ? 0 : ao < bo ? -1 : 1) || (b.created_at || '').localeCompare(a.created_at || '');
}
/** 新增：若已拖移排過序，放在最上面（同 createTask） */
export async function addBucket(b, items = []) {
  const orders = items.map((x) => x.sort_order).filter((v) => v != null);
  return saveBucket({ ...b, sort_order: orders.length ? Math.min(...orders) - 1 : null });
}
/** 拖移後的完整順序：在全部未完成項目的目前順序中，把 draggedId 移到新鄰居的位置（分類篩選中拖也不亂） */
export function moveBucket(items, draggedId, nextId, prevId) {
  const order = items.filter((b) => !b.done_on).sort(compareBucket).map((b) => b.id).filter((id) => id !== draggedId);
  let i = nextId ? order.indexOf(nextId) : -1;
  if (i < 0) i = prevId ? order.indexOf(prevId) + 1 : order.length;
  order.splice(i, 0, draggedId);
  return order;
}
/** 依新順序寫入 bucket_items.sort_order，只更新有變動的（同 reorderTasks） */
export async function reorderBucket(orderedIds, itemsById) {
  const changed = orderedIds
    .map((id, i) => ({ id, sort_order: (i + 1) * 1000 }))
    .filter(({ id, sort_order }) => itemsById[id]?.sort_order !== sort_order);
  const results = await Promise.all(changed.map(({ id, sort_order }) =>
    supabase.from('bucket_items').update({ sort_order }).eq('id', id).select('id')));
  const updated = results.reduce((n, r) => n + must(r).length, 0);
  if (updated !== changed.length) throw new Error(`排序預期更新 ${changed.length} 筆，實際 ${updated} 筆`);
}

// --- 年度頁（#/year）的衍生計算 ---
// 加在這裡的原因：年度頁需要「整年的計時」與「依月份整理的 Future Log／年度數字」，
// 既有的 listEntries 只讀近 7 天，也沒有年度彙總；算法集中在這裡，UI 只顯示。

/** 能量的文字（心情用上面的 MOOD_LEVELS）；年度頁與每日復盤共用 */
export const ENERGY_LEVELS = { 1: '很低', 2: '偏低', 3: '普通', 4: '不錯', 5: '充沛' };

/** 期間的中文標籤：'2026' → '2026 年'、'2026-Q4' → '2026 Q4'、'2026-11' → '2026 年 11 月' */
export function periodLabel(p) {
  if (!isPeriod(p)) return '';
  if (p.length === 4) return `${p} 年`;
  if (p.includes('-Q')) return `${p.slice(0, 4)} ${p.slice(5)}`;
  return `${p.slice(0, 4)} 年 ${Number(p.slice(5))} 月`;
}

/** 開始時間（台北日期）落在 fromDay～toDay（含）的計時紀錄；一年可能超過 1000 筆，分頁讀完 */
export async function listEntriesBetween(fromDay, toDay) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const rows = must(await supabase.from('time_entries').select('*')
      .gte('started_at', dayStartISO(fromDay)).lt('started_at', dayStartISO(addDays(toDay, 1)))
      .order('started_at').order('id').range(from, from + PAGE - 1));
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Future Log：一年 12 個月，每月列出
 * - events：future_events（自己記的，日留白的排最前）
 * - goals：該月到期（goals.due_date）的目標，不含放棄的
 * - starred：該月到期（due_date）且有星號的任務，不含放棄的；只讀，不複製
 */
export function futureLogMonths(year, events, goals, tasks) {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const inMonth = (d) => !!d && d.slice(0, 7) === month;
    return {
      month,
      events: events.filter((e) => e.month === month).sort((a, b) => (a.day ?? 0) - (b.day ?? 0)),
      goals: goals.filter((g) => inMonth(g.due_date) && g.status !== 'dropped').sort((a, b) => a.due_date.localeCompare(b.due_date)),
      starred: tasks.filter((t) => t.starred && inMonth(t.due_date) && t.status !== 'dropped').sort((a, b) => a.due_date.localeCompare(b.due_date)),
    };
  });
}

/**
 * 年度數據（年份以台北日期判斷；任務與計時只算生活：領域的 on_board 不為真）
 * - tasksDone：狀態完成、completed_at 在這一年的生活任務數
 * - timeSec：開始時間在這一年、已結束的生活計時加總（秒）
 * - yearGoals／quarterGoals：年度目標（period＝'YYYY'）與各季目標（'YYYY-Qn'）的達成數／總數（不含放棄）
 * - media：書影單這一年看完的數量（mediaDoneCount）
 * - habitDays：這一年至少打卡一次的天數；habitLogs：打卡總次數
 * @param entries 這一年的計時（listEntriesBetween(年初, 年底)）；進行中的不算
 */
export function yearStats({ year, tasks, entries, goals, habitLogs, media, areasById }) {
  const y = String(year);
  const life = (areaId) => areasById[areaId]?.on_board !== true;
  const tasksDone = tasks.filter((t) => t.status === 'done' && t.completed_at
    && localDate(t.completed_at).slice(0, 4) === y && life(t.area_id)).length;
  const timeSec = entries.filter((e) => e.ended_at && localDate(e.started_at).slice(0, 4) === y && life(e.area_id))
    .reduce((n, e) => n + entrySeconds(e), 0);
  const count = (period) => {
    const list = goals.filter((g) => g.period === period && g.status !== 'dropped');
    return { done: list.filter((g) => g.status === 'done').length, total: list.length };
  };
  const logs = habitLogs.filter((l) => String(l.log_date).slice(0, 4) === y);
  return {
    tasksDone,
    timeSec,
    yearGoals: count(y),
    quarterGoals: [1, 2, 3, 4].map((q) => ({ q, ...count(`${y}-Q${q}`) })),
    media: mediaDoneCount(media, y),
    habitDays: new Set(logs.map((l) => l.log_date)).size,
    habitLogs: logs.length,
  };
}

// ===== 20261106 使用回饋：垃圾桶、看板標籤、專案串接、收件匣、跟進對象（migration 20261106_feedback.sql）=====
// 共用資料層；各頁面只呼叫這裡。

// --- 垃圾桶：刪除前把那筆＋底下會被連帶刪除的資料＋會被取消的關聯存起來，30 天內可還原 ---
export const TRASH_DAYS = 30;
const TRASH_SPEC = {
  tasks: { label: (r) => r.title, cascade: { task_memos: 'task_id' }, setnull: { time_entries: 'task_id', reflections: 'task_id' } },
  projects: { label: (r) => r.name, setnull: { tasks: 'project_id', goals: 'project_id', habits: 'project_id' } },
  goals: { label: (r) => r.title, setnull: { tasks: 'goal_id', habits: 'goal_id' } },
  habits: { label: (r) => r.name, cascade: { habit_logs: 'habit_id' } },
  notes: { label: (r) => r.title, setnull: { media_items: 'note_id' } },
  contacts: { label: (r) => r.name, cascade: { contact_logs: 'contact_id' } },
  contact_stages: { label: (r) => r.label, setnull: { contacts: 'stage_id' } },
  work_tags: { label: (r) => r.label, setnull: { tasks: ['work_type_id', 'work_project_tag_id'] } },
  task_memos: { label: (r) => (r.body || '').slice(0, 40) },
  time_entries: { label: (r) => `計時 ${localDate(r.started_at)}` },
  media_items: { label: (r) => r.title, setnull: { quotes: 'media_id' } },
  bucket_items: { label: (r) => r.title },
  future_events: { label: (r) => r.title },
  inbox_items: { label: (r) => r.title || r.url || (r.body || '').slice(0, 40) },
  routine_phrases: { label: (r) => (r.body || '').slice(0, 40) },
  quotes: { label: (r) => (r.body || '').split('\n')[0].slice(0, 40) },
  reflections: { label: (r) => `${REFLECT_KINDS[r.kind] || '便籤'}・${(r.event || '').split('\n')[0].slice(0, 40) || '（沒寫事件）'}` },
};
export const TRASH_LABELS = { tasks: '任務', projects: '專案', goals: '目標', habits: '習慣', notes: '靈感', contacts: '跟進對象',
  contact_stages: '跟進階段', work_tags: '標籤', task_memos: '進度 memo', time_entries: '計時', media_items: '書影單',
  bucket_items: '想做清單', future_events: 'Future Log', inbox_items: '待看清單', routine_phrases: '常用詞組',
  reflections: '內在整理', quotes: '佳句' };

/** 刪除一筆：先存進垃圾桶，再刪除。areas 不走這裡（領域有任務掛著時資料庫會擋） */
export async function trashDelete(table, id) {
  const spec = TRASH_SPEC[table];
  if (!spec) throw new Error(`「${table}」不支援垃圾桶`);
  const row = must(await supabase.from(table).select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('找不到這筆資料（可能已被刪除）');
  const payload = { row, cascade: {}, setnull: {} };
  for (const [t, col] of Object.entries(spec.cascade || {})) {
    payload.cascade[t] = must(await supabase.from(t).select('*').eq(col, id));
  }
  for (const [t, cols] of Object.entries(spec.setnull || {})) {
    for (const col of [].concat(cols)) {
      const ids = must(await supabase.from(t).select('id').eq(col, id)).map((r) => r.id);
      if (ids.length) payload.setnull[`${t}.${col}`] = ids;
    }
  }
  const { user_id, ...plain } = row; // eslint-disable-line no-unused-vars
  payload.row = plain;
  for (const t of Object.keys(payload.cascade)) payload.cascade[t] = payload.cascade[t].map(({ user_id: _u, ...r }) => r);
  const label = String(spec.label(row) || '（未命名）').slice(0, 120);
  const tr = must(await supabase.from('trash').insert({ table_name: table, row_id: id, label, payload }).select('id').single());
  try {
    const rows = must(await supabase.from(table).delete().eq('id', id).select('id'));
    if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
  } catch (e) {
    // 刪除沒成功：收回剛放進垃圾桶的那筆，免得垃圾桶有一筆其實還在的資料
    await supabase.from('trash').delete().eq('id', tr.id);
    throw e;
  }
}

/** 垃圾桶清單（新到舊）；順便清掉超過 30 天的 */
export async function listTrash() {
  await purgeTrash();
  return must(await supabase.from('trash').select('*').order('deleted_at', { ascending: false }));
}
export async function purgeTrash() {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString();
  must(await supabase.from('trash').delete().lt('deleted_at', cutoff).select('id'));
}
/** 還原：放回原本的 id、連帶的資料、被取消的關聯（只有仍是空的才接回去） */
export async function restoreTrash(trashId) {
  const t = must(await supabase.from('trash').select('*').eq('id', trashId).single());
  const { row, cascade = {}, setnull = {} } = t.payload;
  const exists = must(await supabase.from(t.table_name).select('id').eq('id', row.id).maybeSingle());
  if (exists) throw new Error('這筆資料已經存在，不需要還原');
  const fixed = await restoreFixRefs(t.table_name, row);
  must(await supabase.from(t.table_name).insert(fixed.row).select('id').single());
  for (const [table, rows] of Object.entries(cascade)) {
    if (rows.length) must(await supabase.from(table).insert(rows).select('id'));
  }
  for (const [key, ids] of Object.entries(setnull)) {
    const [table, col] = key.split('.');
    must(await supabase.from(table).update({ [col]: row.id }).in('id', ids).is(col, null).select('id'));
  }
  must(await supabase.from('trash').delete().eq('id', trashId).select('id'));
  return { ...t, notes: fixed.notes };
}

// 還原前的檢查：可留白的關聯若已不存在就清空（並說明）；必填的領域不存在就停下（案件編號照舊保留，20261111）
const RESTORE_OPTIONAL_REFS = { project_id: ['projects', '專案'], goal_id: ['goals', '目標'], work_type_id: ['work_tags', '工作種類'],
  work_project_tag_id: ['work_tags', '專案標籤'], note_id: ['notes', '靈感'], stage_id: ['contact_stages', '跟進階段'], task_id: ['tasks', '任務'],
  habit_id: ['habits', '習慣'], contact_id: ['contacts', '跟進對象'], media_id: ['media_items', '書影單'] };
async function restoreFixRefs(table, original) {
  const row = { ...original };
  const notes = [];
  if (row.area_id) {
    const a = must(await supabase.from('areas').select('id').eq('id', row.area_id).maybeSingle());
    if (!a) {
      if (['tasks', 'time_entries', 'projects', 'goals'].includes(table)) throw new Error('原本的領域已經被刪除，請先新增一個領域並把這筆改掛過去（目前無法直接還原）');
      row.area_id = null;
      notes.push('原本的領域已刪除，改成沒有領域');
    }
  }
  for (const [col, [ref, label]] of Object.entries(RESTORE_OPTIONAL_REFS)) {
    if (!row[col] || ref === table) continue;
    const hit = must(await supabase.from(ref).select('id').eq('id', row[col]).maybeSingle());
    if (hit) continue;
    if (['habit_logs', 'contact_logs', 'task_memos'].includes(table)) throw new Error(`原本的${label}已不存在，無法還原`);
    row[col] = null;
    notes.push(`原本的${label}已不存在，已取消關聯`);
  }
  // 20261111：案件編號可重複（一個案件多張卡），還原時保留原本的案號，接回同一個案件
  return { row, notes };
}
/** 永久刪除（不能復原） */
export async function purgeTrashItem(trashId) {
  const rows = must(await supabase.from('trash').delete().eq('id', trashId).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}

// --- 工作看板標籤：工作種類（type）與專案標籤（project）同一張表；可直接打字新增 ---
export const WORK_TAG_KINDS = { type: '工作種類', project: '專案標籤' };
/** 找同名的；沒有就建立。回傳那筆 work_tag */
export async function ensureWorkTag(label, kind = 'type') {
  const name = String(label || '').trim();
  if (!name) return null;
  if (!WORK_TAG_KINDS[kind]) throw new Error('標籤類別不正確');
  const found = must(await supabase.from('work_tags').select('*').eq('kind', kind).eq('label', name).maybeSingle());
  if (found) return found;
  return must(await supabase.from('work_tags').insert({ label: name, kind }).select().single());
}
export async function saveWorkTag(tag) {
  const row = { label: tag.label?.trim(), color: tag.color || undefined, active: tag.active ?? true };
  if (!row.label) throw new Error('請輸入名稱');
  if (tag.kind) row.kind = tag.kind;
  if (tag.id) return must(await supabase.from('work_tags').update(row).eq('id', tag.id).select().single());
  return must(await supabase.from('work_tags').insert(row).select().single());
}
export const deleteWorkTag = (id) => trashDelete('work_tags', id);

// --- 專案串接：目標、習慣掛在專案底下 ---
/** 目標改掛到某專案（null＝未歸屬） */
export async function setGoalProject(goalId, projectId) {
  return must(await supabase.from('goals').update({ project_id: projectId || null }).eq('id', goalId).select().single());
}
/** 習慣掛專案／目標 */
export async function setHabitLinks(habitId, { project_id, goal_id }) {
  const row = {};
  if (project_id !== undefined) row.project_id = project_id || null;
  if (goal_id !== undefined) row.goal_id = goal_id || null;
  return must(await supabase.from('habits').update(row).eq('id', habitId).select().single());
}
export const goalsOfProject = (goals, projectId) => goals.filter((g) => g.project_id === projectId);
export const unassignedGoals = (goals) => goals.filter((g) => !g.project_id);
export const habitsOfProject = (habits, projectId) => habits.filter((h) => h.project_id === projectId && !h.archived);
/** 連續 21 天的鼓勵門檻（使用者決定：習慣不設終點，連續 21 天給鼓勵） */
export const STREAK_MILESTONE = 21;

// --- 收件匣 ---
export const INBOX_STALE_DAYS = 7; // 使用者決定：7 天沒點開算「放很久」
export const INBOX_SOURCES = { threads: 'Threads', instagram: 'IG', xiaohongshu: '小紅書', youtube: 'YouTube', facebook: 'Facebook',
  x: 'X', linkedin: 'LinkedIn', tiktok: 'TikTok／抖音', podcast: 'Podcast', dcard: 'Dcard', ptt: 'PTT', vocus: '方格子', medium: 'Medium',
  web: '網頁', other: '其他' };
// 網域（含子網域、短網址）→ 來源；沒對到的一律「網頁」
const INBOX_HOSTS = [
  ['threads', /(^|\.)threads\.(net|com)$/],
  ['instagram', /(^|\.)(instagram\.com|instagr\.am)$/],
  ['xiaohongshu', /(^|\.)(xiaohongshu\.com|xhslink\.com)$/],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.com|fb\.watch|fb\.me)$/],
  ['x', /(^|\.)(x\.com|twitter\.com|t\.co)$/],
  ['linkedin', /(^|\.)(linkedin\.com|lnkd\.in)$/],
  ['tiktok', /(^|\.)(tiktok\.com|douyin\.com)$/],
  ['podcast', /(^|\.)(podcasts\.apple\.com|open\.spotify\.com|spotify\.link|soundon\.fm|firstory\.me)$/],
  ['dcard', /(^|\.)dcard\.tw$/],
  ['ptt', /(^|\.)(ptt\.cc|pttweb\.cc)$/],
  ['vocus', /(^|\.)vocus\.cc$/],
  ['medium', /(^|\.)medium\.com$/],
];
/** 從網址判斷來源 */
export function inboxSourceOf(url) {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'other'; }
  return INBOX_HOSTS.find(([, re]) => re.test(h))?.[0] || 'web';
}
/** 畫面上用的來源：有網址就以網址為準（舊資料、規則更新前存的也會跟著對），沒網址才用存的值 */
export const inboxSourceOfItem = (it) => (it.url ? inboxSourceOf(it.url) : INBOX_SOURCES[it.source] ? it.source : 'other');
/** 分享進來的文字常常「標題＋網址」混在一起：抽出第一個網址，其餘當內文 */
export function splitSharedText(text) {
  // 網址到空白或全形標點為止（小紅書等分享文字常在網址後直接接「，复制本条信息…」）
  const m = String(text || '').match(/https?:\/\/[^\s<>"'）」，。！？、；：「『』【】（《》　]+/);
  const url = m ? m[0].replace(/[.,，。)]+$/, '') : null;
  const body = String(text || '').replace(m ? m[0] : '', ' ').replace(/[ \t]{2,}/g, ' ').trim() || null;
  return { url, body };
}
export async function listInbox() {
  return must(await supabase.from('inbox_items').select('*').order('created_at', { ascending: false }));
}
export async function saveInboxItem(it) {
  const row = { url: it.url?.trim() || null, title: it.title?.trim() || null, body: it.body?.trim() || null,
    category: it.category?.trim() || null, area_id: it.area_id || null };
  if (row.url && !/^https?:\/\//.test(row.url)) throw new Error('連結要以 http:// 或 https:// 開頭');
  if (!row.url && !row.title && !row.body) throw new Error('請貼上連結或寫一點內容');
  row.source = it.source || (row.url ? inboxSourceOf(row.url) : 'other');
  if (!INBOX_SOURCES[row.source]) throw new Error('來源不正確');
  const write = (r) => (it.id ? supabase.from('inbox_items').update(r).eq('id', it.id) : supabase.from('inbox_items').insert(r)).select().single();
  let res = await write(row);
  // 資料庫還沒跑 migration 20261107（來源只允許舊的 7 種）時，先存成「網頁」；畫面仍依網址顯示正確來源
  if (res.error?.code === '23514' && /source/.test(res.error.message || '')) res = await write({ ...row, source: row.url ? 'web' : 'other' });
  return must(res);
}
/** 點開時記第一次點開的時間 */
export async function markInboxOpened(it) {
  if (it.opened_at) return it;
  return must(await supabase.from('inbox_items').update({ opened_at: new Date().toISOString() }).eq('id', it.id).select().single());
}
export async function setInboxDone(id, done) {
  const patch = done ? { done_at: new Date().toISOString() } : { done_at: null };
  return must(await supabase.from('inbox_items').update(patch).eq('id', id).select().single());
}
export const deleteInboxItem = (id) => trashDelete('inbox_items', id);
/** 放很久沒點開的（未處理、未點開、超過 7 天） */
export function staleInbox(items, now = Date.now()) {
  return items.filter((i) => !i.done_at && !i.opened_at && now - Date.parse(i.created_at) > INBOX_STALE_DAYS * 86400000);
}

// --- 跟進對象（心法由使用者之後提供，先做可自訂的架構；階段、提醒天數都可改）---
// 預設階段只是起點（不代表任何老師的心法），使用者可在介面改名、增刪、排序
export const DEFAULT_CONTACT_STAGES = [
  { label: '名單', follow_days: null }, { label: '已聯絡', follow_days: 7 }, { label: '已分享', follow_days: 3 },
  { label: '跟進中', follow_days: 7 }, { label: '顧客', follow_days: 30 }, { label: '夥伴', follow_days: 14 },
];
export async function listContactStages() {
  return must(await supabase.from('contact_stages').select('*').order('sort').order('created_at'));
}
/** 第一次使用時建立預設階段 */
export async function ensureContactStages() {
  const have = await listContactStages();
  if (have.length) return have;
  must(await supabase.from('contact_stages').insert(DEFAULT_CONTACT_STAGES.map((s, i) => ({ ...s, sort: i }))).select('id'));
  return listContactStages();
}
export async function saveContactStage(st) {
  const row = { label: st.label?.trim(), sort: st.sort ?? 0, follow_days: st.follow_days ? Number(st.follow_days) : null, color: st.color || null };
  if (!row.label) throw new Error('請輸入階段名稱');
  if (row.follow_days != null && !(row.follow_days >= 1 && row.follow_days <= 365)) throw new Error('提醒天數是 1～365');
  if (st.id) return must(await supabase.from('contact_stages').update(row).eq('id', st.id).select().single());
  return must(await supabase.from('contact_stages').insert(row).select().single());
}
export const deleteContactStage = (id) => trashDelete('contact_stages', id);
export async function listContacts() {
  return must(await supabase.from('contacts').select('*').order('created_at', { ascending: false }));
}
export async function saveContact(c) {
  const row = { name: c.name?.trim(), stage_id: c.stage_id || null, phone: c.phone?.trim() || null, line_id: c.line_id?.trim() || null,
    ig: c.ig?.trim() || null, source: c.source?.trim() || null, interests: c.interests?.trim() || null,
    tags: Array.isArray(c.tags) ? c.tags : parseTags(c.tags), next_follow_on: c.next_follow_on || null, notes: c.notes?.trim() || null,
    archived: Boolean(c.archived) };
  if (!row.name) throw new Error('請輸入姓名');
  if (c.id) return must(await supabase.from('contacts').update(row).eq('id', c.id).select().single());
  return must(await supabase.from('contacts').insert(row).select().single());
}
export const deleteContact = (id) => trashDelete('contacts', id);
export async function listContactLogs(contactId) {
  const q = supabase.from('contact_logs').select('*').order('log_date', { ascending: false }).order('created_at', { ascending: false });
  return must(await (contactId ? q.eq('contact_id', contactId) : q));
}
/** 新增聯絡紀錄：同時更新對象的最近聯絡日（取較晚者），可一併設定下次跟進日 */
export async function addContactLog(contact, { log_date, kind, content, next_step, next_follow_on }) {
  if (!log_date) throw new Error('請選日期');
  if (!content?.trim() && !kind) throw new Error('請寫一點內容');
  const log = must(await supabase.from('contact_logs').insert({ contact_id: contact.id, log_date, kind: kind || null,
    content: content?.trim() || null, next_step: next_step?.trim() || null }).select().single());
  const patch = {};
  if (!contact.last_contact_on || log_date > contact.last_contact_on) patch.last_contact_on = log_date;
  if (next_follow_on !== undefined) patch.next_follow_on = next_follow_on || null;
  if (Object.keys(patch).length) must(await supabase.from('contacts').update(patch).eq('id', contact.id).select('id'));
  return log;
}
export async function deleteContactLog(id) {
  const rows = must(await supabase.from('contact_logs').delete().eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error(`預期刪除 1 筆，實際 ${rows.length} 筆`);
}
/**
 * 今天該跟進誰：下次跟進日已到，或依階段的提醒天數「距最近一次聯絡」已超過（沒聯絡過的用建立日）
 * @returns {{contact, reason:'due'|'overdue'|'quiet', days:number}[]} 依急迫程度排序
 */
export function contactsToFollow(contacts, stages, day = today()) {
  const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
  const out = [];
  for (const c of contacts) {
    if (c.archived) continue;
    if (c.next_follow_on && c.next_follow_on <= day) {
      const days = Math.round((Date.parse(day) - Date.parse(c.next_follow_on)) / 86400000);
      out.push({ contact: c, reason: days > 0 ? 'overdue' : 'due', days });
      continue;
    }
    const fd = byId[c.stage_id]?.follow_days;
    if (!fd || c.next_follow_on) continue;
    const last = c.last_contact_on || localDate(c.created_at);
    const days = Math.round((Date.parse(day) - Date.parse(last)) / 86400000);
    if (days >= fd) out.push({ contact: c, reason: 'quiet', days });
  }
  const rank = { overdue: 0, due: 1, quiet: 2 };
  return out.sort((a, b) => rank[a.reason] - rank[b.reason] || b.days - a.days);
}

// ===== 跟進對象 20261106（D）=====
// 跟進對象頁（views/contacts.js）與總覽「今天該跟進」用的衍生計算；不改上面的既有函式。
// 聯絡類型只是常用選項，介面上可以自由輸入（不代表任何老師的心法）
export const CONTACT_LOG_KINDS = ['聯絡', '邀約', '分享', '試用', '跟進', '其他'];
/** 心法筆記＝靈感知識庫裡帶這個標籤的筆記（不另開資料表） */
export const CONTACT_NOTE_TAG = '跟進心法';
export const contactNotes = (notes) => notes.filter((n) => (n.tags || []).includes(CONTACT_NOTE_TAG));

/** 某天距今幾天（YYYY-MM-DD；沒有日期回傳 null） */
export function contactDaysSince(dateStr, day = today()) {
  if (!dateStr) return null;
  return Math.round((Date.parse(day) - Date.parse(dateStr)) / 86400000);
}

/** 搜尋（姓名、聯絡方式、認識管道、興趣產品、備註、標籤；空白分隔的每個字都要符合）＋標籤＋是否含已封存 */
export function contactFilter(contacts, { q = '', tag = '', archived = false } = {}) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return contacts.filter((c) => {
    if (!archived && c.archived) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    const hay = [c.name, c.phone, c.line_id, c.ig, c.source, c.interests, c.notes, ...(c.tags || [])].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w.replace(/^#/, '')));
  });
}
export const contactTagCounts = (contacts) => tagCounts(contacts.filter((c) => !c.archived));

/** 依階段分組（階段的順序）；沒有階段或階段已刪除的放最後「未分階段」（只在有人時出現） */
export function contactsByStage(contacts, stages) {
  const ids = new Set(stages.map((s) => s.id));
  const sortIn = (list) => list.slice().sort((a, b) => (a.archived - b.archived) || (a.name || '').localeCompare(b.name || '', 'zh-Hant'));
  const groups = stages.map((s) => ({ stage: s, contacts: sortIn(contacts.filter((c) => c.stage_id === s.id)) }));
  const loose = contacts.filter((c) => !ids.has(c.stage_id));
  if (loose.length) groups.push({ stage: null, contacts: sortIn(loose) });
  return groups;
}

/** 改階段（拖移或選單） */
export async function contactMoveStage(contact, stageId) {
  if ((contact.stage_id || null) === (stageId || null)) return contact;
  return must(await supabase.from('contacts').update({ stage_id: stageId || null }).eq('id', contact.id).select().single());
}

/** 階段排序：依畫面順序寫入 sort（只寫有變的） */
export async function contactReorderStages(orderedStages) {
  for (const [i, s] of orderedStages.entries()) {
    if (s.sort !== i) must(await supabase.from('contact_stages').update({ sort: i }).eq('id', s.id).select('id'));
  }
}
/** 新階段排在最後 */
export const contactAddStage = (label, stages) =>
  saveContactStage({ label, follow_days: null, sort: stages.reduce((m, s) => Math.max(m, s.sort ?? 0), -1) + 1 });
/** 這個階段有幾人（含已封存）——刪除階段前說明影響 */
export const contactStageUsage = (contacts, stageId) => contacts.filter((c) => c.stage_id === stageId).length;

/**
 * 記一筆聯絡時的「下次跟進日」：有填就用填的；留白時，已到期（≤ 這次聯絡日）的跟進日視為完成而清掉，
 * 還沒到的保留。回傳 undefined＝不改。
 */
export function contactNextFollowForLog(contact, logDate, input) {
  if (input) return input;
  if (contact.next_follow_on && contact.next_follow_on <= logDate) return null;
  return undefined;
}

/** 刪除一筆聯絡紀錄，並依剩下的紀錄重算最近聯絡日（沒有紀錄就清空），避免「最近聯絡」對不上 */
export async function contactDeleteLog(contact, logId) {
  await deleteContactLog(logId);
  const rest = await listContactLogs(contact.id);
  const latest = rest.reduce((m, l) => (l.log_date > m ? l.log_date : m), '') || null;
  if (latest !== (contact.last_contact_on || null)) {
    must(await supabase.from('contacts').update({ last_contact_on: latest }).eq('id', contact.id).select('id'));
  }
}

/** 「今天該跟進」每一筆的說明文字（頁面與總覽共用） */
export function contactFollowReason(item, stagesById = {}) {
  const c = item.contact;
  if (item.reason === 'overdue') return `逾期 ${item.days} 天（原訂 ${Number(c.next_follow_on.slice(5, 7))}/${Number(c.next_follow_on.slice(8))}）`;
  if (item.reason === 'due') return '今天要跟進';
  const st = stagesById[c.stage_id];
  const base = c.last_contact_on ? `${item.days} 天沒聯絡` : `加入 ${item.days} 天還沒聯絡`;
  return st?.follow_days ? `${base}（「${st.label}」${st.follow_days} 天提醒）` : base;
}

// ===== 收件匣 20261106（C）=====
// 收件匣頁（views/inbox.js）、總覽提醒、側欄徽章共用；只組合上面「收件匣」段落的函式，不改它們的行為。
/** 分頁：未看（沒點開過）／已點開／已處理 */
export function inboxTabOf(it) {
  if (it.done_at) return 'done';
  return it.opened_at ? 'opened' : 'unread';
}
/** 存入幾天了（經過的整天數；和 staleInbox 同一種算法：超過 7 天＝第 8 天起算放很久） */
export function inboxAgeDays(it, now = Date.now()) {
  return Math.max(0, Math.floor((now - Date.parse(it.created_at)) / 86400000));
}
/** 用過的分類（使用次數多的在前），給輸入框建議與篩選 */
export function inboxCategories(items) {
  const count = {};
  for (const it of items) if (it.category) count[it.category] = (count[it.category] || 0) + 1;
  return Object.entries(count).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant')).map(([c]) => c);
}
/**
 * 拆分享文字（包 splitSharedText）：小紅書等分享文字的網址後面常直接接全形標點（例如「…/AbCdEf，复制本条信息…」），
 * splitSharedText 只在空白處斷開，會把後面的中文吃進網址；這裡在第一個全形標點處截斷，剩下的放回內容。
 */
export const inboxSplitShared = (text) => splitSharedText(text); // 全形標點的截斷已併進 splitSharedText
/** 同一個網址已經存過的那筆（避免手機重複分享時不知道） */
export function inboxFindUrl(items, url) {
  if (!url) return null;
  return items.find((i) => i.url === url) || null;
}
/** 側欄徽章／總覽提醒用：放超過 7 天還沒點開的筆數 */
export async function inboxStaleCount() {
  return staleInbox(await listInbox()).length;
}

// ===== 標籤管理 20261106（E）=====
// 標籤／分類管理頁（views/tags.js）只呼叫這裡。陣列標籤（靈感、書影單、跟進對象）與單值分類（想做清單、收件匣）
// 沒有另外的清單表：標籤＝資料裡實際用到的值，所以「新增」＝把新標籤套到勾選的幾筆。
// 每個批次更新都先算好要改哪些列，更新後檢查實際筆數＝預期筆數，否則報錯。
export const TAG_SCOPES = {
  note: { table: 'notes', col: 'tags', array: true, label: '靈感標籤', unit: '則靈感', title: (r) => r.title },
  media: { table: 'media_items', col: 'tags', array: true, label: '書影單標籤', unit: '筆書影單', title: (r) => r.title },
  contact: { table: 'contacts', col: 'tags', array: true, label: '跟進對象標籤', unit: '位跟進對象', title: (r) => r.name },
  bucket: { table: 'bucket_items', col: 'category', array: false, label: '想做清單分類', unit: '項想做的事', title: (r) => r.title },
  inbox: { table: 'inbox_items', col: 'category', array: false, label: '待看清單分類', unit: '筆待看清單', title: (r) => r.title || r.url || (r.body || '').slice(0, 40) },
};
function tagScope(scope) {
  const s = TAG_SCOPES[scope];
  if (!s) throw new Error(`不認得的標籤範圍「${scope}」`);
  return s;
}
const tagClean = (v) => String(v ?? '').replace(/^#+/, '').trim();
const tagValues = (s, r) => (s.array ? (r[s.col] || []) : (r[s.col] ? [r[s.col]] : []));
function tagCheckName(s, name) {
  if (!name) throw new Error('請輸入名稱');
  if (s.array && /[,，、\s]/.test(name)) throw new Error('標籤不能有空白或逗號');
  if (name.length > 30) throw new Error('名稱最多 30 字');
}

/** 某範圍的全部資料列；表還沒建立（未跑 migration）時丟出錯誤，由頁面顯示「尚未啟用」 */
export async function tagRows(scope) {
  const s = tagScope(scope);
  return must(await supabase.from(s.table).select('*'));
}
/** 用到的標籤與次數：[{ name, count }]，多的在前 */
export async function tagUsage(scope, rows = null) {
  const s = tagScope(scope);
  const m = {};
  for (const r of rows || await tagRows(scope)) for (const t of tagValues(s, r)) m[t] = (m[t] || 0) + 1;
  return Object.entries(m).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
}
/** 會受影響的列（改名／刪除前顯示筆數用） */
export async function tagAffected(scope, name) {
  const s = tagScope(scope);
  return (await tagRows(scope)).filter((r) => tagValues(s, r).includes(name));
}
async function tagApply(s, changes) {
  let n = 0;
  for (let i = 0; i < changes.length; i += 20) { // 每批 20 筆並行，避免數百筆逐一等待
    const res = await Promise.all(changes.slice(i, i + 20).map(({ id, value }) =>
      supabase.from(s.table).update({ [s.col]: value }).eq('id', id).select('id')));
    n += res.reduce((k, r) => k + must(r).length, 0);
  }
  if (n !== changes.length) throw new Error(`預期更新 ${changes.length} 筆，實際 ${n} 筆`);
  return n;
}
/** 改名；新名稱已存在＝合併（陣列會去重）。回傳更新筆數 */
export async function tagRename(scope, from, to) {
  const s = tagScope(scope);
  const name = tagClean(to);
  tagCheckName(s, name);
  if (name === from) return 0;
  const changes = (await tagAffected(scope, from)).map((r) => ({
    id: r.id, value: s.array ? [...new Set(r[s.col].map((t) => (t === from ? name : t)))] : name,
  }));
  return tagApply(s, changes);
}
/** 刪除：從所有資料移除這個標籤（分類＝清空）。資料本身不刪。回傳更新筆數 */
export async function tagDelete(scope, name) {
  const s = tagScope(scope);
  const changes = (await tagAffected(scope, name)).map((r) => ({
    id: r.id, value: s.array ? r[s.col].filter((t) => t !== name) : null,
  }));
  return tagApply(s, changes);
}
/** 新增：把標籤套到勾選的資料（分類會取代原本的分類）。回傳實際有改的筆數 */
export async function tagAdd(scope, name, ids) {
  const s = tagScope(scope);
  const tag = tagClean(name);
  tagCheckName(s, tag);
  if (!ids?.length) throw new Error('請至少勾選一筆要套用的資料');
  const want = new Set(ids);
  const changes = (await tagRows(scope)).filter((r) => want.has(r.id) && !tagValues(s, r).includes(tag))
    .map((r) => ({ id: r.id, value: s.array ? [...(r[s.col] || []), tag].slice(0, 20) : tag }));
  return tagApply(s, changes);
}

// --- 工作看板標籤（work_tags：type＝工作種類、project＝專案標籤）的使用次數與合併 ---
const TAG_WORK_COL = { type: 'work_type_id', project: 'work_project_tag_id' };
/** { [tagId]: 任務數 } */
export async function tagWorkUsage() {
  const tasks = must(await supabase.from('tasks').select('id, work_type_id, work_project_tag_id'));
  const m = {};
  for (const t of tasks) for (const col of Object.values(TAG_WORK_COL)) if (t[col]) m[t[col]] = (m[t[col]] || 0) + 1;
  return m;
}
/** 合併：把用 from 的任務改用 to，再把 from 移到垃圾桶。回傳改了幾件任務 */
export async function tagMergeWorkTag(from, to) {
  if (from.id === to.id) return 0;
  if ((from.kind || 'type') !== (to.kind || 'type')) throw new Error('只能合併同一類的標籤');
  const col = TAG_WORK_COL[from.kind || 'type'];
  const ids = must(await supabase.from('tasks').select('id').eq(col, from.id)).map((r) => r.id);
  const n = ids.length ? must(await supabase.from('tasks').update({ [col]: to.id }).in('id', ids).select('id')).length : 0;
  if (n !== ids.length) throw new Error(`預期更新 ${ids.length} 件任務，實際 ${n} 件`);
  await deleteWorkTag(from.id);
  return n;
}

// --- 領域（areas）：新增、改名、改顏色、刪除。刪除不走垃圾桶；有資料掛著時先改掛到另一個領域 ---
// restrict＝資料庫會擋刪除（schema.sql：on delete restrict）；其餘是 on delete set null，但每筆都該掛領域（CLAUDE.md），所以一起改掛
export const TAG_AREA_REFS = [
  { table: 'tasks', restrict: true }, { table: 'time_entries', restrict: true },
  { table: 'projects', restrict: true }, { table: 'goals', restrict: true },
  { table: 'habits' }, { table: 'notes' }, { table: 'media_items' }, { table: 'bucket_items' },
  { table: 'future_events' }, { table: 'inbox_items' }, { table: 'reflections' },
];
/** { [areaId]: { [table]: 筆數 } }；還沒建立的表當 0 */
export async function tagAreaUsage() {
  const out = {};
  await Promise.all(TAG_AREA_REFS.map(async ({ table }) => {
    let rows = [];
    try { rows = must(await supabase.from(table).select('id, area_id')); } catch { rows = []; }
    for (const r of rows) {
      if (!r.area_id) continue;
      const m = (out[r.area_id] ||= {});
      m[table] = (m[table] || 0) + 1;
    }
  }));
  return out;
}
/** 新增或修改領域（名稱、顏色、類型） */
export async function tagSaveArea(area, areas) {
  const name = area.name?.trim();
  if (!name) throw new Error('請輸入領域名稱');
  if (name.length > 30) throw new Error('名稱最多 30 字');
  if (areas.some((a) => a.id !== area.id && a.name === name)) throw new Error('已有同名領域');
  if (!area.id) return createArea({ name, kind: area.kind || 'life', color: area.color }, areas);
  const row = { name };
  if (area.color) row.color = area.color;
  if (area.kind) { if (!AREA_KINDS[area.kind]) throw new Error('請選擇類型'); row.kind = area.kind; }
  const rows = must(await supabase.from('areas').update(row).eq('id', area.id).select());
  if (rows.length !== 1) throw new Error(`預期更新 1 筆，實際 ${rows.length} 筆`);
  return rows[0];
}
/**
 * 刪除領域；moveTo 有值時先把所有掛著的資料改掛過去（逐表檢查筆數）。
 * 沒有 moveTo 而還有資料掛著時拒絕。回傳 { moved: {table: n} }
 */
export async function tagDeleteArea(areaId, moveTo, areas) {
  if (areas.length <= 1) throw new Error('至少要保留一個領域');
  if (moveTo === areaId) throw new Error('不能改掛到要刪除的同一個領域');
  if (moveTo && !areas.some((a) => a.id === moveTo)) throw new Error('找不到要改掛的領域');
  const usage = (await tagAreaUsage())[areaId] || {};
  const total = Object.values(usage).reduce((a, b) => a + b, 0);
  if (total && !moveTo) throw new Error(`還有 ${total} 筆資料掛在這個領域，請先選擇改掛到哪個領域`);
  const moved = {};
  for (const [table, n] of Object.entries(usage)) {
    const rows = must(await supabase.from(table).update({ area_id: moveTo }).eq('area_id', areaId).select('id'));
    if (rows.length !== n) throw new Error(`「${BACKUP_LABELS[table] || table}」預期改掛 ${n} 筆，實際 ${rows.length} 筆`);
    moved[table] = n;
  }
  const del = must(await supabase.from('areas').delete().eq('id', areaId).select('id'));
  if (del.length !== 1) throw new Error(`預期刪除 1 個領域，實際 ${del.length} 個`);
  return { moved };
}

// ===== 專案整合與 CFA 匯入 20261106（B）=====
// 目標掛在專案底下、習慣串接專案、連續 21 天鼓勵、CFA 規劃表（CSV）匯入。UI 只呼叫這裡。

/** 儲存目標＋所屬專案（saveGoal 不碰 project_id，所以另外寫；沒傳 project_id 就不動） */
export const projectSaveGoal = (g) => saveGoal(g); // saveGoal 已直接處理 project_id

/** 新增／編輯習慣＋所屬專案與目標 */
export async function projectSaveHabit(id, { name, area_id, target_per_week, project_id, goal_id }) {
  const h = id ? await updateHabit(id, { name, area_id, target_per_week }) : await createHabit({ name, area_id, target_per_week });
  if ((h.project_id || null) === (project_id || null) && (h.goal_id || null) === (goal_id || null)) return h;
  return setHabitLinks(h.id, { project_id: project_id || null, goal_id: goal_id || null });
}

/** 專案卡片的目標：進行中在前、依期限 */
export function projectGoals(goals, projectId) {
  const rank = { active: 0, done: 1, dropped: 2 };
  return goalsOfProject(goals, projectId).sort((a, b) => rank[a.status] - rank[b.status]
    || (a.due_date || '9999').localeCompare(b.due_date || '9999') || (a.created_at || '').localeCompare(b.created_at || ''));
}

/** 這一輪連續打卡從哪天開始（沒有連續＝null）；habitStats 的 streak 從今天（今天沒打就從昨天）往回算 */
export function projectStreakStart(stat, day = today()) {
  if (!stat.streak) return null;
  return addDays(stat.doneToday ? day : addDays(day, -1), -(stat.streak - 1));
}

/**
 * 連續 21 天的鼓勵要不要跳：達到門檻，且這一輪還沒跳過。回傳這一輪的起始日（要跳）或 null。
 * cheered＝上次跳鼓勵時那一輪的起始日；比它晚開始的才是新的一輪（補打更早的卡只會讓起始日變早，不算新一輪）。
 */
export function projectShouldCheer(stat, cheered, day = today()) {
  if (stat.streak < STREAK_MILESTONE) return null;
  const start = projectStreakStart(stat, day);
  return !cheered || cheered < start ? start : null;
}

// --- CFA 規劃表匯入（Google 試算表「每日進度」分頁下載成 CSV）---
export const CFA_PROJECT_NAME = 'CFA 2027 Level I';
export const CFA_STAGES = [
  { key: '第一輪', title: 'CFA 第一輪', test: /第一輪/ },
  { key: '第二輪', title: 'CFA 第二輪', test: /第二輪/ },
  { key: '模考衝刺', title: 'CFA 模考衝刺', test: /模考/ },
  { key: '考前週', title: 'CFA 考前週', test: /考前/ },
];
const CFA_PREFIX = 'CFA｜';
const CFA_SKIP_SUBJECT = /休息|緩衝|已重排/;

/** RFC 4180 CSV：雙引號包住的儲存格可含逗號、換行，"" 是一個引號；去掉 UTF-8 BOM */
export function cfaParseCSV(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// 依標題名稱找欄位（標題可能含換行、emoji，順序不固定）
const CFA_COLUMNS = {
  date: (k) => k === '日期',
  stage: (k) => k === '階段',
  hours: (k) => k === '時數',
  subject: (k) => k === '科目',
  book: (k) => /schweser/i.test(k),
  pages: (k) => k === '頁碼',
  content: (k) => k.startsWith('內容'),
  quiz: (k) => /modulequiz/i.test(k),
  qbank: (k) => /qbank/i.test(k),
  test: (k) => k.endsWith('測驗'),
  official: (k) => k.includes('官方教材'),
  extra: (k) => k.includes('延伸'),
  check: (k) => k === '✅',
  memo: (k) => k === '備註',
  task: (k) => k.includes('練習任務'),
};
const CFA_REQUIRED = { date: '日期', hours: '時數', subject: '科目' };
// 比對用：去掉空白、換行與彩色方塊／書本等 emoji（保留 ✅ 本身）
const cfaKey = (h) => String(h || '').replace(/\s+/g, '').replace(/[\u{1F000}-\u{1FFFF}️]/gu, '');

export function cfaColumns(header) {
  const keys = header.map(cfaKey);
  const cols = {};
  for (const [name, test] of Object.entries(CFA_COLUMNS)) {
    const i = keys.findIndex((k) => k && test(k));
    if (i >= 0) cols[name] = i;
  }
  const missing = Object.entries(CFA_REQUIRED).filter(([k]) => cols[k] == null).map(([, l]) => l);
  if (missing.length) throw new Error(`找不到欄位：${missing.join('、')}。請確認下載的是「每日進度」分頁，第一列是標題。`);
  return cols;
}

/** 2026/11/4、2026-11-04 → 2026-11-04；不是日期回傳 null */
export function cfaDate(v) {
  const m = String(v || '').trim().match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(d)) ? null : d;
}

const cfaFirstLine = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).find(Boolean) || '';
const cfaClean = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((x) => x.trim()).filter(Boolean).join('\n');

/** 一列 → 任務內容（標題、說明、預計時間、階段、是否已完成） */
function cfaRowTask(get, day, hours) {
  const subject = cfaFirstLine(get('subject'));
  const what = cfaFirstLine(get('task')) || cfaFirstLine(get('content'));
  const title = `${CFA_PREFIX}${subject}${what ? `：${what}` : ''}`.slice(0, 200);
  const lines = [];
  const add = (label, v) => { const c = cfaClean(v); if (c) lines.push(c.includes('\n') ? `${label}：\n${c}` : `${label}：${c}`); };
  add('📘 Schweser', [cfaClean(get('book')), cfaClean(get('pages')) && `頁碼 ${cfaClean(get('pages'))}`].filter(Boolean).join('　'));
  add('內容', get('content'));
  add('閱讀／練習任務', get('task'));
  add('Module Quiz', get('quiz'));
  add('🟧 Kaplan Qbank', get('qbank'));
  add('🟪 測驗', get('test'));
  add('🟩 官方教材', get('official'));
  add('🎬 延伸書籍／影片', get('extra'));
  add('備註', get('memo'));
  const stageText = cfaFirstLine(get('stage'));
  lines.push(`（由 CFA 規劃表匯入：${day.replaceAll('-', '/')}${stageText ? `・${stageText}` : ''}・${hours} 小時）`);
  const stage = CFA_STAGES.find((s) => s.test.test(stageText))?.key || null;
  return { day, title, notes: lines.join('\n'), estimate_min: Math.round(hours * 60), stage, done: /✓|✔/.test(get('check')) };
}

// --- 規劃表匯入（20261107 起所有專案都能用；CFA 規劃表是其中一種格式，自動辨認）---
// 通用格式欄位（依標題名稱找，順序不拘）：日期、任務（必要）；時數／預計分鐘、階段、說明、完成、優先級、編號（選填）。
const PLAN_COLUMNS = {
  date: (k) => ['日期', 'date'].includes(k),
  title: (k) => ['任務', '任務名稱', '標題', '項目', '待辦', 'task', 'title'].includes(k),
  hours: (k) => ['時數', '預計時數', '小時', 'hours'].includes(k),
  minutes: (k) => ['預計分鐘', '分鐘', 'minutes'].includes(k),
  stage: (k) => ['階段', '目標', 'stage', 'goal'].includes(k),
  notes: (k) => ['說明', '備註', '內容', 'notes'].includes(k),
  done: (k) => ['完成', '✅', 'done'].includes(k),
  priority: (k) => ['優先級', '優先', 'priority'].includes(k),
  ref: (k) => ['編號', 'id'].includes(k),
};
const planKey = (h) => cfaKey(h).toLowerCase();
const PLAN_DONE = /^(✓|✔|✅|v|x|是|完成|已完成|done|true|yes|y|1)$/i;
const PLAN_MARK = /由(?: CFA )?規劃表匯入：(\d{4})\/(\d{2})\/(\d{2})(?:・#([^・）]+))?/;

/** 這份表是哪一種格式：有 Schweser 欄＋科目＝CFA 規劃表，其餘用通用欄位 */
export function planFormat(header) {
  const keys = header.map(cfaKey);
  return keys.some((k) => /schweser/i.test(k)) && keys.includes('科目') ? 'cfa' : 'plan';
}

export function planColumns(header) {
  const keys = header.map(planKey);
  const cols = {};
  for (const [name, test] of Object.entries(PLAN_COLUMNS)) {
    const i = keys.findIndex((k) => k && test(k));
    if (i >= 0) cols[name] = i;
  }
  const missing = [cols.date == null && '日期', cols.title == null && '任務'].filter(Boolean);
  if (missing.length) throw new Error(`找不到欄位：${missing.join('、')}。第一列要是標題，至少要有「日期」和「任務」兩欄（可以下載範例檔對照）。`);
  return cols;
}

/** 2026/11/4、2026-11-04、Excel 日期序號（45000 左右）→ 2026-11-04 */
export function planDate(v) {
  const s = String(v ?? '').trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return cfaDate(s);
}

function planPriority(v) {
  const s = String(v || '').trim();
  if (/^(1|高|high)$/i.test(s)) return 1;
  if (/^(3|低|low)$/i.test(s)) return 3;
  return 2;
}

/** 一列 → 任務內容（通用格式）。key＝編號，沒有編號就用「日期＋任務名稱」 */
function planRowTask(get, day) {
  const title = cfaFirstLine(get('title')).slice(0, 200);
  const ref = cfaFirstLine(get('ref'));
  const hours = Number.parseFloat(String(get('hours')).replace(/[^\d.]/g, ''));
  const minutes = Number.parseFloat(String(get('minutes')).replace(/[^\d.]/g, ''));
  const estimate_min = minutes > 0 ? Math.round(minutes) : hours > 0 ? Math.round(hours * 60) : null;
  const stage = cfaFirstLine(get('stage')) || null;
  const body = cfaClean(get('notes'));
  const mark = `（由規劃表匯入：${day.replaceAll('-', '/')}${ref ? `・#${ref}` : ''}${stage ? `・${stage}` : ''}）`;
  return {
    key: ref ? `#${ref}` : `${day}|${title}`, day, title, stage, estimate_min,
    notes: body ? `${body}\n${mark}` : mark, priority: planPriority(get('priority')),
    done: PLAN_DONE.test(String(get('done')).trim()) || /✓|✔/.test(get('done')),
  };
}

/** 已存在的任務 → 比對用的 key（說明最後一行記著規劃表的原始日期／編號，任務被拖到別天仍認得） */
function planTaskKey(t, format) {
  const m = PLAN_MARK.exec(t.notes || '');
  if (format === 'cfa') {
    if (!t.title.startsWith(CFA_PREFIX)) return null;
    return m ? `${m[1]}-${m[2]}-${m[3]}` : t.due_date;
  }
  if (!m || /由 CFA 規劃表/.test(m[0])) return null;
  return m[4] ? `#${m[4]}` : `${m[1]}-${m[2]}-${m[3]}|${t.title}`;
}

/**
 * 匯入預覽（不寫入）。rows：試算表的列（第一列是標題，見 sheet-file.js）。
 * projectId：匯入到哪個已存在的專案；留空＝新建（名稱 newProjectName，CFA 格式預設「CFA 2027 Level I」）。
 * 只匯入今天以後（含今天）的列，includePast 時也匯入以前的。同一筆（key 相同）→ 更新；已完成的不改回未完成。
 */
export function sheetImportPlan(rows, { projects, goals, tasks, areas, projectId, newProjectName = '', includePast = false, day = today() }) {
  rows = (rows || []).filter((r) => r.some((x) => String(x ?? '').trim() !== '')).map((r) => r.map((x) => String(x ?? '')));
  if (rows.length < 2) throw new Error('檔案裡沒有資料列');
  const format = planFormat(rows[0]);
  const cols = format === 'cfa' ? cfaColumns(rows[0]) : planColumns(rows[0]);
  const used = new Set(Object.values(cols));
  const unused = rows[0].map((h, i) => (used.has(i) ? '' : cfaFirstLine(h))).filter(Boolean);
  const skipped = {};
  const skip = (reason) => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const stageEnd = {};
  const items = [];
  const seen = new Set();
  for (const r of rows.slice(1)) {
    const get = (k) => (cols[k] == null ? '' : r[cols[k]] || '');
    const d = planDate(get('date'));
    if (!d) { skip('不是日期列'); continue; }
    let it;
    if (format === 'cfa') {
      const stageKey = CFA_STAGES.find((s) => s.test.test(get('stage')))?.key;
      if (stageKey && (!stageEnd[stageKey] || d > stageEnd[stageKey])) stageEnd[stageKey] = d;
      const hours = Number.parseFloat(String(get('hours')).replace(/[^\d.]/g, ''));
      if (d < day && !includePast) { skip('今天以前'); continue; }
      if (CFA_SKIP_SUBJECT.test(get('subject'))) { skip('休息／緩衝／已重排'); continue; }
      if (!(hours > 0)) { skip('沒有讀書時數'); continue; }
      it = { ...cfaRowTask(get, d, hours), key: d, priority: 2 };
    } else {
      const stage = cfaFirstLine(get('stage'));
      if (stage && (!stageEnd[stage] || d > stageEnd[stage])) stageEnd[stage] = d;
      if (d < day && !includePast) { skip('今天以前'); continue; }
      it = planRowTask(get, d);
      if (!it.title) { skip('沒有任務名稱'); continue; }
    }
    if (seen.has(it.key)) { skip(format === 'cfa' ? '同一天重複的列' : '重複的列'); continue; }
    seen.add(it.key);
    items.push(it);
  }

  const project = projectId ? projects.find((p) => p.id === projectId) || null
    : format === 'cfa' && projectId === undefined ? projects.find((p) => p.name.trim() === CFA_PROJECT_NAME) || null : null;
  const projectName = project?.name || newProjectName.trim() || (format === 'cfa' ? CFA_PROJECT_NAME : '');
  const areaChoices = areas.filter((a) => !a.on_board);
  const suggestedArea = project?.area_id || (format === 'cfa' ? (areaChoices.find((a) => a.name.includes('轉職')) || areaChoices.find((a) => a.kind === 'career'))?.id : null) || null;
  const stageList = format === 'cfa'
    ? CFA_STAGES.map((s) => ({ key: s.key, title: s.title }))
    : [...new Set(items.map((it) => it.stage).filter(Boolean))].map((s) => ({ key: s, title: s }));
  const mine = project ? goals.filter((g) => g.project_id === project.id) : [];
  const goalPlan = stageList.filter((s) => items.some((it) => it.stage === s.key)).map((s) => ({
    key: s.key, title: s.title, due_date: stageEnd[s.key] || null,
    existing: mine.find((g) => g.title.trim() === s.title) || (format === 'plan' && mine.find((g) => g.title.trim().endsWith(s.title))) || null,
  }));

  const byKey = {};
  if (project) {
    for (const t of tasks) {
      if (t.project_id !== project.id) continue;
      const key = planTaskKey(t, format);
      if (key && !byKey[key]) byKey[key] = t;
    }
  }
  const creates = [];
  const updates = [];
  const unchanged = [];
  for (const it of items) {
    const t = byKey[it.key];
    if (!t) { creates.push(it); continue; }
    const goal = goalPlan.find((g) => g.key === it.stage);
    const goalChanged = goal ? !goal.existing || t.goal_id !== goal.existing.id : Boolean(t.goal_id);
    // 規劃表上的日期改了（和上次匯入記下的原始日期不同）才搬到期日；只在 Life OS 拖到別天的不動
    const m = PLAN_MARK.exec(t.notes || '');
    const moveDay = Boolean(m) && `${m[1]}-${m[2]}-${m[3]}` !== it.day && t.status !== 'done';
    const changed = t.title !== it.title || (t.notes || '') !== it.notes || (t.estimate_min ?? null) !== (it.estimate_min ?? null)
      || goalChanged || (it.done && t.status !== 'done') || moveDay;
    (changed ? updates : unchanged).push({ ...it, task: t, moveDay });
  }
  return { format, unused, project, projectName, suggestedArea, areaChoices, goals: goalPlan, creates, updates, unchanged, skipped,
    total: rows.length - 1, pushAhead: items.filter((it) => it.day >= day && it.day <= addDays(day, 180)).length };
}

/** 依預覽寫入：專案 → 階段目標 → 任務（新增先建成待辦，完成的再標完成，completed_at 由觸發器寫） */
export async function sheetImportRun(plan, { areaId } = {}) {
  let project = plan.project;
  const area_id = project?.area_id || areaId;
  if (!area_id) throw new Error('請選擇領域');
  if (!project) {
    if (!plan.projectName) throw new Error('請輸入新專案的名稱');
    project = await saveProject({ name: plan.projectName, area_id, status: 'active' });
  }
  const goalIdOf = {};
  for (const g of plan.goals) {
    if (g.existing) {
      if (g.due_date && g.existing.due_date !== g.due_date) {
        await saveGoal({ id: g.existing.id, title: g.existing.title, area_id: g.existing.area_id, status: g.existing.status, due_date: g.due_date });
      }
      goalIdOf[g.key] = g.existing.id;
    } else {
      goalIdOf[g.key] = (await projectSaveGoal({ title: g.title, area_id, due_date: g.due_date, status: 'active', project_id: project.id })).id;
    }
  }
  const fields = (it) => ({ title: it.title, notes: it.notes, estimate_min: it.estimate_min, goal_id: goalIdOf[it.stage] || null });

  let created = [];
  if (plan.creates.length) {
    created = must(await supabase.from('tasks').insert(plan.creates.map((it) => pickTask({
      ...fields(it), area_id, project_id: project.id, due_date: it.day, status: 'todo', priority: it.priority || 2,
    }))).select('id, due_date, title, notes'));
    if (created.length !== plan.creates.length) throw new Error(`預期新增 ${plan.creates.length} 筆，實際 ${created.length} 筆`);
  }
  const sig = (day, title, notes) => `${day}|${title}|${notes}`;
  const idBySig = Object.fromEntries(created.map((t) => [sig(t.due_date, t.title, t.notes), t.id]));
  const writes = [
    ...plan.updates.map((it) => ({ id: it.task.id, patch: { ...fields(it), ...(it.moveDay ? { due_date: it.day } : {}), ...(it.done && it.task.status !== 'done' ? { status: 'done' } : {}) } })),
    ...plan.creates.filter((it) => it.done).map((it) => ({ id: idBySig[sig(it.day, it.title, it.notes)], patch: { status: 'done' } })),
  ];
  if (writes.some((w) => !w.id)) throw new Error('新增的任務對不上，請重新整理後再匯入一次（已新增的不會重複）');
  let updated = 0;
  for (let i = 0; i < writes.length; i += 20) {
    const res = await Promise.all(writes.slice(i, i + 20).map((w) => supabase.from('tasks').update(pickTask(w.patch)).eq('id', w.id).select('id')));
    updated += res.reduce((n, r) => n + must(r).length, 0);
  }
  if (updated !== writes.length) throw new Error(`預期更新 ${writes.length} 筆，實際 ${updated} 筆`);
  return { project, created: created.length, updated: plan.updates.length };
}

// 舊名稱（CFA 專用時期）保留給既有呼叫：CSV 文字 → 預覽／寫入
export const cfaPlanImport = (text, ctx) => sheetImportPlan(cfaParseCSV(text), ctx);
export const cfaRunImport = sheetImportRun;

// ===== 內在整理 20261108（顯化規劃・階段三；migration 20261108_manifest.sql）=====
// 三種便籤共用 reflections 表；各便籤自己的欄位放在 fields（jsonb）。UI 只呼叫這裡，統計也在這裡算。
export const REFLECT_KINDS = { mindshift: '轉念', release: '釋放', allow: '我允許' };
export const REFLECT_WANTS = { safety: '想要安全', approval: '想要認同', control: '想要控制' };
// 常見情緒詞（自己整理，依「想要」分組；使用者也可以自己輸入）
export const REFLECT_EMOTIONS = {
  safety: ['害怕', '焦慮', '擔心', '不安', '緊張', '慌張', '無助', '脆弱', '退縮', '心神不寧', '提心吊膽', '不知所措', '懷疑', '沒有把握'],
  approval: ['委屈', '自卑', '羞愧', '尷尬', '難過', '失落', '孤單', '被忽略', '嫉妒', '自責', '不被理解', '受傷', '丟臉', '比較心'],
  control: ['生氣', '煩躁', '不耐煩', '挫折', '怨懟', '憤怒', '急躁', '緊繃', '不甘心', '懊惱', '失控', '無力', '想證明', '放不下'],
};
// 各便籤在 fields 裡的欄位（其他鍵不存）
const REFLECT_FIELDS = { mindshift: ['facts', 'imagined', 'ideal', 'rebut'], release: ['body'], allow: ['but', 'rebut'] };
const REFLECT_MAX = 4000; // 每個文字欄的上限

/** 便籤標題：事件第一行，沒寫就用類型 */
export const reflectionTitle = (r) => (r.event || '').trim().split('\n')[0].slice(0, 80) || `（${REFLECT_KINDS[r.kind] || '便籤'}，沒寫事件）`;

/** 全部便籤：新到舊（日期，同一天依建立時間） */
export async function listReflections() {
  const rows = must(await supabase.from('reflections').select('*'));
  return rows.sort((a, b) => b.entry_date.localeCompare(a.entry_date) || String(b.created_at).localeCompare(String(a.created_at)));
}

/** 整理成可寫入的列（清掉不屬於這種便籤的欄位、檢查範圍） */
function reflectionRow(r) {
  if (!REFLECT_KINDS[r.kind]) throw new Error('便籤類型不正確');
  const text = (v) => {
    const t = (v ?? '').toString().trim();
    if (t.length > REFLECT_MAX) throw new Error(`每一格最多 ${REFLECT_MAX} 字`);
    return t || null;
  };
  const day = r.entry_date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日期格式不正確');
  const fields = {};
  for (const k of REFLECT_FIELDS[r.kind]) { const v = text(r.fields?.[k]); if (v) fields[k] = v; }
  const level = (v, label) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error(`${label}請填 0～10`);
    return n;
  };
  const isRelease = r.kind === 'release';
  const wants = isRelease ? [...new Set(r.wants || [])] : [];
  if (wants.some((w) => !REFLECT_WANTS[w])) throw new Error('「想要」只能選安全、認同、控制');
  const emotions = isRelease ? [...new Set((r.emotions || []).map((e) => String(e).trim()).filter(Boolean))] : [];
  if (emotions.some((e) => e.length > 20)) throw new Error('情緒詞每個最多 20 字');
  const count = isRelease ? Number(r.release_count || 0) : 0;
  if (!Number.isInteger(count) || count < 0) throw new Error('放下次數不正確');
  const row = {
    kind: r.kind, entry_date: day, event: text(r.event), fields, wants, emotions,
    intensity_before: isRelease ? level(r.intensity_before, '開始時的強度') : null,
    intensity_after: isRelease ? level(r.intensity_after, '結束時的強度') : null,
    release_count: count, feeling_after: text(r.feeling_after), next_action: text(r.next_action),
    updated_at: new Date().toISOString(),
  };
  if (!row.event && !Object.keys(fields).length && !row.feeling_after && !row.next_action && !emotions.length) {
    throw new Error('還沒寫任何內容');
  }
  return row;
}

/** 新增或更新一張便籤；更新後檢查筆數。task_id 只由 reflectionToTask 寫，這裡不碰 */
export async function saveReflection(r) {
  const row = reflectionRow(r);
  if (!r.id) return must(await supabase.from('reflections').insert(row).select().single());
  const rows = must(await supabase.from('reflections').update(row).eq('id', r.id).select());
  if (rows.length !== 1) throw new Error(`預期更新 1 張便籤，實際 ${rows.length} 張`);
  return rows[0];
}

/** 刪除：先進垃圾桶，30 天內可還原 */
export const deleteReflection = (id) => trashDelete('reflections', id);

/** 歷史清單篩選：類型、關鍵字（事件、各欄、情緒、感受、下一步）、日期區間 */
export function filterReflections(rows, { kind = '', q = '', from = '', to = '' } = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (kind && r.kind !== kind) return false;
    if (from && r.entry_date < from) return false;
    if (to && r.entry_date > to) return false;
    if (!words.length) return true;
    const hay = [r.event, ...Object.values(r.fields || {}), ...(r.emotions || []), r.feeling_after, r.next_action,
      ...(r.wants || []).map((w) => REFLECT_WANTS[w])].filter(Boolean).join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * 近 N 天（含今天，依 entry_date）統計：
 * - wants：三種「想要」各出現幾張（只算釋放便籤），由多到少
 * - emotions：情緒詞出現次數前 top 名
 * - release：開始、結束強度都有填的釋放便籤，平均開始／結束強度與平均下降（保留一位小數）
 */
export function reflectionStats(rows, { days = 30, top = 5, day = today() } = {}) {
  const from = addDays(day, -(days - 1));
  const recent = rows.filter((r) => r.entry_date >= from && r.entry_date <= day);
  const byKind = Object.fromEntries(Object.keys(REFLECT_KINDS).map((k) => [k, recent.filter((r) => r.kind === k).length]));
  const wants = Object.keys(REFLECT_WANTS).map((k) => ({ key: k, label: REFLECT_WANTS[k], n: recent.filter((r) => (r.wants || []).includes(k)).length }))
    .filter((w) => w.n).sort((a, b) => b.n - a.n);
  const em = new Map();
  for (const r of recent) for (const e of r.emotions || []) em.set(e, (em.get(e) || 0) + 1);
  const emotions = [...em].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n || a.word.localeCompare(b.word, 'zh-Hant')).slice(0, top);
  const pairs = recent.filter((r) => r.kind === 'release' && r.intensity_before != null && r.intensity_after != null);
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const before = avg(pairs.map((r) => r.intensity_before));
  const after = avg(pairs.map((r) => r.intensity_after));
  return {
    from, to: day, total: recent.length, byKind, wants, emotions,
    release: { n: pairs.length, before, after, drop: pairs.length ? Math.round((before - after) * 10) / 10 : null,
      times: recent.filter((r) => r.kind === 'release').reduce((n, r) => n + (r.release_count || 0), 0) },
  };
}

/** 下一步轉成任務：選領域、可填到期日；建立後把便籤的 task_id 設成新任務（檢查筆數） */
export async function reflectionToTask(ref, { title, area_id, due_date }, existing = []) {
  if (ref.task_id && existing.some((t) => t.id === ref.task_id)) throw new Error('這張便籤已經轉過任務了');
  const day = ref.entry_date || today();
  const notes = [`來自內在整理：${REFLECT_KINDS[ref.kind]}（${day.replaceAll('-', '/')}）`, ref.event ? `事件：${reflectionTitle(ref)}` : '']
    .filter(Boolean).join('\n');
  const task = await createTask({ title: (title || ref.next_action || '').trim().slice(0, 200), area_id, due_date: due_date || null, notes }, existing);
  const rows = must(await supabase.from('reflections').update({ task_id: task.id, updated_at: new Date().toISOString() }).eq('id', ref.id).select());
  if (rows.length !== 1) throw new Error(`任務已建立，但便籤沒有連上（預期 1 張，實際 ${rows.length} 張）`);
  return { task, reflection: rows[0] };
}

// ===== 回饋匣 20261111（D）=====
// 使用者邊用邊寫建議（views/feedback.js）；沒有程式會自動讀它，使用者說「處理回饋」時由 Claude 讀取（流程見 docs/15-feedback-workflow.md）。
// migration 20261111_feedback_box.sql。UI 只呼叫這裡。
export const FEEDBACK_KINDS = { bug: '問題', idea: '想法', question: '疑問' };
export const FEEDBACK_STATUS = { new: '新的', doing: '處理中', preview: '預覽中', done: '已完成', wontfix: '不處理' };
export const FEEDBACK_MAX = 4000;
TRASH_SPEC.feedback = { label: (r) => `回饋・${(r.body || '').split('\n')[0].slice(0, 40)}` };
TRASH_LABELS.feedback = '回饋';

/** 資料庫還沒跑 migration 時，把英文錯誤換成看得懂的說明 */
function feedbackMust(res) {
  const m = res.error?.message || '';
  if (res.error && (res.error.code === 'PGRST205' || res.error.code === '42P01' || /feedback.*(does not exist|schema cache)/i.test(m))) {
    throw new Error('回饋匣還沒啟用：需要先在 Supabase 執行 migration 20261111_feedback_box.sql');
  }
  return must(res);
}

/** 全部回饋：新到舊 */
export async function listFeedback() {
  return feedbackMust(await supabase.from('feedback').select('*').order('created_at', { ascending: false }));
}

/** 新增或修改回饋（只能改還是「新的」那幾筆；整理空白、檢查長度與類型） */
export async function saveFeedback(fb) {
  const body = String(fb.body ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new Error('請寫一點內容');
  if (body.length > FEEDBACK_MAX) throw new Error(`最多 ${FEEDBACK_MAX} 字`);
  const kind = fb.kind || (fb.id ? null : 'idea'); // 修改時沒給類型就不動
  if (kind && !FEEDBACK_KINDS[kind]) throw new Error('類型不正確');
  const page = fb.page == null ? null : String(fb.page).slice(0, 200) || null;
  if (fb.id) {
    const patch = { body, updated_at: new Date().toISOString() };
    if (kind) patch.kind = kind;
    const rows = feedbackMust(await supabase.from('feedback').update(patch)
      .eq('id', fb.id).eq('status', 'new').select());
    if (rows.length !== 1) throw new Error('這則回饋已經在處理，不能再修改');
    return rows[0];
  }
  return feedbackMust(await supabase.from('feedback').insert({ body, kind, page }).select().single());
}

/** 改狀態（可同時寫回覆）；處理回饋時用，畫面上不提供 */
export async function setFeedbackStatus(id, status, reply) {
  if (!FEEDBACK_STATUS[status]) throw new Error('狀態不正確');
  const patch = { status, updated_at: new Date().toISOString() };
  if (reply !== undefined) patch.reply = reply == null ? null : String(reply).trim() || null;
  const rows = feedbackMust(await supabase.from('feedback').update(patch).eq('id', id).select());
  if (rows.length !== 1) throw new Error(`預期更新 1 筆，實際 ${rows.length} 筆`);
  return rows[0];
}

/** 刪除（走垃圾桶，30 天內可還原）；只能刪還是「新的」 */
export async function deleteFeedback(id) {
  const row = feedbackMust(await supabase.from('feedback').select('id, status').eq('id', id).maybeSingle());
  if (!row) throw new Error('找不到這則回饋（可能已被刪除）');
  if (row.status !== 'new') throw new Error('這則回饋已經在處理，不能刪除');
  return trashDelete('feedback', id);
}

/** 各狀態筆數（分頁籤用） */
export function feedbackCounts(items) {
  const out = Object.fromEntries(Object.keys(FEEDBACK_STATUS).map((k) => [k, 0]));
  for (const it of items) if (out[it.status] != null) out[it.status]++;
  return out;
}

/** 側欄徽章：等使用者確認的（預覽中）筆數 */
export async function feedbackPreviewCount() {
  const rows = feedbackMust(await supabase.from('feedback').select('id').eq('status', 'preview'));
  return rows.length;
}

// ===== 知識庫自動儲存與總覽過期 20261111（B）=====
/** 靈感只寫了正文、標題留白時（自動儲存），用正文第一行當標題（最多 40 字） */
export function noteFallbackTitle(body) {
  const line = String(body || '').split('\n').map((x) => x.trim()).find(Boolean) || '';
  return line ? (line.length > 40 ? `${line.slice(0, 40)}…` : line) : '（未命名靈感）';
}

/** 兩個 YYYY-MM-DD 相差幾天（b − a），純日期運算 */
function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/**
 * 總覽「昨天沒做完」：已過期、還沒完成的生活任務（呼叫端傳 state.life.tasks，工作只在工作看板）。
 * 候選與排序直接用月度遷移的 migrationCandidates（同一套規則：未完成、代表日期早於今天），
 * 動作也用 migrateTasks，這裡只多算「過期幾天」與標題該用哪一句。
 * @returns {{ items: {task, day, daysLate}[], allYesterday: boolean }}
 */
export function overdueOverview(tasks, day = today()) {
  const items = migrationCandidates(tasks, day).map((c) => ({ task: c.task, day: c.day, daysLate: daysBetween(c.day, day) }));
  return { items, allYesterday: items.length > 0 && items.every((x) => x.day === addDays(day, -1)) };
}

// ===== 工作看板接續與案件沿用 20261111（A）=====
// 一個案件＝同一個 case_no 的所有工作任務（migration 20261111_case_shared 拿掉了唯一限制）。
// 「接續」＝今天這張標完成（留在今天的回報），另建一張同案號的新卡放到明天預計／累積未完成；進度紀錄與計時留在原卡。

/** 案件的分組鍵：有案號用案號，沒有的一張卡自成一案 */
export const caseKeyOf = (t) => (t.case_no ? `C:${t.case_no}` : `T:${t.id}`);

/** 把任務依案件分組（每組依建立時間舊到新） */
export function caseGroups(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const k = caseKeyOf(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map.values()].map((g) => g.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
}

/** 同一個案件的所有卡（舊到新）；沒有案號的只有自己 */
export function caseTasks(tasks, task) {
  if (!task?.case_no) return task ? [task] : [];
  return tasks.filter((t) => t.case_no === task.case_no).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

/** 代表卡：最新一張未完成的；都結束了就是最新一張 */
export function caseLead(cards) {
  return cards.filter(isOpen).at(-1) || cards.at(-1);
}

/** 案件狀態：有進行中的卡＝進行中；有待辦＝待辦；否則看最新一張 */
export function caseStatus(cards) {
  if (cards.some((t) => t.status === 'doing')) return 'doing';
  if (cards.some((t) => t.status === 'todo')) return 'todo';
  return cards.at(-1)?.status;
}

/** 連結比對用：去頭尾空白、網域小寫、去掉結尾的斜線 */
export function normLink(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  try {
    const url = new URL(s);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}${url.hash}`.replace(/\/+$/, '');
  } catch {
    return s.replace(/\/+$/, '').toLowerCase();
  }
}

/**
 * 新增工作前找同一個案件（純函式）：任一連結和既有案件的連結相同 → {reason:'link'}（自動沿用）；
 * 否則標題相同（忽略空白與大小寫）→ {reason:'title'}（要問使用者）。都找不到回傳 null。
 * 只看有案件編號的任務；有好幾個符合時用最新建立的那張的案號。傳 areasById 時只看列入工作看板的任務。
 */
export function findSameCase(tasks, { title = '', links = [] } = {}, areasById = null) {
  const pool = tasks.filter((t) => t.case_no && (!areasById || isWorkTask(t, areasById)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const want = new Set((links || []).map(normLink).filter(Boolean));
  if (want.size) {
    const hit = pool.find((t) => (t.links || []).some((u) => want.has(normLink(u))));
    if (hit) return { case_no: hit.case_no, reason: 'link', task: hit };
  }
  const k = normTitle(title);
  if (k) {
    const hit = pool.find((t) => normTitle(t.title) === k);
    if (hit) return { case_no: hit.case_no, reason: 'title', task: hit };
  }
  return null;
}

export const CONTINUE_TARGETS = { tomorrow: '明天預計', backlog: '累積未完成' };

/**
 * 接續任務（今日歸今日）：原卡標完成（completed_at 由觸發器寫），另建一張同案號的新卡。
 * target：'tomorrow'＝到期日改下一個工作日（有排程時刻的保留時刻，同拖到明天預計）；'backlog'＝不設日期、board_parked。
 * 新卡帶標題、連結、說明、領域、專案、目標、工作種類、專案標籤、優先級、星標、預計時間；進度紀錄與計時留在原卡。
 * 原卡沒有案號（舊資料）就一併給一個，兩張卡才接得起來。正在計時的先停止。
 * @returns {{ original, created, case_no }}
 */
export async function continueTask(task, target, { tasks = [], running = null, day = today() } = {}) {
  if (!task) throw new Error('找不到要接續的工作');
  if (!isOpen(task)) throw new Error('只有未完成的工作可以接續');
  if (!CONTINUE_TARGETS[target]) throw new Error('接續的位置不正確');
  const case_no = task.case_no || nextCaseNo(tasks);
  const next = nextWorkingDay(day);
  const place = target === 'tomorrow'
    ? { due_date: next, scheduled_start: shiftScheduled(task.scheduled_start, next), board_parked: false }
    : { due_date: null, scheduled_start: null, board_parked: true };
  const orders = tasks.map((t) => t.sort_order).filter((v) => v != null);
  const row = pickTask({
    title: task.title, notes: task.notes ?? null, links: task.links || [], area_id: task.area_id, project_id: task.project_id ?? null,
    goal_id: task.goal_id ?? null, work_type_id: task.work_type_id ?? null, work_project_tag_id: task.work_project_tag_id ?? null,
    priority: task.priority ?? 2, starred: Boolean(task.starred), estimate_min: task.estimate_min ?? null,
    status: 'todo', case_no, sort_order: orders.length ? Math.min(...orders) - 1 : null, ...place,
  });
  if (running?.task_id === task.id) await stopTimer(running);
  const created = must(await supabase.from('tasks').insert(row).select());
  if (created.length !== 1) throw new Error(`接續失敗：預期新增 1 張卡，實際 ${created.length} 張`);
  const patch = { status: 'done', ...(task.case_no ? {} : { case_no }) };
  let done = null;
  try { done = must(await supabase.from('tasks').update(patch).eq('id', task.id).select()); } catch { done = null; }
  if (done?.length !== 1) {
    // 原卡沒標成完成：把剛建的新卡收回，避免同一件工作出現兩張未完成的卡
    await supabase.from('tasks').delete().eq('id', created[0].id);
    throw new Error(`接續失敗：原本的卡沒有標成完成（預期 1 張，實際 ${done?.length ?? 0} 張），已取消新卡`);
  }
  return { original: done[0], created: created[0], case_no };
}

/** 案件歷程用：多張卡的全部計時（state.entries 只有近期） */
export async function listEntriesForTasks(ids) {
  if (!ids.length) return [];
  return must(await supabase.from('time_entries').select('*').in('task_id', ids).order('started_at', { ascending: false }));
}

/**
 * 合併案件（20261111 起）：把 drops 各案件所有卡的案號改成 keep 的案號，變成同一個案件的多張卡。
 * 不搬進度、不刪卡（案號可重複了）。keep 沒有案號時給一個新的。更新後核對筆數。
 * keep、drops 是 caseRows 的列。
 */
export async function mergeCaseNos(keep, drops, tasks = []) {
  if (!keep || !drops.length || drops.some((d) => d.key === keep.key)) throw new Error('請選擇要保留的案件和要合併的案件');
  const target = keep.task.case_no || nextCaseNo(tasks);
  const ids = [...(keep.task.case_no ? [] : keep.tasks), ...drops.flatMap((d) => d.tasks)].map((t) => t.id);
  const rows = must(await supabase.from('tasks').update({ case_no: target }).in('id', ids).select('id'));
  if (rows.length !== ids.length) throw new Error(`合併時預期更新 ${ids.length} 張卡，實際 ${rows.length} 張，請重新整理後檢查`);
  return { case_no: target, updated: rows.length };
}

// ===== 資安 20261111（C）=====
// 連結只允許 http／https（javascript:、data: 等點下去會執行或冒充）。畫面產生連結用 ui.safeHref，存檔與匯入用這裡。
export function isWebUrl(u) {
  try {
    const p = new URL(String(u ?? '').trim()).protocol;
    return p === 'http:' || p === 'https:';
  } catch { return false; }
}

/** 任務連結存檔前檢查：有一個不是 http(s) 就整筆不存，並說明是哪一個 */
export function assertWebLinks(links) {
  if (!Array.isArray(links)) throw new Error('連結格式不正確');
  const bad = links.find((u) => !isWebUrl(u));
  if (bad !== undefined) throw new Error(`連結只接受 http:// 或 https:// 開頭的網址：${String(bad).slice(0, 60)}`);
}

// 備份匯入時要過濾的連結欄位：array＝陣列（任務的 links），http＝http(s)，https＝只收 https（封面）
const IMPORT_LINK_FIELDS = {
  tasks: { links: 'array' },
  media_items: { link_url: 'http', cover_url: 'https' },
  inbox_items: { url: 'http' },
};

/** 把一列備份資料裡不安全的連結拿掉（陣列移除該項、單一欄位設成空），回傳拿掉的個數 */
export function cleanImportLinks(table, row) {
  let dropped = 0;
  for (const [col, kind] of Object.entries(IMPORT_LINK_FIELDS[table] || {})) {
    const v = row[col];
    if (v == null || v === '') continue;
    if (kind === 'array') {
      const list = Array.isArray(v) ? v : [];
      const keep = list.filter(isWebUrl);
      dropped += (Array.isArray(v) ? list.length : 1) - keep.length;
      row[col] = keep;
    } else if (!isWebUrl(v) || (kind === 'https' && !/^https:/i.test(String(v).trim()))) {
      row[col] = null;
      dropped++;
    }
  }
  return dropped;
}

/** Google 日曆私密網址的遮罩：前 30 字＋…＋後 10 字（前面是固定的 calendar.google.com 路徑、後面是 /basic.ics，不含金鑰那段） */
export function maskIcsUrl(url) {
  const v = String(url || '');
  return v.length <= 44 ? `${v.slice(0, 8)}…` : `${v.slice(0, 30)}…${v.slice(-10)}`;
}

// ===== 佳句本 20261112（來自回饋 8cd19a58；migration 20261112_quotes.sql）=====
// 記錄佳句（可掛書影單的一本），也是總覽「每日一句」的來源之一（混合規則在 quotes.js dailyCardOf）。
export const QUOTE_MAX = 2000;

export async function listQuotes() {
  return must(await supabase.from('quotes').select('*').order('created_at', { ascending: false }));
}

/** 新增或修改；回傳那一列。只寫有傳進來的欄位以外的固定欄位（body 必填） */
export async function saveQuote(q) {
  const body = String(q.body || '').trim();
  if (!body) throw new Error('請寫下佳句');
  if (body.length > QUOTE_MAX) throw new Error(`佳句最多 ${QUOTE_MAX} 字`);
  const clean = (v, max) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };
  const row = {
    body, author: clean(q.author, 120), source: clean(q.source, 200), thought: clean(q.thought, 4000),
    media_id: q.media_id || null, in_daily: q.in_daily !== false, updated_at: new Date().toISOString(),
  };
  if (q.id) {
    const rows = must(await supabase.from('quotes').update(row).eq('id', q.id).select());
    if (rows.length !== 1) throw new Error('找不到這則佳句（可能已被刪除）');
    window.dispatchEvent(new Event('lifeos:quotes-changed'));
    return rows[0];
  }
  const saved = must(await supabase.from('quotes').insert(row).select().single());
  window.dispatchEvent(new Event('lifeos:quotes-changed'));
  return saved;
}

export async function setQuoteInDaily(id, inDaily) {
  const rows = must(await supabase.from('quotes').update({ in_daily: Boolean(inDaily), updated_at: new Date().toISOString() }).eq('id', id).select('id'));
  if (rows.length !== 1) throw new Error('找不到這則佳句（可能已被刪除）');
  window.dispatchEvent(new Event('lifeos:quotes-changed'));
}

export async function deleteQuote(id) {
  await trashDelete('quotes', id);
  window.dispatchEvent(new Event('lifeos:quotes-changed'));
}

/** 書影單每一本的佳句數 {media_id: n} */
export function quoteCountsByMedia(quotes) {
  const out = {};
  for (const q of quotes) if (q.media_id) out[q.media_id] = (out[q.media_id] || 0) + 1;
  return out;
}

/** 篩選：關鍵字（佳句、作者、出處、想法、書名）＋書影單 id */
export function filterQuotes(quotes, { q = '', mediaId = '' } = {}, mediaById = {}) {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return quotes.filter((x) => {
    if (mediaId && x.media_id !== mediaId) return false;
    const hay = [x.body, x.author, x.source, x.thought, mediaById[x.media_id]?.title].join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ===== 工作看板欄內排序 20261113（回饋 a2fb4008：拖移排序沒反應）=====
/**
 * 同一欄調順序：只改這一欄的卡片。把這幾張卡原本的 sort_order 由小到大重新分配給新順序（等於在它們之間換位置），
 * 其他任務的順序完全不動、也不用寫入；原本沒有 sort_order 的，從這欄最大值往後接。回傳要寫的 [{id, sort_order}]。
 * （原本用 moveTask＋reorderTasks 會重寫全部未完成任務，200 多筆時要好幾秒，卡片放開後彈回原位，看起來像沒作用）
 */
export function columnOrderPatch(orderedIds, tasksById) {
  const have = orderedIds.map((id) => tasksById[id]?.sort_order).filter((v) => v != null).sort((a, b) => a - b);
  const unique = new Set(have).size === have.length;
  let slots;
  if (have.length === orderedIds.length && unique) slots = have;
  else {
    const start = have.length ? have[0] : 1000;
    slots = orderedIds.map((_, i) => start + i * 10);
  }
  return orderedIds.map((id, i) => ({ id, sort_order: slots[i] })).filter(({ id, sort_order }) => tasksById[id]?.sort_order !== sort_order);
}

export async function reorderColumn(orderedIds, tasksById) {
  const changed = columnOrderPatch(orderedIds, tasksById);
  const results = await Promise.all(changed.map(({ id, sort_order }) =>
    supabase.from('tasks').update({ sort_order }).eq('id', id).select('id')));
  const updated = results.reduce((n, r) => n + must(r).length, 0);
  if (updated !== changed.length) throw new Error(`排序預期更新 ${changed.length} 筆，實際 ${updated} 筆`);
  return updated;
}

