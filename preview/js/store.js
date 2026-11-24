// 畫面共用狀態：只快取從資料庫讀回的資料，不自行產生衍生數字
import * as data from './data.js?v=202611242058';

export const state = { areas: [], areasById: {}, tasks: [], memosByTask: {}, entries: [], running: null, summary: null,
  reschedules: null, reschedulesByTask: {}, // 20261121 改期紀錄（null＝還沒讀過，第一次讀不算「新的延期」）
  notes: [], habits: [], habitLogs: [], projects: [], goals: [], workTags: [],
  // 生活頁面用的資料：排除「列入工作看板」領域（工作只留在工作看板，使用者決定 2026-11-03）
  life: { areas: [], tasks: [], entries: [], projects: [] } };
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setAreas(areas) {
  state.areas = areas;
  state.areasById = Object.fromEntries(areas.map((a) => [a.id, a]));
  computeLife();
}

/** 由完整資料算出生活那一份（不另存，只是篩選） */
function computeLife() {
  const work = (areaId) => state.areasById[areaId]?.on_board === true;
  state.life = {
    areas: state.areas.filter((a) => !a.on_board),
    tasks: state.tasks.filter((t) => !work(t.area_id)),
    entries: state.entries.filter((e) => !work(e.area_id)),
    projects: state.projects.filter((p) => !work(p.area_id)),
  };
}

export async function loadAll() {
  setAreas(await data.ensureAreas());
  const [notes, habits, habitLogs, projects, goals, workTags] = await Promise.all([
    data.listNotes(), data.listHabits(), data.listHabitLogs(), data.listProjects(), data.listGoals(),
    // 工作種類（Phase W）：還沒執行 migration 20261104 時當作沒有，不讓整個 app 載入失敗
    data.listWorkTags().catch(() => []),
  ]);
  Object.assign(state, { notes, habits, habitLogs, projects, goals, workTags });
  computeLife();
  await refreshTasks();
}

const notify = () => listeners.forEach((fn) => fn(state));

/** 靈感有變動後重新讀取 */
export async function refreshNotes() {
  state.notes = await data.listNotes();
  notify();
}

/** 專案或目標有變動後重新讀取（連同任務，因為刪除會取消任務的關聯） */
export async function refreshProjects() {
  const [projects, goals] = await Promise.all([data.listProjects(), data.listGoals()]);
  Object.assign(state, { projects, goals });
  computeLife();
  await refreshTasks();
}

/** 匯入備份後全部重讀 */
export async function reloadAll() {
  await loadAll();
}

/** 習慣或打卡有變動後重新讀取 */
export async function refreshHabits() {
  const [habits, habitLogs] = await Promise.all([data.listHabits(), data.listHabitLogs()]);
  Object.assign(state, { habits, habitLogs });
  notify();
}

/** 新增領域後重新讀取領域清單 */
export async function refreshAreas() {
  setAreas(await data.listAreas());
  listeners.forEach((fn) => fn(state));
}

/** 任何寫入後重新讀取任務、memo、計時與今日彙總，確保各模組看到同一份資料 */
export async function refreshTasks() {
  const [tasks, memos, entries, running, summary, reschedules] = await Promise.all([
    data.listTasks(), data.listMemos(), data.listEntries(), data.getRunningEntry(), data.getDailySummary(),
    data.listReschedules(),
  ]);
  // 20261121 改期紀錄：資料庫觸發器在任務往後移時記一筆。不管是哪一頁改的日期，寫入後都會走到這裡，
  // 所以在這裡比對「這次多出來、還沒填原因」的紀錄，發 lifeos:tasks-postponed 讓畫面問原因（views/postpone.js）。
  const seen = state.reschedules ? new Set(state.reschedules.map((r) => r.id)) : null;
  const fresh = seen ? reschedules.filter((r) => !seen.has(r.id) && !r.reason && Date.now() - new Date(r.created_at) < 120000) : [];
  state.reschedules = reschedules;
  state.reschedulesByTask = data.reschedulesByTask(reschedules);
  state.tasks = tasks;
  state.memosByTask = data.memosByTask(memos);
  state.entries = entries;
  state.running = running;
  state.summary = summary;
  computeLife();
  listeners.forEach((fn) => fn(state));
  if (fresh.length) window.dispatchEvent(new CustomEvent('lifeos:tasks-postponed', { detail: { rows: fresh } }));
}

export function reset() {
  Object.assign(state, { areas: [], areasById: {}, tasks: [], memosByTask: {}, entries: [], running: null, summary: null,
    reschedules: null, reschedulesByTask: {},
    notes: [], habits: [], habitLogs: [], projects: [], goals: [], workTags: [],
    life: { areas: [], tasks: [], entries: [], projects: [] } });
}
