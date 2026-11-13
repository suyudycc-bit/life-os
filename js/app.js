import './frame-guard.js'; // 資安 20261111（C）：被別的網站用 iframe 嵌入時不載入（必須排第一個）
import { supabase, isMock, isLocalDevHost } from './supabase.js';
import * as data from './data.js';
import { state, loadAll, refreshTasks, subscribe, reset } from './store.js';
import { $, esc, toast, setNavBadge, isPreviewPath } from './ui.js';
export { setNavBadge }; // 20261106：其他模組也可以從 ui.js 直接 import
import { mountOverview } from './views/overview.js';
import { mountTasks } from './views/tasks.js';
import { mountStats } from './views/stats.js';
import { mountCalendar } from './views/calendar.js';
import { mountReview } from './views/review.js';
import { mountNotes } from './views/notes.js';
import { mountMedia } from './views/media.js';
import { mountHabits } from './views/habits.js';
import { mountProjects } from './views/projects.js';
import { mountBackup } from './views/backup.js';
import { mountWorkBoard } from './views/workboard.js';
import { mountGuide } from './views/guide.js';
import { mountMonth } from './views/month.js';
import { mountBucket } from './views/bucket.js';
import { mountYear } from './views/year.js';
import { mountContacts } from './views/contacts.js';
import { mountInbox } from './views/inbox.js';
import { mountTags } from './views/tags.js';
import { mountReflect } from './views/reflect.js';
import { mountFeedback, openFeedbackDialog } from './views/feedback.js';
import { mountQuotes } from './views/quotes-book.js';
import { formatClock, formatHMS } from './dates.js';
import { pageEnter, watchStatNumbers } from './motion.js';
import { initAccount, openForgotPassword, watchRecovery } from './account.js';

