// M1 總覽（Phase 1：今日完成率、今日待辦數、最重要 3 件事、今日待辦清單）
import * as data from '../data.js';
import { state } from '../store.js';
import { $, durationHTML, toast, esc, areaChip } from '../ui.js';
import { refreshNotes, refreshTasks, refreshProjects } from '../store.js';
import { habitRowHTML, bindHabitDays } from './habits.js';
import { openNoteDialog } from './notes.js';
import { openExternalEvent, extTime } from './google-sync.js';
import { today, formatShort, localDate } from '../dates.js';
import { taskItemHTML } from './task-item.js';
import { bindTaskList, openTaskEditor } from './task-actions.js';
import { coverHTML, bindCoverFallback, saveMediaFilter } from './media.js';
import { saveInboxFilter } from './inbox.js';
import { QUOTES, quoteIndexOf, quoteCite, quoteText } from '../quotes.js';

// 「第一次使用？」提示：這台裝置第一次打開（整個頁面載入期間都算），或還沒有任何任務時顯示；
// 按 ✕ 後不再出現（記在這台裝置的瀏覽器）。在模組層讀一次，避免總覽重掛載時把「第一次」吃掉。
const GUIDE_TIP_KEY = 'lifeos-guide-tip';
let tipState = null;
try { tipState = localStorage.getItem(GUIDE_TIP_KEY); } catch { /* 忽略 */ }
const firstVisit = tipState == null;
const INTENT_SAVE_DELAY = 800; // 今日身分／肯定語：停止輸入多久後自動儲存（毫秒），同每日復盤

