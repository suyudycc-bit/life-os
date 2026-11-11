// 回饋匣 20261111（D）：任何頁面都能寫建議（側欄底部「回饋」按鈕），#/feedback 看全部回饋與 Claude 的回覆。
// 資料在 feedback 表（不在 store，這頁自己讀）；新增、修改、刪除、計數都在 data.js「回饋匣」段落。
// 沒有程式會自動讀回饋：使用者說「處理回饋」時，Claude 依 docs/15-feedback-workflow.md 處理。
import * as data from '../data.js';
import { $, esc, toast, confirmDialog, linkify, formatDateTime } from '../ui.js';

const FILTER_KEY = 'lifeos-feedback-tab';
const changed = () => window.dispatchEvent(new CustomEvent('lifeos:feedback-changed'));

/** 路由 hash → 頁面名稱（讀側欄選單的文字，不必另外維護一份清單） */
export function feedbackPageLabel(page) {
  const id = String(page || '').replace(/^#\//, '').split(/[/?]/)[0] || 'overview';
  const a = document.querySelector(`#nav a[data-route="${CSS.escape(id)}"] .nav-label`);
  return a ? a.textContent.trim() : (page || '（不明）');
}

let dlgEl = null;
let pageListener = null;
function dialogEl() {
  if (!dlgEl) {
    dlgEl = document.createElement('dialog');
    dlgEl.id = 'feedback-dialog';
    dlgEl.className = 'fb-dialog';
    document.body.append(dlgEl);
  }
  return dlgEl;
}

/** 寫回饋／修改回饋。新增時頁面＝目前的路由；修改時沿用原本的頁面 */
export function openFeedbackDialog(item = null, onSaved = null) {
  const dlg = dialogEl();
  const page = item ? item.page : (location.hash || '#/overview');
  let kind = item?.kind || 'idea';
  dlg.innerHTML = `
    <form>
      <h2>${item ? '修改回饋' : '寫回饋'}</h2>
      <p class="fb-page">頁面：<b>${esc(feedbackPageLabel(page))}</b></p>
      <div class="fb-kinds" role="group" aria-label="類型">${Object.entries(data.FEEDBACK_KINDS).map(([k, v]) =>
        `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${v}</button>`).join('')}</div>
      <label>想說的話<textarea name="body" rows="6" maxlength="${data.FEEDBACK_MAX}" required
        placeholder="哪裡不好用、想要什麼功能、看不懂的地方都可以寫；有截圖可以貼雲端網址">${esc(item?.body || '')}</textarea></label>
      <p class="sub fb-note">寫完不會馬上有人看：下次你在 Claude Code 說「處理回饋」時才會一起處理。</p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">${item ? '儲存' : '送出'}</button>
      </div>
    </form>`;
  const f = $('form', dlg);
  $('.fb-kinds', dlg).addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    kind = b.dataset.kind;
    dlg.querySelectorAll('[data-kind]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await data.saveFeedback({ id: item?.id, body: f.body.value, kind, page });
      dlg.close();
      changed();
      toast(item ? '已更新' : '已收到，下次處理回饋時會看到');
      onSaved?.();
    } catch (err) { toast(err.message, true); }
  };
  dlg.showModal();
  f.body.focus();
}

export function mountFeedback(root) {
  let tab = 'new';
  try { tab = localStorage.getItem(FILTER_KEY) || 'new'; } catch { /* 忽略 */ }
  if (!data.FEEDBACK_STATUS[tab]) tab = 'new';
  let items = [];
  let error = '';
  let loaded = false;

  root.innerHTML = `
    <header class="page-head fb-head">
      <div><h1>回饋</h1><p class="sub">邊用邊寫下建議；說「處理回饋」時 Claude 才會讀，修好後先寄預覽網址給你確認，回覆 OK 才更新正式版。</p></div>
      <button type="button" class="btn-primary" id="fb-new">寫回饋</button>
    </header>
    <section class="card fb-pagecard">
      <div class="seg fb-tabs" id="fb-tabs" role="group" aria-label="依狀態"></div>
      <ul class="fb-list" id="fb-list"></ul>
    </section>`;

  $('#fb-new', root).onclick = () => openFeedbackDialog(null, () => { tab = 'new'; persist(); load(); });
  $('#fb-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { tab = b.dataset.v; persist(); render(); }
  });
  $('#fb-list', root).addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const it = items.find((x) => x.id === b.closest('[data-id]').dataset.id);
    if (!it) return;
    if (b.dataset.act === 'edit') openFeedbackDialog(it, load);
    if (b.dataset.act === 'del') {
      if (!(await confirmDialog('刪除這則回饋？會先放進垃圾桶，30 天內可在「數據與備份」還原。'))) return;
      try { await data.deleteFeedback(it.id); changed(); await load(); toast('已移到垃圾桶'); } catch (err) { toast(err.message, true); }
    }
  });

  function persist() { try { localStorage.setItem(FILTER_KEY, tab); } catch { /* 忽略 */ } }

  async function load() {
    try { items = await data.listFeedback(); error = ''; } catch (err) { items = []; error = err.message; }
    loaded = true;
    render();
  }

  function render() {
    if (!root.isConnected) return;
    const counts = data.feedbackCounts(items);
    $('#fb-tabs', root).innerHTML = Object.entries(data.FEEDBACK_STATUS).map(([k, v]) =>
      `<button type="button" data-v="${k}" aria-pressed="${k === tab}">${v}${counts[k] ? ` <small>${counts[k]}</small>` : ''}</button>`).join('');
    const list = $('#fb-list', root);
    if (!loaded) { list.innerHTML = '<li class="empty">讀取中…</li>'; return; }
    if (error) { list.innerHTML = `<li class="empty warn">${esc(error)}</li>`; return; }
    const rows = items.filter((x) => x.status === tab);
    if (!rows.length) {
      list.innerHTML = `<li class="empty">${tab === 'new' ? '還沒有新的回饋。任何頁面左下角都有「回饋」按鈕。' : `沒有「${data.FEEDBACK_STATUS[tab]}」的回饋。`}</li>`;
      return;
    }
    list.innerHTML = rows.map((it) => `
      <li class="fb-item" data-id="${it.id}" data-status="${it.status}">
        <div class="fb-meta">
          <span class="fb-kind" data-kind="${esc(it.kind)}">${esc(data.FEEDBACK_KINDS[it.kind] || it.kind)}</span>
          <span>${esc(feedbackPageLabel(it.page))}</span>
          <span>${esc(formatDateTime(it.created_at))}</span>
          <span class="fb-status">${esc(data.FEEDBACK_STATUS[it.status] || it.status)}</span>
        </div>
        <p class="fb-body">${linkify(it.body)}</p>
        ${it.reply ? `<div class="fb-reply"><b>Claude 的回覆</b><p>${linkify(it.reply)}</p></div>` : ''}
        ${it.status === 'preview' ? '<p class="fb-wait">預覽版已寄到你的信箱：看過後回信「OK」，或寫下要改的地方。</p>' : ''}
        ${it.status === 'new' ? `<div class="fb-acts">
          <button type="button" class="btn-ghost" data-act="edit">修改</button>
          <button type="button" class="btn-ghost danger" data-act="del">刪除</button></div>` : ''}
      </li>`).join('');
  }

  // 側欄「回饋」對話框送出時重讀；只留最新一次進頁的監聽（舊的換頁後就移除）
  if (pageListener) window.removeEventListener('lifeos:feedback-changed', pageListener);
  pageListener = () => { if (root.querySelector('#fb-list')) load(); };
  window.addEventListener('lifeos:feedback-changed', pageListener);
  load();
  return render;
}