// 左側選單 8 項（docs/00）；尚未實作的模組標示預計 Phase
// 選單圖示：24×24、1.6 筆畫的線條圖（樣式見 .icon）
const ICONS = {
  overview: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M9 9v10"/>',
  tasks: '<path d="M5 5h4v4H5zM5 15h4v4H5z"/><path d="m6 7 1 1 2-2M12 7h7M12 17h7"/>',
  projects: '<path d="M4 7h16M4 12h10M4 17h6"/><path d="m16 15 2 2 3-4"/>',
  calendar: '<path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/><path d="M9 14.5h.01M13 14.5h.01M9 17.5h.01"/>',
  // 年度手帳：3×3 的格子＝Year in Pixels
  year: '<path d="M4 4h16v16H4z"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01"/>',
  stats: '<path d="M12 4a8 8 0 1 0 8 8h-8z"/><path d="M15 3.5A6 6 0 0 1 20.5 9H15z"/>',
  review: '<path d="M5 19.5 6 15 16.5 4.5a2 2 0 0 1 3 3L9 18z"/><path d="M14.5 6.5l3 3"/>',
  // 收件匣（畫面上叫「待看清單」）：托盤＋往下的箭頭（分享進來）
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4z"/><path d="M4 13.5h4.5l1 2h5l1-2H20M12 3.5v6.5M9.5 7.5 12 10l2.5-2.5"/>',
  notes: '<path d="M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3z"/><path d="M9.5 20h5"/>',
  media: '<path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5v13"/><path d="M15 9.5h2.5M15 12.5h2.5"/>',
  habits: '<path d="M4 18c3-7 6-9 8-9s3 2 3 4-1 3-2 3-2-1-1-3 3-5 8-7"/>',
  workboard: '<path d="M4 4h16v16H4zM9.5 4v16M14.5 4v16"/><path d="M6 7.5h2M11 7.5h2M16 7.5h2M6 10.5h2M16 10.5h2"/>',
  // 跟進對象：一個人＋名單橫線
  contacts: '<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5"/><path d="M16 6h5M16 9.5h5M18 13h3"/>',
  month: '<path d="M5 4h14v16H5z"/><path d="M8 4v16"/><path d="M11 8.5h5M11 12h5M11 15.5h3"/>',
  // 內在整理：一張摺角便籤＋一道起伏（情緒）
  reflect: '<path d="M5 4h14v10l-6 6H5z"/><path d="M13 20v-6h6"/><path d="M8 9.5c1.2-1.6 2.6-1.6 3.8 0s2.6 1.6 3.8 0"/>',
  quotes: '<path d="M5 6h14v12H5z"/><path d="M8.5 10.5c0-1 .7-1.7 1.6-1.7M8.5 10.5v2.2h2.1v-2.2H8.5zM13.4 10.5c0-1 .7-1.7 1.6-1.7M13.4 10.5v2.2h2.1v-2.2h-2.1z"/>',
  bucket: '<path d="M6 4h12v16l-6-4-6 4z"/><path d="m9.5 9.5 2 2 3.5-3.5"/>',
  // 標籤與分類：一張吊牌
  tags: '<path d="M4 4h7l9 9-7 7-9-9z"/><path d="M8 8h.01"/>',
  backup: '<path d="M8 4v13M4.5 13.5 8 17l3.5-3.5M16 20V7M12.5 10.5 16 7l3.5 3.5"/>',
  // 回饋：一個對話框泡泡＋三個點
  feedback: '<path d="M4 5h16v11H10l-4 4v-4H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  guide: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.5v.6M12 16.6h.01"/>',
};
// 沒有專屬圖示的頁面用一個小方格（其他模組新增路由時不會壞掉）
const icon = (id) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[id] || '<path d="M6 6h12v12H6z"/>'}</svg>`;

const ROUTES = [
  // group：側欄分組（今天要做的 → 計畫 → 回顧 → 收藏 → 設定 → 其他）
  // 20261107：任務管理不再顯示未完成數量（使用者覺得有壓力）；跟進對象暫放最下面的「其他」（使用者還在想怎麼管理），
  // 原本的「其他」（標籤、備份、說明）改叫「設定」。
  { id: 'overview', label: '總覽', mount: mountOverview, group: '今天' },
  { id: 'tasks', label: '任務管理', mount: mountTasks, group: '今天' },
  { id: 'workboard', label: '工作看板', mount: mountWorkBoard, group: '今天' },
  { id: 'projects', label: '專案與目標', mount: mountProjects, group: '計畫' },
  { id: 'calendar', label: '日曆', mount: mountCalendar, group: '計畫' },
  { id: 'month', label: '月度手帳', mount: mountMonth, group: '計畫' },
  { id: 'year', label: '年度手帳', mount: mountYear, group: '計畫' },
  { id: 'review', label: '每日復盤', mount: mountReview, group: '回顧' },
  { id: 'stats', label: '時間統計', mount: mountStats, group: '回顧' },
  { id: 'habits', label: '習慣養成', mount: mountHabits, group: '回顧' },
  { id: 'reflect', label: '內在整理', mount: mountReflect, group: '回顧' }, // 20261108 顯化規劃・階段三
  { id: 'inbox', label: '待看清單', mount: mountInbox, group: '收藏', badge: true },
  { id: 'notes', label: '靈感知識庫', mount: mountNotes, group: '收藏' },
  { id: 'media', label: '書影單', mount: mountMedia, group: '收藏' },
  { id: 'quotes', label: '佳句本', mount: mountQuotes, group: '收藏' }, // 20261112 來自回饋
  { id: 'bucket', label: '想做清單', mount: mountBucket, group: '收藏' },
  { id: 'tags', label: '標籤與分類', mount: mountTags, group: '設定' },
  { id: 'backup', label: '數據與備份', mount: mountBackup, group: '設定' },
  { id: 'guide', label: '使用說明', mount: mountGuide, group: '設定' },
  { id: 'contacts', label: '跟進對象', mount: mountContacts, group: '其他' },
  { id: 'feedback', label: '回饋', mount: mountFeedback, group: '其他', badge: true }, // 20261111（D）回饋匣
];

let unsubscribe = null;

// ===== 側欄分組收合（20261106 E）=====
// 分組依 ROUTES 的 group，照第一次出現的順序；同組的路由就算不相鄰也排在一起（其他模組新增路由不用管位置）。
// 收合狀態記在這台裝置（localStorage），目前所在頁的分組一律展開；進入收合中的分組時自動展開並記住。
const NAV_FOLD_KEY = 'lifeos-nav-folded';
let navFolded = new Set();
try { navFolded = new Set(JSON.parse(localStorage.getItem(NAV_FOLD_KEY) || '[]')); } catch { navFolded = new Set(); }
let currentGroup = null;
const saveFolded = () => { try { localStorage.setItem(NAV_FOLD_KEY, JSON.stringify([...navFolded])); } catch { /* 忽略 */ } };
const groupOf = (r) => r.group || '其他';

function renderNav() {
  const groups = new Map();
  for (const r of ROUTES) {
    if (!groups.has(groupOf(r))) groups.set(groupOf(r), []);
    groups.get(groupOf(r)).push(r);
  }
  $('#nav').innerHTML = [...groups].map(([g, routes], i) => `
    <div class="nav-sec" data-group="${esc(g)}">
      <button type="button" class="nav-group" aria-expanded="true" aria-controls="nav-g-${i}">
        <span>${esc(g)}</span><span class="nav-group-badge" hidden></span>
        <svg class="nav-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>
      </button>
      <div class="nav-items" id="nav-g-${i}"><div class="nav-items-in">${routes.map((r) => `
        <a href="#/${r.id}" data-route="${r.id}" title="${esc(r.label)}">
          <span class="ico">${icon(r.id)}</span><span class="nav-label">${esc(r.label)}</span>
          ${r.badge ? `<span class="badge" data-badge="${r.id}" hidden></span>` : ''}
        </a>`).join('')}</div></div>
    </div>`).join('');
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-group');
    if (!btn) return;
    const g = btn.closest('.nav-sec').dataset.group;
    if (navFolded.has(g)) navFolded.delete(g);
    else {
      navFolded.add(g);
      if (g === currentGroup) toast('這一組有目前的頁面，換到別組的頁面後就會收起');
    }
    saveFolded();
    syncNavFold();
  });
}

/** 依收合設定與目前頁面更新每一組的展開狀態 */
function syncNavFold() {
  document.querySelectorAll('#nav .nav-sec').forEach((sec) => {
    const folded = navFolded.has(sec.dataset.group) && sec.dataset.group !== currentGroup;
    if (sec.classList.contains('folded') !== folded) {
      // 動畫期間才裁切內容（平常不裁，目前頁書籤的缺角才不會被切掉）
      sec.classList.add('nav-anim');
      clearTimeout(sec._anim);
      sec._anim = setTimeout(() => sec.classList.remove('nav-anim'), 260);
    }
    sec.classList.toggle('folded', folded);
    const btn = $('.nav-group', sec);
    btn.setAttribute('aria-expanded', String(!folded));
    btn.title = `${folded ? '展開' : '收合'}「${sec.dataset.group}」`;
  });
}

/** 收件匣徽章：放超過 7 天還沒點開的筆數（inbox_items 不在 store，登入後、換頁、收件匣有變動時重算） */
function updateInboxBadge() {
  data.inboxStaleCount().then((n) => setNavBadge('inbox', n, `${n} 則放很久沒看`)).catch(() => {});
}
window.addEventListener('lifeos:inbox-changed', updateInboxBadge);

/** 回饋徽章（20261111 D）：預覽中（等使用者確認）的筆數；表還沒建立時不顯示 */
function updateFeedbackBadge() {
  data.feedbackPreviewCount().then((n) => setNavBadge('feedback', n, `${n} 則回饋的預覽版等你確認`)).catch(() => {});
}
window.addEventListener('lifeos:feedback-changed', updateFeedbackBadge);

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
  // 「#/頁面/參數」只取第一段當頁面（例如 #/month/2026-10），參數由該頁自己讀 location.hash
  const id = location.hash.replace('#/', '').split('/')[0] || 'overview';
  const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
  updateInboxBadge(); // 換頁時順便更新（例如在收件匣以外的地方點開過）
  updateFeedbackBadge();
  document.querySelectorAll('#nav a').forEach((a) => {
    a.toggleAttribute('aria-current', a.dataset.route === r.id);
  });
  // 目前頁面的分組一定展開；原本收合的就記成展開（使用者正在用這一組）
  currentGroup = groupOf(r);
  if (navFolded.delete(currentGroup)) saveFolded();
  syncNavFold();
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
  pageEnter(main); // 翻到新的一頁（motion.js；減少動態時不做）
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
        ${isLocalDevHost(location.hostname) ? '<p class="sub">只想先看介面：網址加上 <code>?mock=1</code> 使用本機模擬資料（不會同步；只在本機開發時有效）。</p>' : ''}
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
      <button type="button" class="link-btn forgot-link" id="forgot-btn">忘記密碼？</button>
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
      msg.textContent = authErrorText(e.message);
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(data.signIn, '登入'); };
  $('#signup-btn').onclick = () => submit(data.signUp, '註冊');
  $('#forgot-btn').onclick = () => openForgotPassword(form.email.value.trim());
}

/** Supabase 登入／註冊的英文錯誤轉成中文（開放給其他人用時，關閉註冊、未確認信箱最常見） */
function authErrorText(m = '') {
  const s = m.toLowerCase();
  if (s === 'invalid login credentials') return 'Email 或密碼錯誤';
  if (s.includes('signups not allowed') || s.includes('signup is disabled')) return '目前不開放自行註冊，請向管理者索取邀請。';
  if (s.includes('email not confirmed')) return 'Email 還沒確認，請到信箱點確認連結（找不到信請看垃圾郵件）。';
  if (s.includes('already registered')) return '這個 Email 已經註冊過，請直接登入或使用「忘記密碼？」。';
  if (s.includes('rate limit')) return '寄信次數太多，請稍後再試。';
  return m;
}

let loadedFor = null;
let leaving = false;
/**
 * 資安 20261111（C）：登出或登入狀態消失時整頁重新載入到乾淨的網址（去掉 #頁面，深層連結不留著），
 * 畫面、對話框、記憶體裡的資料一起清掉；只隱藏畫面的話，上一個人的內容還留在 DOM 裡。
 * 保留 ?mock=1 等查詢參數（模擬模式要靠它）。
 */
function reloadClean() {
  if (leaving) return;
  leaving = true;
  unsubscribe?.();
  reset();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  document.querySelectorAll('dialog').forEach((d) => { if (d.id !== 'confirm-dialog') d.innerHTML = ''; });
  $('#main').innerHTML = '';
  $('#user-email').textContent = '';
  $('#app').hidden = true;
  location.replace(`${location.pathname}${location.search}`);
}

async function showApp(session) {
  if (loadedFor === session.user.id || leaving) return;
  // 換成另一個帳號（例如在別的分頁登入）：先整頁清掉，不讓上一個人的畫面留著
  if (loadedFor) { reloadClean(); return; }
  const uid = session.user.id;
  loadedFor = uid;
  const stale = () => loadedFor !== uid || leaving; // 等待中已登出或換人：遲到的回應丟掉
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#user-email').textContent = session.user.email;
  $('#mock-flag').hidden = !isMock;
  $('#main').innerHTML = '<p class="sub">載入中…</p>';
  try {
    await loadAll();
    if (stale()) return;
    if (isMock) {
      const { seedDemoTasks } = await import('./dev/mock-supabase.js');
      await seedDemoTasks(supabase, state.areas);
      await refreshTasks();
    }
    if (stale()) return;
    route();
  } catch (e) {
    if (stale()) return;
    $('#main').innerHTML = `<section class="card"><p class="warn">讀取資料失敗：${esc(e.message)}</p>
      <p class="sub">請確認已在 Supabase 執行 supabase/schema.sql。</p></section>`;
  }
}

function handleSession(session) {
  if (session) showApp(session);
  else if (loadedFor) reloadClean(); // 登出、或登入狀態失效（token 過期、別的分頁登出）
  else {
    unsubscribe?.();
    reset();
    showAuth();
  }
}

renderNav();
syncNavFold();
subscribe(updateRunningBar);
watchStatNumbers($('#main'));
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
initAccount();
$('#feedback-btn').onclick = () => openFeedbackDialog(); // 20261111（D）：任何頁面都能寫回饋，自動帶上目前頁面

// 預覽版（site/preview/，docs/15）：整頁標上「預覽版」，避免和正式版搞混；登入畫面也看得到
if (isPreviewPath(location.pathname)) {
  document.documentElement.classList.add('is-preview');
  document.title = `【預覽版】${document.title}`;
  const rib = document.createElement('div');
  rib.className = 'preview-ribbon';
  rib.setAttribute('role', 'note');
  rib.textContent = '預覽版・資料和正式版是同一份';
  document.body.append(rib);
}
$('#signout-btn').onclick = async () => {
  try {
    await data.signOut();
    reloadClean(); // 通常 SIGNED_OUT 事件已經觸發過；這裡再保險一次（leaving 旗標防重複）
  } catch (e) { toast(e.message, true); }
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
  data.onAuthChange((session, event) => { handleSession(session); watchRecovery(session, event); });
  const session = await data.getSession();
  handleSession(session);
  watchRecovery(session, 'INITIAL_SESSION');
}
