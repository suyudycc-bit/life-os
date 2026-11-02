import { supabase, isMock } from './supabase.js';
import * as data from './data.js';
import { state, loadAll, refreshTasks, subscribe, reset } from './store.js';
import { $, esc, toast } from './ui.js';
import { mountOverview } from './views/overview.js';
import { mountTasks } from './views/tasks.js';
import { mountStats } from './views/stats.js';
import { mountCalendar } from './views/calendar.js';
import { mountReview } from './views/review.js';
import { mountNotes } from './views/notes.js';
import { mountHabits } from './views/habits.js';
import { mountProjects } from './views/projects.js';
import { mountBackup } from './views/backup.js';
import { mountWorkBoard } from './views/workboard.js';
import { formatClock, formatHMS } from './dates.js';

// 左側選單 8 項（docs/00）；尚未實作的模組標示預計 Phase
// 選單圖示：24×24、1.6 筆畫的線條圖（樣式見 .icon）
const ICONS = {
  overview: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M9 9v10"/>',
  tasks: '<path d="M5 5h4v4H5zM5 15h4v4H5z"/><path d="m6 7 1 1 2-2M12 7h7M12 17h7"/>',
  projects: '<path d="M4 7h16M4 12h10M4 17h6"/><path d="m16 15 2 2 3-4"/>',
  calendar: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/><path d="M9 14.5h.01M13 14.5h.01M9 17.5h.01"/>',
  stats: '<path d="M12 4a8 8 0 1 0 8 8h-8z"/><path d="M15 3.5A6 6 0 0 1 20.5 9H15z"/>',
  review: '<path d="M5 19.5 6 15 16.5 4.5a2 2 0 0 1 3 3L9 18z"/><path d="M14.5 6.5l3 3"/>',
  notes: '<path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z"/><path d="M9.5 20h5"/>',
  habits: '<path d="M4 18c3-7 6-9 8-9s3 2 3 4-1 3-2 3-2-1-1-3 3-5 8-7"/>',
  workboard: '<path d="M4 4h16v16H4zM9.5 4v16M14.5 4v16"/><path d="M6 7.5h2M11 7.5h2M16 7.5h2M6 10.5h2M16 10.5h2"/>',
  backup: '<path d="M8 4v13M4.5 13.5 8 17l3.5-3.5M16 20V7M12.5 10.5 16 7l3.5 3.5"/>',
};
const icon = (id) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id]}</svg>`;

const ROUTES = [
  { id: 'overview', label: '總覽', mount: mountOverview },
  { id: 'tasks', label: '任務管理', mount: mountTasks, badge: true },
  { id: 'workboard', label: '工作看板', mount: mountWorkBoard },
  { id: 'projects', label: '專案與目標', mount: mountProjects },
  { id: 'calendar', label: '日曆', mount: mountCalendar },
  { id: 'stats', label: '時間統計', mount: mountStats },
  { id: 'review', label: '每日復盤', mount: mountReview },
  { id: 'notes', label: '靈感知識庫', mount: mountNotes },
  { id: 'habits', label: '習慣養成', mount: mountHabits },
  { id: 'backup', label: '數據與備份', mount: mountBackup },
];

let unsubscribe = null;

function renderNav() {
  const nav = $('#nav');
  nav.innerHTML = ROUTES.map((r) => `
    <a href="#/${r.id}" data-route="${r.id}" title="${r.label}">
      <span class="ico">${icon(r.id)}</span><span class="nav-label">${r.label}</span>
      ${r.badge ? '<span class="badge" id="nav-badge" hidden></span>' : ''}
    </a>`).join('');
}

function updateBadge() {
  const b = $('#nav-badge');
  if (!b) return;
  const n = data.openCount(state.life.tasks); // 工作的數量在工作看板，不算在任務管理
  b.textContent = n;
  b.hidden = n === 0;
  b.setAttribute('aria-label', `${n} 件未完成`);
}

/** 側欄的計時中提示：任何頁面都看得到、可直接暫停 */
function updateRunningBar() {
  const bar = $('#running-bar');
  const r = state.running;
  bar.hidden = !r;
  if (!r) return;
  const task = state.tasks.find((t) => t.id === r.task_id);
  bar.innerHTML = `
    <div class="rb-label">計時中</div>
    <a class="rb-title" href="#/tasks">${esc(task?.title || '（已刪除的任務）')}</a>
    <div class="rb-row"><span class="clock" data-since="${r.started_at}">${formatClock((Date.now() - new Date(r.started_at)) / 1000)}</span>
      <button class="btn-timer on" id="rb-pause" aria-label="暫停計時">⏸<span class="rb-txt"> 暫停</span></button></div>`;
  $('#rb-pause').onclick = async () => {
    try {
      await data.stopTimer(r);
      await refreshTasks();
      toast('已暫停，用時已記錄');
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// 每秒更新所有計時中的時鐘（只更新顯示，不寫資料）
setInterval(() => {
  document.querySelectorAll('.clock[data-since]').forEach((el) => {
    el.textContent = formatClock((Date.now() - new Date(el.dataset.since)) / 1000);
  });
  document.querySelectorAll('.live-dur[data-since]').forEach((el) => {
    el.textContent = formatHMS(Number(el.dataset.base) + (Date.now() - new Date(el.dataset.since)) / 1000);
  });
}, 1000);

function route() {
  const id = location.hash.replace('#/', '') || 'overview';
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  document.querySelectorAll('#nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.route === r.id);
  });
  const main = $('#main');
  unsubscribe?.();
  if (r.mount) {
    const render = r.mount(main);
    render();
    unsubscribe = subscribe(render);
  } else {
    main.innerHTML = `
      <header class="page-head"><h1>${r.label}</h1></header>
      <section class="card empty-page">
        <p>這個模組預計在 <strong>Phase ${r.phase}</strong> 加入。</p>
        <p class="sub">目前可以先在「任務管理」建立任務，之後的模組會直接讀取同一份資料。</p>
      </section>`;
    unsubscribe = null;
  }
  $('#app').classList.remove('nav-open');
}

function showAuth(message = '') {
  $('#app').hidden = true;
  const box = $('#auth');
  box.hidden = false;
  if (!supabase) {
    box.innerHTML = `
      <div class="card auth-card">
        <h1>Life OS</h1>
        <p>尚未設定 Supabase。請把 <code>src/js/config.example.js</code> 複製成 <code>config.js</code> 並填入專案網址與 anon key。</p>
        <p class="sub">只想先看介面：網址加上 <code>?mock=1</code> 使用本機模擬資料（不會同步）。</p>
      </div>`;
    return;
  }
  box.innerHTML = `
    <form class="card auth-card" id="auth-form">
      <h1>Life OS</h1>
      <p class="sub">登入後，手機與電腦會看到同一份資料。</p>
      ${isMock ? '<p class="warn">本機模擬模式：資料只存在這個瀏覽器。示範帳號 demo@lifeos.local／demo1234</p>' : ''}
      <label>Email<input type="email" name="email" required autocomplete="email"></label>
      <label>密碼<input type="password" name="password" required minlength="6" autocomplete="current-password"></label>
      <p class="form-msg" id="auth-msg" role="status">${esc(message)}</p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="signup-btn">註冊新帳號</button>
        <button class="btn-primary">登入</button>
      </div>
    </form>`;
  const form = $('#auth-form');
  const msg = $('#auth-msg');
  const submit = async (fn, label) => {
    if (!form.reportValidity()) return;
    msg.textContent = `${label}中…`;
    try {
      const res = await fn(form.email.value.trim(), form.password.value);
      if (fn === data.signUp && !res.session) {
        msg.textContent = '註冊成功，請到信箱點確認連結後再登入。';
      }
    } catch (e) {
      msg.textContent = e.message === 'Invalid login credentials' ? 'Email 或密碼錯誤' : e.message;
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(data.signIn, '登入'); };
  $('#signup-btn').onclick = () => submit(data.signUp, '註冊');
}

let loadedFor = null;
async function showApp(session) {
  if (loadedFor === session.user.id) return;
  loadedFor = session.user.id;
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#user-email').textContent = session.user.email;
  $('#mock-flag').hidden = !isMock;
  $('#main').innerHTML = '<p class="sub">載入中…</p>';
  try {
    await loadAll();
    if (isMock) {
      const { seedDemoTasks } = await import('./dev/mock-supabase.js');
      await seedDemoTasks(supabase, state.areas);
      await refreshTasks();
    }
    route();
  } catch (e) {
    $('#main').innerHTML = `<section class="card"><p class="warn">讀取資料失敗：${esc(e.message)}</p>
      <p class="sub">請確認已在 Supabase 執行 supabase/schema.sql。</p></section>`;
  }
}

function handleSession(session) {
  if (session) showApp(session);
  else {
    loadedFor = null;
    unsubscribe?.();
    reset();
    showAuth();
  }
}

renderNav();
subscribe(updateBadge);
subscribe(updateRunningBar);
window.addEventListener('hashchange', () => { if (loadedFor) route(); });
$('#menu-btn').onclick = () => $('#app').classList.toggle('nav-open');

// 側欄收合（只在電腦寬度生效；手機維持抽屜選單）。記在這台裝置的瀏覽器，不存資料庫
const SIDEBAR_KEY = 'lifeos-sidebar';
function setSidebarCollapsed(collapsed) {
  $('#app').classList.toggle('sb-collapsed', collapsed);
  const btn = $('#collapse-btn');
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? '展開側欄' : '收合側欄');
  btn.title = `${collapsed ? '展開' : '收合'}側欄（快捷鍵 [ ）`;
  try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'open'); } catch { /* 忽略 */ }
}
try { setSidebarCollapsed(localStorage.getItem(SIDEBAR_KEY) === 'collapsed'); } catch { setSidebarCollapsed(false); }
$('#collapse-btn').onclick = () => setSidebarCollapsed(!$('#app').classList.contains('sb-collapsed'));
document.addEventListener('keydown', (e) => {
  if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  setSidebarCollapsed(!$('#app').classList.contains('sb-collapsed'));
});
$('#signout-btn').onclick = async () => {
  try { await data.signOut(); } catch (e) { toast(e.message, true); }
};

// 從 Google 授權頁轉回來時顯示結果，並把網址上的參數清掉
{
  const q = new URLSearchParams(location.search);
  const g = q.get('google');
  if (g) {
    const msg = q.get('google_msg') || '';
    setTimeout(() => toast(g === 'connected' ? '已連結 Google，之後每小時自動同步' : `連結 Google 失敗：${msg}`, g !== 'connected'), 800);
    q.delete('google');
    q.delete('google_msg');
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}${location.hash}`);
  }
}

if (!supabase) {
  showAuth();
} else {
  data.onAuthChange(handleSession);
  handleSession(await data.getSession());
}