export function mountOverview(root) {
  root.innerHTML = `
    <header class="page-head">
      <h1>今天，也好好生活。</h1>
      <p class="sub" id="ov-date"></p>
    </header>
    <figure class="ov-quote" id="ov-quote" aria-labelledby="ov-quote-label">
      <figcaption class="ovq-label" id="ov-quote-label">每日一句</figcaption>
      <blockquote class="ovq-text" lang="en" id="ov-quote-text"></blockquote>
      <p class="ovq-cite" id="ov-quote-cite"></p>
      <p class="ovq-zh" id="ov-quote-zh"></p>
      <div class="ovq-actions">
        <button type="button" class="btn-ghost" id="ov-quote-next">換一句</button>
        <button type="button" class="btn-ghost" id="ov-quote-copy">複製</button>
      </div>
    </figure>
    <section class="card ov-intent" aria-labelledby="ov-intent-title">
      <div class="day-head"><h2 id="ov-intent-title">今天的我</h2><span class="sub" id="ov-intent-save" role="status"></span></div>
      <div class="ovi-grid">
        <form class="ovi-form" id="ov-intent-form" autocomplete="off">
          <label class="ovi-row"><span class="ovi-k">今日身分</span>
            <input name="identity" maxlength="200" placeholder="今天我是……" aria-describedby="ovi-hint"></label>
          <p class="ovi-hint sub" id="ovi-hint"></p>
          <label class="ovi-row"><span class="ovi-k">肯定語</span>
            <input name="affirmation" maxlength="200" placeholder="對自己說一句肯定的話"></label>
        </form>
        <div class="ovi-main">
          <h3 class="ovi-k">身分主線任務</h3>
          <ul class="ovi-steps" id="ov-mainline"></ul>
          <p class="sub ovi-note" id="ov-mainline-note"></p>
        </div>
      </div>
    </section>
    <aside class="guide-tip" id="ov-guide-tip" hidden>
      <span>第一次使用？<a href="#/guide">看使用說明</a>，跟著走一遍「建任務 → 計時 → 完成 → 看統計與復盤」。</span>
      <button type="button" class="btn-ghost" id="ov-guide-close" aria-label="關閉使用說明提示">✕</button>
    </aside>
    <a class="ov-inbox" id="ov-inbox" href="#/inbox" hidden></a>
    <section class="stats">
      <div class="card stat">
        <div class="stat-label">今日任務完成率</div>
        <div class="stat-num" id="ov-rate">—</div>
        <div class="stat-note" id="ov-rate-note"></div>
      </div>
      <div class="card stat">
        <div class="stat-label">今日待辦</div>
        <div class="stat-num" id="ov-todo">0<small>件</small></div>
        <div class="stat-note">今天到期或排程、尚未完成</div>
      </div>
      <div class="card stat">
        <div class="stat-label">今日用時</div>
        <div class="stat-num" id="ov-time">0s</div>
        <div class="stat-note" id="ov-time-note"></div>
      </div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>今日最重要的 3 件事</h2>
        <ul class="task-list compact" id="ov-top3"></ul>
      </section>
      <section class="card">
        <h2>今日待辦</h2>
        <ul class="ext-list" id="ov-ext"></ul>
        <ul class="task-list compact" id="ov-list"></ul>
      </section>
    </div>
    <section class="card ov-projects">
      <div class="day-head"><h2>各領域專案的下一步</h2><a class="sub" href="#/projects">專案與目標 ›</a></div>
      <div id="ov-projects"></div>
    </section>
    <section class="card ov-media" id="ov-media" hidden>
      <div class="day-head"><h2>正在讀／看</h2><a class="sub" href="#/media" data-media-doing>書影單 ›</a></div>
      <ul class="ovm-list" id="ov-media-list"></ul>
    </section>
    <section class="card ov-follow" id="ov-follow" hidden>
      <div class="day-head"><h2 id="ov-follow-title">今天該跟進</h2><a class="sub" href="#/contacts">跟進對象 ›</a></div>
      <ul class="ovf-list" id="ov-follow-list"></ul>
    </section>
    <div class="grid-2 ov-row2">
      <section class="card">
        <div class="day-head"><h2>近 7 天習慣打卡</h2><a class="sub" href="#/habits">管理習慣 ›</a></div>
        <ul class="habit-list" id="ov-habits"></ul>
      </section>
      <section class="card">
        <div class="day-head"><h2>快速記錄靈感</h2><a class="sub" href="#/notes">靈感知識庫 ›</a></div>
        <form id="ov-note" class="ov-note">
          <input name="title" placeholder="一句話記下想法（標題）" aria-label="靈感標題" required maxlength="120">
          <textarea name="body" rows="3" placeholder="補充內容（選填）" aria-label="靈感內容"></textarea>
          <div class="dialog-actions">
            <button type="button" class="btn-ghost" id="ov-note-more">更多欄位…</button>
            <button class="btn-primary">記錄</button>
          </div>
        </form>
      </section>
    </div>`;
  if (firstVisit) { try { localStorage.setItem(GUIDE_TIP_KEY, 'seen'); } catch { /* 忽略 */ } }
  $('#ov-guide-close', root).onclick = () => {
    tipState = 'dismissed';
    try { localStorage.setItem(GUIDE_TIP_KEY, 'dismissed'); } catch { /* 忽略 */ }
    $('#ov-guide-tip', root).hidden = true;
  };
  // 每日一句：依台北日期選；「換一句」只是當下瀏覽（不存資料），重新整理或過了午夜回到當天那句
  let quoteDay = null;
  let quoteIdx = 0;
  function showQuote() {
    const q = QUOTES[quoteIdx];
    $('#ov-quote-text', root).textContent = q.text;
    $('#ov-quote-cite', root).textContent = `— ${quoteCite(q)}${q.tr ? `｜${q.tr}` : ''}`;
    $('#ov-quote-zh', root).textContent = q.zh;
  }
  $('#ov-quote-next', root).onclick = () => {
    quoteIdx = (quoteIdx + 1 + Math.floor(Math.random() * (QUOTES.length - 1))) % QUOTES.length;
    showQuote();
  };
  $('#ov-quote-copy', root).onclick = async () => {
    const text = quoteText(QUOTES[quoteIdx]);
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製這一句');
    } catch {
      // 沒有剪貼簿權限（例如非 https）時，退回選取文字複製
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.append(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      toast(ok ? '已複製這一句' : '無法複製，請手動選取文字', !ok);
    }
  };
  // ===== 顯化規劃・今天的我（20261108）：今日身分、肯定語存在當天的 daily_reviews（只寫這兩欄）=====
  const intentForm = $('#ov-intent-form', root);
  const intentSave = $('#ov-intent-save', root);
  const hintEl = $('#ovi-hint', root);
  let intentDay = null;      // 目前顯示的是哪一天
  let intentDirtyDay = null; // 有沒存的輸入時，是哪一天的
  const intentDirty = new Set();
  let intentTimer = null;
  let intentSeq = 0;
  let intentLoading = null;
  let vision = null;         // 今年 period_reviews.vision_identity（年度手帳寫的終點身分）
  let visionYear = null;
  const nowHM = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  async function flushIntent() {
    clearTimeout(intentTimer);
    if (!intentDirtyDay || !intentDirty.size) return;
    const day = intentDirtyDay;
    const keys = [...intentDirty];
    intentDirtyDay = null;
    intentDirty.clear();
    const values = Object.fromEntries(keys.map((k) => [k, intentForm.elements[k].value]));
    try {
      await data.saveReview(day, values);
      if (day === intentDay) intentSave.textContent = `已自動儲存 ${nowHM()}`;
    } catch (e) {
      if (!intentDirtyDay) intentDirtyDay = day;
      keys.forEach((k) => intentDirty.add(k));
      intentSave.textContent = `儲存失敗：${e.message}（會再試一次）`;
      intentTimer = setTimeout(flushIntent, 3000);
    }
  }
  function renderHint() {
    const empty = !intentForm.elements.identity.value.trim();
    intentForm.elements.identity.placeholder = vision ? vision : '今天我是……';
    if (!empty) { hintEl.hidden = true; return; }
    hintEl.hidden = false;
    hintEl.innerHTML = vision
      ? `淡色字是你在年度手帳寫的終點身分。<button type="button" class="btn-ghost" id="ovi-use">帶入</button>`
      : '還沒有年度的終點身分，可到<a href="#/year">年度手帳</a>寫下你想成為的人。';
  }
  hintEl.addEventListener('click', (e) => {
    if (!e.target.closest('#ovi-use') || !vision) return;
    const input = intentForm.elements.identity;
    input.value = vision;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushIntent();
    input.focus();
  });
  intentForm.addEventListener('input', (e) => {
    if (!e.target.name) return;
    intentDirtyDay = intentDay || today();
    intentDirty.add(e.target.name);
    intentSave.textContent = '編輯中…';
    if (e.target.name === 'identity') renderHint();
    clearTimeout(intentTimer);
    intentTimer = setTimeout(flushIntent, INTENT_SAVE_DELAY);
  });
  intentForm.addEventListener('focusout', () => flushIntent());
  intentForm.addEventListener('submit', (e) => { e.preventDefault(); flushIntent(); });
  /** 換日（或第一次）時讀當天那筆；正在輸入的不蓋掉 */
  async function loadIntent(day) {
    await flushIntent(); // 換日前先把前一天沒存的存好
    const seq = ++intentSeq;
    const year = day.slice(0, 4);
    const [review, pr] = await Promise.all([
      data.getReview(day).catch(() => null),
      visionYear === year ? Promise.resolve(undefined) : data.getPeriodReview(year).catch(() => null),
    ]);
    if (seq !== intentSeq || !intentForm.isConnected) return;
    if (pr !== undefined) { vision = pr?.vision_identity?.trim() || null; visionYear = year; }
    const changed = intentDay !== day;
    intentDay = day;
    if (changed || (!intentDirty.size && !intentForm.contains(document.activeElement))) {
      for (const k of data.REVIEW_INTENT_KEYS) intentForm.elements[k].value = review?.[k] || '';
      intentSave.textContent = '';
    }
    renderHint();
  }
  // 身分主線任務：勾選＝和專案卡片同一套（任務 → setTaskDone；手寫的下一步 → 清空），下一件自動遞補
  const mainUl = $('#ov-mainline', root);
  mainUl.addEventListener('change', async (e) => {
    const box = e.target.closest('.ovi-done');
    if (!box) return;
    const p = state.projects.find((x) => x.id === box.dataset.project);
    if (!p) return;
    box.disabled = true;
    try {
      if (box.dataset.task) {
        await data.setTaskDone(box.dataset.task, true, state.running);
        await refreshTasks();
      } else {
        await data.saveProject({ ...p, next_action: '' });
        await refreshProjects();
      }
      const next = data.nextStepOf(state.projects.find((x) => x.id === p.id) || p, state.tasks);
      toast(next ? `完成！下一步：${next.kind === 'task' ? next.task.title : next.text}` : '下一步完成了！這個專案沒有待辦了');
    } catch (err) {
      box.checked = false;
      box.disabled = false;
      toast(err.message, true);
    }
  });
  mainUl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit-task]');
    const t = b && state.tasks.find((x) => x.id === b.dataset.editTask);
    if (t) openTaskEditor(t);
  });
  function renderMainline() {
    const m = data.mainlineSteps(state);
    mainUl.innerHTML = m.items.length ? m.items.map(({ project: p, goals, step }) => {
      const meta = `${areaChip(state.areasById[p.area_id])}<span>${esc(p.name)}</span>${goals.map((g) => `<span class="ovi-goal">◆ ${esc(g.title)}</span>`).join('')}`;
      if (!step) return `<li class="ovi-step empty"><span class="sub">這個專案還沒有下一步，<a href="#/projects">到專案與目標新增</a>。</span><div class="task-meta">${meta}</div></li>`;
      const title = step.kind === 'task' ? step.task.title : step.text;
      return `<li class="ovi-step">
        <input type="checkbox" class="ovi-done" data-project="${p.id}" ${step.kind === 'task' ? `data-task="${step.task.id}"` : ''} aria-label="完成：${esc(title)}">
        <div class="ovi-body">${step.kind === 'task'
          ? `<button type="button" class="ovi-title" data-edit-task="${step.task.id}" title="編輯任務">${esc(title)}</button>`
          : `<a class="ovi-title" href="#/projects" title="專案的手寫下一步（到專案與目標編輯）">${esc(title)}</a>`}
          <div class="task-meta">${meta}</div></div></li>`;
    }).join('') : `<li class="empty">${m.mode === 'mainline' ? '主線目標還沒有掛到進行中的專案。' : '還沒有進行中的生活專案。'}</li>`;
    const notes = [];
    if (m.mode === 'fallback') notes.push('還沒有勾選身分主線，先列生活專案的下一步；可到<a href="#/year">年度手帳</a>把目標勾成主線。');
    if (m.unlinked.length) notes.push(`主線目標 ${m.unlinked.map((g) => `「${esc(g.title)}」`).join('')}還沒有掛專案，<a href="#/projects">到專案與目標指定</a>後就會列出它的下一步。`);
    $('#ov-mainline-note', root).innerHTML = notes.join('<br>');
  }

  bindTaskList($('#ov-top3', root));
  bindTaskList($('#ov-list', root));
  bindHabitDays($('#ov-habits', root));
  // 今天的 Google 會議（唯讀）；還沒設定同步或沒執行 migration 時就不顯示
  let todayExt = [];
  data.listExternalEvents(today(), today()).then((evs) => {
    todayExt = data.externalByDay(evs, today(), today())[today()] || [];
    renderExt();
  }).catch(() => {});
  function renderExt() {
    const ul = $('#ov-ext', root);
    if (!ul) return;
    ul.innerHTML = todayExt.map((e) => `
      <li><button type="button" data-ext="${e.id}"><span class="ext-dot" aria-hidden="true"></span>
        <span class="ext-time">${e.all_day ? '全天' : extTime(e.starts_at)}</span>
        <span class="ext-title">${esc(e.title)}</span><span class="sub">Google 會議</span></button></li>`).join('');
  }
  $('#ov-ext', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-ext]');
    const ev = b && todayExt.find((x) => x.id === b.dataset.ext);
    if (ev) openExternalEvent(ev);
  });
  // 書影單「進行中」的前幾筆（Phase J）；沒有就整塊不顯示，讀取失敗（例如還沒執行 migration）也不顯示
  bindCoverFallback($('#ov-media', root));
  data.listMedia().then((items) => {
    const doing = items.filter((m) => m.status === 'doing').slice(0, 6);
    const sec = $('#ov-media', root);
    if (!sec || !doing.length) return;
    $('#ov-media-list', root).innerHTML = doing.map((m) => `
      <li><a href="#/media" data-media-doing>${coverHTML(m, 'sm')}
        <span class="ovm-t">${esc(m.title)}</span><span class="sub">${esc(data.MEDIA_KINDS[m.kind])}</span></a></li>`).join('');
    sec.hidden = false;
  }).catch(() => {});
  // 點了進書影單的「進行中」頁籤（篩選記在 localStorage，類型改回全部）
  $('#ov-media', root).addEventListener('click', (e) => {
    if (e.target.closest('[data-media-doing]')) saveMediaFilter({ status: 'doing', kind: '' });
  });
  // 今天該跟進（跟進對象，20261106）：沒有人或讀取失敗（例如還沒執行 migration）就整塊不顯示；不在這裡建立預設階段
  Promise.all([data.listContactStages(), data.listContacts()]).then(([stages, contacts]) => {
    const follow = data.contactsToFollow(contacts, stages, today());
    const sec = $('#ov-follow', root);
    if (!sec || !follow.length) return;
    const byId = Object.fromEntries(stages.map((s) => [s.id, s]));
    $('#ov-follow-title', root).textContent = `今天該跟進：${follow.length} 人`;
    $('#ov-follow-list', root).innerHTML = follow.slice(0, 5).map((f) => `
      <li class="ovf-${f.reason}"><a href="#/contacts"><b>${esc(f.contact.name)}</b><span class="sub">${esc(data.contactFollowReason(f, byId))}</span></a></li>`).join('')
      + (follow.length > 5 ? `<li class="sub">還有 ${follow.length - 5} 人</li>` : '');
    sec.hidden = false;
  }).catch(() => {});
  // 收件匣提醒（20261106）：放超過 7 天還沒點開的；0 則不顯示，讀取失敗（例如還沒執行 migration）也不顯示
  data.listInbox().then((items) => {
    const n = data.staleInbox(items).length;
    const a = $('#ov-inbox', root);
    if (!a || !n) return;
    a.innerHTML = `<span class="ov-inbox-mark" aria-hidden="true">${n}</span><span>待看清單：${n} 則放超過 ${data.INBOX_STALE_DAYS} 天還沒看</span><span class="sub">去看看 ›</span>`;
    a.hidden = false;
  }).catch(() => {});
  $('#ov-inbox', root).addEventListener('click', () => saveInboxFilter({ tab: 'unread', source: '', cat: '' }));
  const noteForm = $('#ov-note', root);
  noteForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await data.saveNote({ title: noteForm.title.value, body: noteForm.body.value });
      noteForm.reset();
      await refreshNotes();
      toast('已記錄到靈感知識庫');
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('#ov-note-more', root).onclick = () => {
    openNoteDialog(null, { title: noteForm.title.value, body: noteForm.body.value });
    noteForm.reset();
  };

  return function render() {
    const day = today();
    if (quoteDay !== day) { quoteDay = day; quoteIdx = quoteIndexOf(day); showQuote(); }
    if (intentDay !== day && intentLoading !== day) { intentLoading = day; loadIntent(day).finally(() => { intentLoading = null; }); }
    renderMainline();
    $('#ov-guide-tip', root).hidden = tipState === 'dismissed' || !(firstVisit || state.tasks.length === 0);
    // 生活的總覽：不含工作看板的工作（工作只留在工作看板）
    const { todo, top3 } = data.todayOverview(state.life.tasks, day);
    const s = state.summary;
    $('#ov-date', root).textContent = `${formatShort(day)}（台北時間）`;
    $('#ov-rate', root).innerHTML = s.completion_pct == null ? '—' : `${s.completion_pct}<small>%</small>`;
    $('#ov-rate-note', root).textContent = s.tasks_total
      ? `今日 ${s.tasks_total} 件中完成 ${s.tasks_done} 件`
      : '今天還沒有排定的任務';
    $('#ov-todo', root).innerHTML = `${todo.length}<small>件</small>`;
    const ts = data.timeStats(state.life.entries, state.life.tasks, day);
    const live = state.running && localDate(state.running.started_at) === day && !state.areasById[state.running.area_id]?.on_board ? state.running.started_at : null;
    $('#ov-time', root).innerHTML = durationHTML(ts.todaySec, live);
    $('#ov-time-note', root).textContent = live ? '含進行中的計時（即時）' : '今天的計時加總';
    $('#ov-top3', root).innerHTML = top3.length
      ? top3.map((t) => taskItemHTML(t, state.areasById, { actions: false, memos: state.memosByTask[t.id], running: state.running })).join('')
      : '<li class="empty">在任務上點 ☆ 星標，最重要的事就會出現在這裡。</li>';
    $('#ov-list', root).innerHTML = todo.length
      ? todo.map((t) => taskItemHTML(t, state.areasById, { actions: false, memos: state.memosByTask[t.id], running: state.running })).join('')
      : '<li class="empty">今天沒有待辦了，到「任務管理」新增或安排一件事吧。</li>';
    const groups = data.activeProjectsByArea(state.life.projects, state.life.areas);
    $('#ov-projects', root).innerHTML = groups.length ? `<div class="ovp-grid">${groups.map((g) => `
      <div class="ovp-area">${areaChip(g.area)}
        <ul>${g.projects.map((p) => {
          const pr = data.progressOf(state.tasks, 'project_id', p.id);
          const step = data.nextStepOf(p, state.tasks);
          return `<li><b>${esc(p.name)}</b>${pr.total ? ` <span class="sub">${pr.pct}%</span>` : ''}
            <div class="${step ? '' : 'sub'}">→ ${step ? esc(step.kind === 'task' ? step.task.title : step.text) : '還沒有下一步'}</div></li>`;
        }).join('')}</ul></div>`).join('')}</div>`
      : '<p class="sub">還沒有進行中的專案。到「專案與目標」新增，例如轉職、BD 案件、接案專案。</p>';
    const hs = data.habitStats(state.habits.filter((h) => !h.archived), state.habitLogs, day);
    $('#ov-habits', root).innerHTML = hs.length ? hs.map((x) => habitRowHTML(x, { compact: true })).join('')
      : '<li class="empty">還沒有習慣。到「習慣養成」新增一個吧。</li>';

  };
}
