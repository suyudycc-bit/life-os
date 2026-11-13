// 工作看板（Phase W2）：手帳風五欄，內容就是「工作」領域的任務（單一來源，見 docs/08）
// 欄位由任務狀態與日期算出（data.boardColumnOf）；拖到別欄＝改狀態或排程。
// 舊的 Apps Script 看板保留為「舊看板」切換（嵌入），等 W6 確認不用再拿掉。
import * as config from '../config.js';
import * as data from '../data.js';
import { state, refreshTasks, refreshAreas } from '../store.js';
import { $, esc, toast, linkChip, safeHref, linkFallbackTitle, pastedLink, confirmDialog } from '../ui.js';
import { today, formatShort, formatHMS } from '../dates.js';
import { openTaskEditor, openMemoDialog, startTimer, workTagsOf, resolveWorkTags, openContinueDialog, askSameCase } from './task-actions.js';
import { openAreaDialog } from './area-dialog.js';
import { mountCases, openPhrases } from './cases.js';

const BOARD_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(config.WORK_BOARD_URL || '')
  ? config.WORK_BOARD_URL : '';
const MODE_KEY = 'lifeos-wb-mode';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const dow = (d) => new Date(`${d}T12:00:00+08:00`).getUTCDay();

/** 列入設定：勾選哪些領域的任務要出現在工作看板（存在 areas.on_board，換裝置也一樣） */
export function openBoardSettings() {
  const dlg = $('#board-dialog');
  const render = () => {
    dlg.innerHTML = `
      <form>
        <h2>工作看板要列入哪些領域</h2>
        <p class="sub">勾選的領域算「工作」：任務只出現在工作看板，不會出現在任務管理、總覽等生活頁面。可以隨時改，任務本身不會變。</p>
        <ul class="wb-area-list">${state.areas.map((a) => `
          <li><label class="check"><input type="checkbox" name="area" value="${a.id}" ${a.on_board ? 'checked' : ''}>
            <span class="chip" style="--c:${esc(a.color || '#888')}"><i></i>${esc(a.name)}</span></label></li>`).join('')}</ul>
        <button type="button" class="btn-ghost" data-new>＋ 新增領域</button>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const form = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    $('[data-new]', dlg).onclick = async () => {
      dlg.close();
      const created = await openAreaDialog(state.areas, { onBoard: true });
      if (created) { await refreshAreas(); toast(`已新增領域「${created.name}」`); }
      openBoardSettings();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const ids = [...form.querySelectorAll('input[name=area]:checked')].map((i) => i.value);
      try {
        const n = await data.setBoardAreas(state.areas, ids);
        dlg.close();
        await refreshAreas();
        toast(n ? '已更新看板的列入領域' : '沒有變更');
      } catch (err) { toast(err.message, true); }
    };
  };
  render();
  dlg.showModal();
}

/**
 * 每日工作回報（同舊看板的「複製表格」格式，貼到 Teams／信件）。
 * 舊看板要先手動把今天沒做完的工作列入後續才能複製；Life OS 沒做完的工作本來就會留到下一個工作日，
 * 所以回報的「明天預計」自動包含今天新接、進行中但還沒完成的工作。
 */
export function dailyReport(day = today()) {
  const cols = data.boardColumns(state.tasks, state.areasById, day);
  const report = {
    new: cols.new, inprogress: cols.inprogress, done: cols.done,
    tomorrow: [...cols.new, ...cols.inprogress, ...cols.tomorrow],
    backlog: cols.backlog,
  };
  const note = (t) => (state.memosByTask[t.id] || [])[0]?.body || '';
  const link = (t) => (t.links || []).map(safeHref).find(Boolean) || ''; // 資安 20261111：只取 http(s)
  const td = 'vertical-align:top;padding:6px 8px;border:1px solid #000;background:#ffffff;';
  const head = (c) => `<td style="background:#ffffff;color:#C00000;text-align:center;font-weight:bold;padding:6px;border:1px solid #000;">${esc(c.label)}</td>`;
  const cell = (t) => {
    if (!t) return '';
    const title = link(t) ? `<a href="${esc(link(t))}" style="color:#1155cc;text-decoration:underline;">${esc(t.title)}</a>` : esc(t.title);
    const n = note(t);
    return title + (n ? `<div style="margin-top:5px;padding-top:5px;border-top:1px solid #d9dde5;color:#475467;font-size:11px;line-height:1.5;"><strong style="color:#1F3864;">備註：</strong>${esc(n).replace(/\n/g, '<br>')}</div>` : '');
  };
  const today3 = data.BOARD_COLUMNS.filter((c) => c.group === 'today');
  const next2 = data.BOARD_COLUMNS.filter((c) => c.group === 'next');
  const order = [...today3, ...next2];
  const rows = Math.max(1, ...order.map((c) => report[c.id].length));
  const bar = 'background:#1F3864;color:#fff;text-align:center;font-weight:bold;padding:8px;border:1px solid #000;';
  let html = `<table style="border-collapse:collapse;width:900px;background:#ffffff;font-family:'Microsoft JhengHei',sans-serif;font-size:13px;">`
    + `<tr><td colspan="${today3.length}" style="${bar}">本日工作</td><td colspan="${next2.length}" style="${bar}">後續工作</td></tr>`
    + `<tr>${order.map(head).join('')}</tr>`;
  for (let r = 0; r < rows; r++) html += `<tr>${order.map((c) => `<td style="${td}">${cell(report[c.id][r])}</td>`).join('')}</tr>`;
  html += '</table>';
  const text = order.map((c) => `【${c.label}】\n${report[c.id].map((t) => `・${t.title}${link(t) ? `　${link(t)}` : ''}${note(t) ? `\n　備註：${note(t).replace(/\n/g, '／')}` : ''}`).join('\n') || '（空）'}`).join('\n\n');
  return { html, text, count: Object.values(cols).reduce((n, c) => n + c.length, 0) };
}

/** 用「選取＋複製」複製（不需要剪貼簿權限；舊看板也是這樣做） */
function copyBySelection(html) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff;';
  holder.innerHTML = html;
  document.body.appendChild(holder);
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNode(holder);
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges();
  holder.remove();
  return ok;
}

async function copyReport(day = today(), { quiet = false } = {}) {
  const { html, text, count } = dailyReport(day);
  if (!count) { toast('今天的看板是空的，沒有可複製的回報', true); return; }
  const done = () => { if (!quiet) toast('已複製每日工作回報（含連結與進度備註），可直接貼到 Teams'); };
  try {
    // 同時放表格（貼到 Teams／Outlook 是表格）與純文字（貼到 LINE 等是文字）
    await navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }),
    })]);
    done();
    return;
  } catch { /* 沒有剪貼簿權限時改用選取複製 */ }
  if (copyBySelection(html)) { done(); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast('已複製純文字版本（這個瀏覽器不支援複製表格，連結以網址呈現）');
  } catch {
    toast('複製失敗，請換一個瀏覽器再試', true);
  }
}

function legacyHTML() {
  return BOARD_URL ? `
    <div class="wb-frame">
      <iframe src="${esc(BOARD_URL)}" title="舊的每日工作報告看板" loading="lazy" allow="clipboard-read; clipboard-write" referrerpolicy="no-referrer"></iframe>
    </div>
    <p class="sub wb-hint">這是舊的 Apps Script 看板（搬家期間保留）。看不到時按右上角「舊看板 ↗」在新分頁開啟。</p>`
    : '<section class="card empty-page"><p>沒有設定舊看板網址（config.js 的 WORK_BOARD_URL）。</p></section>';
}

export function mountWorkBoard(root) {
  let mode = 'board';
  try {
    const saved = localStorage.getItem(MODE_KEY);
    mode = saved === 'cases' ? 'cases' : saved === 'legacy' && BOARD_URL ? 'legacy' : 'board';
  } catch { /* 忽略 */ }
  let casesRender = null;

  root.innerHTML = `
    <header class="page-head cal-head">
      <div><h1>工作看板</h1><p class="sub" id="wb-date"></p></div>
      <div class="cal-tools">
        <div class="seg" role="group" aria-label="切換看板">
          <button type="button" data-mode="board">看板</button>
          <button type="button" data-mode="cases">案件總覽</button>
          ${BOARD_URL ? '<button type="button" data-mode="legacy">舊看板</button>' : ''}
        </div>
        <button type="button" class="btn-primary" id="wb-copy">複製每日工作回報</button>
        <button type="button" class="btn-timer" id="wb-phrases">常用詞組</button>
        <button type="button" class="btn-timer" id="wb-settings">列入設定</button>
        ${BOARD_URL ? `<a class="btn-timer" href="${esc(BOARD_URL)}" target="_blank" rel="noopener">舊看板 ↗</a>` : ''}
      </div>
    </header>
    <div id="wb-body"></div>`;

  const body = $('#wb-body', root);
  $('#wb-settings', root).onclick = () => openBoardSettings();
  $('#wb-copy', root).onclick = () => copyReport();
  $('#wb-phrases', root).onclick = () => openPhrases();
  $('.seg', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* 忽略 */ }
    paint(true);
  });

  // ===== 拖曳換欄（滑鼠／觸控，移動超過 6px 才算拖；沒移動就是點擊）=====
  let drag = null;
  let suppressClick = false;
  const colAt = (x, y) => document.elementFromPoint(x, y)?.closest('.wb-col');
  body.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.wb-card');
    // 標題（點一下編輯）也可以拖；只有底下的操作按鈕、連結不能當拖曳起點
    if (!card || e.button > 0 || e.target.closest('.wb-actions button, .wb-cont, a, input, select, textarea')) return;
    drag = { card, x: e.clientX, y: e.clientY, active: false, pointerId: e.pointerId };
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      drag.active = true;
      drag.card.setPointerCapture(drag.pointerId);
      drag.card.classList.add('dragging');
      body.classList.add('is-dragging');
    }
    e.preventDefault();
    drag.card.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px) rotate(1.5deg)`;
    const col = colAt(e.clientX, e.clientY);
    body.querySelectorAll('.drop-on').forEach((c) => c !== col && c.classList.remove('drop-on'));
    body.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    // 放開時就用拖曳過程中標示的那一欄，不在放開後重新找位置（卡片歸位會改變指標下的元素）
    drag.target = col && col.dataset.col !== drag.card.dataset.col ? col.dataset.col : null;
    if (drag.target) col.classList.add('drop-on');
    // 20261113（回饋 b5f99f2a）：同一欄裡上下拖＝調整順序（「已完成」依完成時間排，不能調）
    drag.reorder = null;
    if (col && col.dataset.col === drag.card.dataset.col && col.dataset.col !== 'done') {
      const others = [...col.querySelectorAll('.wb-card')].filter((c) => c !== drag.card);
      const next = others.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      const prev = next ? others[others.indexOf(next) - 1] : others.at(-1);
      drag.reorder = { nextId: next?.dataset.id || null, prevId: prev?.dataset.id || null };
      if (next) next.classList.add('drop-before'); else if (prev) prev.classList.add('drop-after');
    }
  });
  const endDrag = async (e) => {
    if (!drag) return;
    const { card, active, target, reorder } = drag;
    drag = null;
    if (!active) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    card.style.transform = '';
    card.classList.remove('dragging');
    body.classList.remove('is-dragging');
    body.querySelectorAll('.drop-on').forEach((c) => c.classList.remove('drop-on'));
    body.querySelectorAll('.drop-before, .drop-after').forEach((c) => c.classList.remove('drop-before', 'drop-after'));
    if (e.type !== 'pointerup') return;
    if (target) await moveTo(card.dataset.id, target);
    else if (reorder) await reorderCard(card.dataset.id, reorder.nextId, reorder.prevId);
  };

  // 同一欄調順序（20261113 回饋 a2fb4008 修正）：放開就先在畫面上換位置，再只寫這一欄的 sort_order（data.reorderColumn）
  async function reorderCard(id, nextId, prevId) {
    const card = body.querySelector(`.wb-card[data-id="${id}"]`);
    const col = card?.closest('.wb-col');
    if (!card || !col) return;
    const next = nextId && col.querySelector(`.wb-card[data-id="${nextId}"]`);
    const prev = prevId && col.querySelector(`.wb-card[data-id="${prevId}"]`);
    if (next) next.before(card); else if (prev) prev.after(card); else return;
    const ids = [...col.querySelectorAll('.wb-card')].map((c) => c.dataset.id);
    try {
      const n = await data.reorderColumn(ids, Object.fromEntries(state.tasks.map((t) => [t.id, t])));
      await refreshTasks();
      if (n) toast('已調整順序');
    } catch (err) {
      toast(err.message, true);
      await refreshTasks(); // 寫入失敗：重畫回資料庫裡的順序
    }
  }
  body.addEventListener('pointerup', endDrag);
  body.addEventListener('pointercancel', endDrag);
  body.addEventListener('click', (e) => {
    if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  async function moveTo(taskId, toCol) {
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    const label = data.BOARD_COLUMNS.find((c) => c.id === toCol).label;
    try {
      if (toCol === 'done') await data.setTaskDone(t.id, true, state.running);
      else await data.updateTask(t.id, data.boardMovePatch(t, toCol, today()));
      await refreshTasks();
      toast(`已移到「${label}」`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // 卡片上的按鈕
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) {
      // 20261113（回饋 deaa6ba0）：點卡片任何空白處都能編輯（原本只有標題文字那一小塊可以點）
      const card = e.target.closest('.wb-card');
      if (!card || e.target.closest('a, button, input, select, textarea, label')) return;
      const t = state.tasks.find((x) => x.id === card.dataset.id);
      if (t) openTaskEditor(t);
      return;
    }
    const t = state.tasks.find((x) => x.id === b.closest('.wb-card')?.dataset.id);
    if (!t) return;
    if (b.dataset.act === 'edit') openTaskEditor(t);
    if (b.dataset.act === 'memo') openMemoDialog(t.id);
    if (b.dataset.act === 'timer') {
      if (state.running?.task_id === t.id) {
        try { await data.stopTimer(state.running); await refreshTasks(); toast('已暫停，用時已記錄'); } catch (err) { toast(err.message, true); }
      } else startTimer(t);
    }
    if (b.dataset.act === 'done') await moveTo(t.id, 'done');
    if (b.dataset.act === 'continue') openContinueDialog(t); // 20261111：今日歸今日，接續到明天／累積未完成
    if (b.dataset.act === 'delete') await deleteCard(t);
  });

  // 20261106 W4：卡片可刪除（進垃圾桶，30 天內可在「數據與備份」還原）
  async function deleteCard(t) {
    if (state.running?.task_id === t.id) { toast('這件工作正在計時，請先暫停再刪除', true); return; }
    if (!(await confirmDialog(`刪除「${t.case_no ? `${t.case_no} ` : ''}${t.title}」？會移到垃圾桶，30 天內可在「數據與備份」還原。`))) return;
    try {
      await data.deleteTask(t.id);
      await refreshTasks();
      toast('已移到垃圾桶，可在「數據與備份」還原');
    } catch (err) { toast(err.message, true); }
  }

  // 手機（卡片不能拖，避免擋住左右滑動）：用「移到…」選單換欄
  body.addEventListener('change', async (e) => {
    if (!e.target.matches('.wb-move') || !e.target.value) return;
    const card = e.target.closest('.wb-card');
    if (e.target.value === 'up' || e.target.value === 'down') { // 20261113：手機也能調順序
      const up = e.target.value === 'up';
      e.target.value = '';
      const cards = [...card.closest('.wb-col').querySelectorAll('.wb-card')];
      const other = cards[cards.indexOf(card) + (up ? -1 : 1)];
      if (!other) return;
      if (up) await reorderCard(card.dataset.id, other.dataset.id, null); // 放到上一張前面
      else await reorderCard(card.dataset.id, null, other.dataset.id);   // 放到下一張後面
      return;
    }
    await moveTo(card.dataset.id, e.target.value);
  });

  // 鍵盤也能換欄：卡片聚焦時按左右鍵
  body.addEventListener('keydown', async (e) => {
    const card = e.target.closest?.('.wb-card');
    if (!card || e.target !== card) return;
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && card.dataset.col !== 'done') {
      // 上下鍵：在同一欄裡往上／往下移一格
      e.preventDefault();
      const cards = [...card.closest('.wb-col').querySelectorAll('.wb-card')];
      const i = cards.indexOf(card);
      const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
      if (j < 0 || j >= cards.length) return;
      const id = card.dataset.id;
      const rest = cards.filter((c) => c !== card);
      const next = e.key === 'ArrowUp' ? cards[j] : rest[j];
      const prev = e.key === 'ArrowUp' ? rest[j - 1] : cards[j];
      await reorderCard(id, next?.dataset.id || null, prev?.dataset.id || null);
      body.querySelector(`.wb-card[data-id="${id}"]`)?.focus();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const ids = data.BOARD_COLUMNS.map((c) => c.id);
    const to = ids[ids.indexOf(card.dataset.col) + (e.key === 'ArrowRight' ? 1 : -1)];
    if (!to) return;
    const id = card.dataset.id;
    await moveTo(id, to);
    body.querySelector(`.wb-card[data-id="${id}"]`)?.focus();
  });

  // 在工作名稱或連結欄貼上網址：網址放「連結」欄；帶超連結文字的拆成名稱，
  // 只貼純網址且名稱還空著時，向 link-title 服務讀網頁標題（20261107；讀不到用網域＋路徑當暫時名稱）
  const addForm = () => body.querySelector('.wb-add');
  async function fillTitleFrom(url) {
    const f = addForm();
    if (!f || f.title.value.trim()) return;
    f.title.placeholder = '讀取標題中…';
    f.dataset.titleFor = url;
    const { title, reason } = await data.fetchLinkTitle(url);
    const g = addForm(); // 期間可能重畫過，重新找
    if (!g) return;
    if (g.dataset.titleFor === url) { delete g.dataset.titleFor; g.title.placeholder = '新接一件工作…'; }
    // 使用者在等待時已自己輸入名稱、或換了別的網址，就不覆蓋
    if (g.title.value.trim() || g.link.value.trim() !== url) return;
    g.title.value = title || linkFallbackTitle(url);
    toast(title ? '已帶入網頁標題，可再修改' : `讀不到網頁標題（${reason}），先用網址當名稱，可再修改`, !title);
  }
  body.addEventListener('paste', (e) => {
    if (!e.target.matches('.wb-add input[name=title], .wb-add input[name=link]')) return;
    const got = pastedLink(e.clipboardData);
    if (!got) return;
    e.preventDefault();
    const f = e.target.form;
    if (got.text) f.title.value = `${f.title.value} ${got.text}`.trim();
    f.link.value = got.url; // 連結欄是單行，新的取代舊的
    if (e.target.name === 'title' && f.title.value.trim()) toast(got.text ? '已把連結拆到「連結」欄' : '已把網址放進「連結」欄');
    if (!f.title.value.trim()) fillTitleFrom(got.url);
  });

  // 在「新接」新增工作（自動給案件編號）
  body.addEventListener('submit', async (e) => {
    if (!e.target.matches('.wb-add')) return;
    e.preventDefault();
    const f = e.target;
    const areas = data.boardAreas(state.areas);
    const area = areas.find((a) => a.id === f.area_id?.value) || areas[0];
    if (!area) { toast('請先在「列入設定」選擇要列入的領域', true); return; }
    let links = [];
    try { links = data.parseLinks(f.link.value); } catch (err) { toast(err.message, true); return; }
    try {
      // 工作種類、專案標籤可選既有的或直接打新名稱（存檔時找同名或建立；專案標籤不建立 projects 的專案）
      // 20261111：同連結＝自動沿用既有案號；同標題＝問是不是同一個案件；都不是就給下一個編號
      const match = data.findSameCase(state.tasks, { title: f.title.value, links }, state.areasById);
      let case_no = null;
      if (match?.reason === 'link') case_no = match.case_no;
      if (match?.reason === 'title') {
        const ans = await askSameCase(match);
        if (!ans) return; // 取消：不新增，表單內容保留
        if (ans === 'same') case_no = match.case_no;
      }
      const tags = await resolveWorkTags({ type: f.work_type.value, project: f.work_project_tag.value });
      const created = await data.createWorkTask({
        title: f.title.value, area_id: area.id, ...tags, due_date: f.due_date.value || null, links, case_no,
      }, state.tasks);
      f.reset(); // 重畫會保留表單內容，送出成功後先清空
      delete f.dataset.titleFor;
      f.title.placeholder = '新接一件工作…';
      await refreshTasks();
      toast(case_no ? `已新增工作，沿用案件 ${created.case_no}${match.reason === 'link' ? '（相同連結）' : '（同一個案件）'}` : '已新增工作');
      body.querySelector('.wb-add input[name=title]')?.focus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  function cardHTML(t, col, day) {
    const tag = state.workTags.find((w) => w.id === t.work_type_id);
    const ptag = state.workTags.find((w) => w.id === t.work_project_tag_id);
    const project = state.projects.find((p) => p.id === t.project_id); // 舊資料掛的 projects 專案照樣顯示
    const due = data.taskDay(t);
    const late = due && due < day && t.status !== 'done';
    const memo = (state.memosByTask[t.id] || [])[0];
    const links = (t.links || []).filter((u) => /^https?:\/\//i.test(u));
    const timing = state.running?.task_id === t.id;
    const memoCount = (state.memosByTask[t.id] || []).length;
    return `
      <article class="wb-card ${timing ? 'timing' : ''} ${t.status === 'done' ? 'is-done' : ''}" data-id="${t.id}" data-col="${col}" tabindex="0"
        aria-label="${esc(t.title)}，按左右鍵換欄、上下鍵調順序">
        <div class="wb-card-head">
          <span class="wb-case">${esc(t.case_no || '—')}</span>
          ${due && due !== day ? `<span class="wb-due ${late ? 'late' : ''}">${late ? '已過期 ' : '預定 '}${formatShort(due)}</span>` : ''}
          ${t.starred ? '<span class="wb-star" title="星標">★</span>' : ''}
          ${col === 'new' || col === 'inprogress' ? '<button type="button" class="btn-ghost wb-cont" data-act="continue" title="今天這張標完成，接續到明天或累積未完成（同案號）" aria-label="接續到明天或累積未完成">⇢ 接續</button>' : ''}
          <button type="button" class="btn-ghost wb-edit" data-act="edit" title="編輯工作（名稱、連結、種類、日期…）" aria-label="編輯工作">✎</button>
        </div>
        <button type="button" class="wb-title" data-act="edit" title="編輯工作">${esc(t.title)}</button>
        ${tag || ptag || project ? `<div class="wb-tags">
          ${tag ? `<span class="chip" style="--c:${esc(tag.color)}" title="工作種類"><i></i>${esc(tag.label)}</span>` : ''}
          ${ptag ? `<span class="wb-ptag" title="專案標籤">#${esc(ptag.label)}</span>` : ''}
          ${project ? `<span class="wb-project" title="專案">📁 ${esc(project.name)}</span>` : ''}</div>` : ''}
        ${memo ? `<p class="wb-memo" title="最新進度"><b>進度</b>${esc(memo.body)}</p>` : ''}
        ${links.length ? `<div class="wb-links">${links.map((u) => linkChip(u)).join('')}</div>` : ''}
        <div class="wb-actions">
          ${t.status !== 'done' ? `<button type="button" class="btn-timer ${timing ? 'on' : ''}" data-act="timer">${timing ? `⏸ <span class="clock" data-since="${state.running.started_at}"></span>` : '▶ 計時'}</button>` : ''}
          ${t.actual_sec ? `<span class="wb-spent" title="累計用時">${formatHMS(t.actual_sec)}</span>` : ''}
          <span class="wb-gap"></span>
          <button type="button" class="btn-ghost btn-memo" data-act="memo" title="進度紀錄">進度${memoCount ? `<span class="count">${memoCount}</span>` : ''}</button>
          ${t.status !== 'done' ? '<button type="button" class="btn-ghost" data-act="done" title="標成完成">✓</button>' : ''}
          <button type="button" class="btn-ghost wb-del" data-act="delete" title="刪除工作（移到垃圾桶）" aria-label="刪除工作">✕</button>
        </div>
        <select class="wb-move" aria-label="移到其他欄">
          <option value="">移到…</option>
          ${col !== 'done' ? '<option value="up">↑ 往上移</option><option value="down">↓ 往下移</option>' : ''}
          ${data.BOARD_COLUMNS.filter((c) => c.id !== col).map((c) => `<option value="${c.id}">${c.label}</option>`).join('')}
        </select>
      </article>`;
  }

  function addFormHTML() {
    const areas = data.boardAreas(state.areas);
    const options = (kind) => workTagsOf(kind).map((w) => `<option value="${esc(w.label)}"></option>`).join('');
    return `
      <form class="wb-add">
        <input name="title" placeholder="新接一件工作…" aria-label="工作內容" required maxlength="300">
        ${areas.length > 1 ? `<select name="area_id" aria-label="領域">${areas.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>` : ''}
        <div class="wb-add-row">
          <input name="work_type" list="wb-dl-type" placeholder="工作種類" aria-label="工作種類（可選或輸入新的）" maxlength="40" autocomplete="off">
          <input name="work_project_tag" list="wb-dl-ptag" placeholder="專案標籤" aria-label="專案標籤（可選或輸入新的）" maxlength="40" autocomplete="off">
          <datalist id="wb-dl-type">${options('type')}</datalist>
          <datalist id="wb-dl-ptag">${options('project')}</datalist>
        </div>
        <label class="wb-add-due">預定處理日<input type="date" name="due_date"></label>
        <div class="wb-add-row"><input name="link" placeholder="連結（選填）" aria-label="連結"><button class="btn-primary">新增</button></div>
      </form>`;
  }

  function paint(force = false) {
    root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    const day = today();
    $('#wb-date', root).textContent = `${formatShort(day)}（週${WEEKDAYS[dow(day)]}）・明天預計＝${formatShort(data.nextWorkingDay(day))}（週${WEEKDAYS[dow(data.nextWorkingDay(day))]}）`;
    if (mode === 'cases') {
      // 案件總覽：第一次畫整頁，之後只更新清單（搜尋框不會失去焦點）
      if (force || !casesRender || !body.querySelector('.cs-filters')) casesRender = mountCases(body);
      else casesRender();
      return;
    }
    casesRender = null;
    if (mode === 'legacy') {
      // 舊看板只畫一次，資料更新時不重載 iframe（打到一半的字才不會消失）
      if (force || !body.querySelector('.wb-frame')) body.innerHTML = legacyHTML();
      return;
    }
    if (!data.boardAreas(state.areas).length) {
      body.innerHTML = `<section class="card empty-page">
        <p>工作看板還沒有列入任何領域。選擇哪些領域的任務要放上來（例如 Libo），之後隨時可以在右上角「列入設定」改。</p>
        <div class="dialog-actions bk-actions"><button class="btn-primary" id="wb-pick-area">選擇列入的領域</button></div></section>`;
      $('#wb-pick-area', body).onclick = () => openBoardSettings();
      return;
    }
    // 正在輸入新工作時不要整頁重畫
    const typing = body.querySelector('.wb-add input[name=title]');
    const draft = typing && typing === document.activeElement ? typing.value : null;
    const oldForm = body.querySelector('.wb-add');
    const keep = oldForm ? { link: oldForm.link.value, titleFor: oldForm.dataset.titleFor, title: oldForm.title.value } : null;
    const cols = data.boardColumns(state.tasks, state.areasById, day);
    const group = (g, title) => `
      <section class="wb-group wb-${g}">
        <h2 class="wb-group-title">${title}</h2>
        <div class="wb-cols">${data.BOARD_COLUMNS.filter((c) => c.group === g).map((c) => `
          <div class="wb-col" data-col="${c.id}">
            <header class="wb-col-head"><h3>${c.label}</h3><span class="wb-count">${cols[c.id].length}</span></header>
            <p class="wb-hint-line">${c.hint}</p>
            ${c.id === 'new' ? addFormHTML() : ''}
            <div class="wb-cards">${cols[c.id].map((t) => cardHTML(t, c.id, day)).join('') || '<p class="wb-empty">（空）</p>'}</div>
          </div>`).join('')}</div>
      </section>`;
    body.innerHTML = `<div class="wb-board">${group('today', '本日工作')}${group('next', '後續工作')}</div>
      <p class="sub wb-hint">拖曳卡片換欄、在同一欄上下拖調順序（也可點卡片後按左右鍵換欄、上下鍵調順序）：拖到「明天預計」會排到 ${formatShort(data.nextWorkingDay(day))}，拖到「累積未完成」會清除日期。點卡片或右上 ✎ 可編輯，「進度」記錄每天做到哪裡；今天沒做完、明天要接著做的按「⇢ 接續」（今天這張算完成，另建同案號的新卡）。</p>`;
    // 重畫時保留還沒送出的連結與名稱（貼網址後正在讀標題時也不會中斷）
    const form = body.querySelector('.wb-add');
    if (form && keep) {
      form.link.value = keep.link;
      if (draft == null && keep.title) form.title.value = keep.title;
      if (keep.titleFor) { form.dataset.titleFor = keep.titleFor; form.title.placeholder = '讀取標題中…'; }
    }
    if (draft != null) {
      const input = body.querySelector('.wb-add input[name=title]');
      input.value = draft;
      input.focus();
    }
  }

  return () => paint();
}
