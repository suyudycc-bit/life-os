// 收件匣（20261106 使用回饋 S1–S3）：從手機分享進來、想研究卻還沒打開看的連結與文字。
// 資料在 inbox_items（不在 store，這頁自己讀）；來源判斷、拆網址、「放很久」都在 data.js。
// 從 iPhone 分享進來：iOS「捷徑」打開 #/inbox/share?text=<URL 編碼的分享內容>（安裝說明見 docs/12-ios-share-shortcut.md）。
import * as data from '../data.js';
import { state, refreshNotes, refreshTasks } from '../store.js';
import { $, esc, toast, confirmDialog, linkLabel } from '../ui.js';

const FILTER_KEY = 'lifeos-inbox-filter';
const PENDING_KEY = 'lifeos-inbox-share'; // 未登入時先記住分享（sessionStorage），登入後繼續
const TABS = { unread: '未看', opened: '已點開', done: '已處理' };
// 來源圖示：手帳上的小圓章（不用各平台的商標）
const SOURCE_MARK = { threads: '@', instagram: 'IG', xiaohongshu: '紅', youtube: '▶', facebook: 'f', web: '網', other: '記' };

/** 頁面篩選記在這台裝置；總覽的提醒點進來時先設成「未看」 */
export function saveInboxFilter(f) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* 忽略 */ }
}
function loadFilter() {
  try { return { tab: 'unread', source: '', cat: '', ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}') }; } catch { return { tab: 'unread', source: '', cat: '' }; }
}

/** 解析 #/inbox/share?text=…&url=…&title=…（用 decodeURIComponent，網址裡的「+」保留原樣） */
function shareFromHash() {
  const h = location.hash;
  if (!/^#\/inbox\/share(\?|$)/.test(h)) return null;
  const out = {};
  for (const part of (h.split('?')[1] || '').split('&')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i);
    if (!['text', 'url', 'title'].includes(k)) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1)); } catch { out[k] = part.slice(i + 1); }
  }
  return out.text || out.url || out.title ? out : {};
}

/** 把網址上的分享參數記下來並清掉（避免重新整理又存一次）；記不住（例如私密瀏覽擋 storage）就保留網址 */
function captureShare() {
  const s = shareFromHash();
  if (!s) return;
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(s));
    history.replaceState(null, '', `${location.pathname}${location.search}#/inbox`);
  } catch { /* 留在網址上，進頁時直接讀 */ }
}
function takePending() {
  const fromHash = shareFromHash();
  if (fromHash) return fromHash;
  try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
}
function clearPending() {
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* 忽略 */ }
  if (shareFromHash()) history.replaceState(null, '', `${location.pathname}${location.search}#/inbox`);
}
// 模組載入時（還沒登入也會執行）就先記住，登入後 route() 進到 #/inbox 再接著存
captureShare();
window.addEventListener('hashchange', captureShare); // 停在登入畫面時又分享一次（app.js 未登入不會換頁）

/** 有變動時通知（側欄徽章可以聽這個事件重算） */
const changed = () => window.dispatchEvent(new CustomEvent('lifeos:inbox-changed'));

let inboxDialog = null;
function dialogEl() {
  if (!inboxDialog) {
    inboxDialog = document.createElement('dialog');
    inboxDialog.id = 'inbox-dialog';
    inboxDialog.className = 'ib-dialog';
    document.body.append(inboxDialog);
  }
  return inboxDialog;
}

export function mountInbox(root) {
  const ui = loadFilter();
  let items = [];
  let loaded = false;
  captureShare();

  root.innerHTML = `
    <header class="page-head ib-head">
      <div><h1>收件匣</h1><p class="sub" id="ib-count">讀取中…</p></div>
      <button type="button" class="btn-ghost ib-help-btn" id="ib-help">如何從手機分享進來</button>
    </header>
    <section class="card ib-page">
      <form id="ib-add" class="ib-add">
        <textarea name="text" rows="2" placeholder="貼上網址或分享的文字（標題＋網址混在一起也可以）" aria-label="網址或文字" required maxlength="4000"></textarea>
        <div class="ib-add-row">
          <input name="category" list="ib-cats" placeholder="分類（可自己打）" aria-label="分類" maxlength="30">
          <button class="btn-primary">存入</button>
        </div>
      </form>
      <datalist id="ib-cats"></datalist>
      <div class="filters ib-filters">
        <div class="seg" id="ib-tabs" role="group" aria-label="依狀態"></div>
      </div>
      <div class="ib-chips" id="ib-sources" role="group" aria-label="依來源篩選"></div>
      <div class="ib-chips" id="ib-catf" role="group" aria-label="依分類篩選"></div>
      <ul class="ib-list" id="ib-list"></ul>
    </section>`;

  const form = $('#ib-add', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { url, body } = data.inboxSplitShared(form.text.value);
    try {
      const dup = data.inboxFindUrl(items, url);
      await data.saveInboxItem({ url, body, category: form.category.value });
      form.text.value = '';
      await load();
      toast(dup ? '已存入（這個連結之前也存過一次）' : '已存入收件匣');
    } catch (err) { toast(err.message, true); }
  });
  // 在輸入框按 Enter 直接存（Shift+Enter 換行）
  form.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  $('#ib-help', root).onclick = openHelp;

  $('#ib-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { ui.tab = b.dataset.v; persist(); render(); }
  });
  $('#ib-sources', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { ui.source = b.dataset.v; persist(); render(); }
  });
  $('#ib-catf', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { ui.cat = b.dataset.v; persist(); render(); }
  });
  const persist = () => saveInboxFilter({ tab: ui.tab, source: ui.source, cat: ui.cat });

  $('#ib-list', root).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-id]');
    const it = li && items.find((x) => x.id === li.dataset.id);
    if (!it) return;
    // 點開連結：讓瀏覽器照常在新分頁開，同時記下第一次點開的時間
    if (e.target.closest('a.ib-open')) {
      if (!it.opened_at) {
        data.markInboxOpened(it).then(() => { changed(); return load(); }).catch((err) => toast(err.message, true));
      }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'done' || act === 'undone') {
        await data.setInboxDone(it.id, act === 'done');
        changed();
        await load();
        toast(act === 'done' ? '已標成處理完' : '已改回未處理');
      }
      if (act === 'edit') openItemDialog(it);
      if (act === 'note') await toNote(it);
      if (act === 'task') openTaskDialog(it);
      if (act === 'delete') {
        if (!(await confirmDialog(`把「${labelOf(it)}」移到垃圾桶？30 天內可在「數據與備份」還原。`))) return;
        await data.deleteInboxItem(it.id);
        changed();
        await load();
        toast('已移到垃圾桶');
      }
    } catch (err) { toast(err.message, true); }
  });

  const labelOf = (it) => (it.title || it.body || linkLabel(it.url || '') || '（空白）').slice(0, 40);

  /** 新增（分享進來）或編輯的對話框 */
  function openItemDialog(it, { share = null } = {}) {
    const dlg = dialogEl();
    const isShare = !!share;
    let pre = it || {};
    if (isShare) {
      // 捷徑只傳 text（網址和文字混在一起）；也接受分開的 url／title
      const split = data.inboxSplitShared(share.text || '');
      pre = { url: share.url || split.url, title: share.title || '', body: share.url ? share.text || '' : split.body };
    }
    const dup = isShare ? data.inboxFindUrl(items, pre.url) : null;
    const cats = data.inboxCategories(items);
    dlg.innerHTML = `
      <form>
        <h2>${isShare ? '存到收件匣' : '編輯'}</h2>
        ${dup ? `<p class="ib-dup">這個連結${data.inboxAgeDays(dup) ? ` ${data.inboxAgeDays(dup)} 天前` : '今天'}已經存過（${TABS[data.inboxTabOf(dup)]}）。再存一次會多一筆。</p>` : ''}
        <label>網址<input name="url" type="url" inputmode="url" maxlength="2000" value="${esc(pre.url || '')}" placeholder="https://…"></label>
        <p class="ib-src-line">來源：<b id="ib-src">${esc(data.INBOX_SOURCES[pre.url ? data.inboxSourceOf(pre.url) : 'other'])}</b><span class="sub">（從網址自動判斷）</span></p>
        <label>標題<input name="title" maxlength="200" value="${esc(pre.title || '')}" placeholder="選填，例如：理財書單整理"></label>
        <label>內容<textarea name="body" rows="4" maxlength="4000">${esc(pre.body || '')}</textarea></label>
        <label>分類<input name="category" list="ib-dlg-cats" maxlength="30" value="${esc(pre.category || '')}" placeholder="可自己打，例如：學習、投資"></label>
        <datalist id="ib-dlg-cats">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        ${cats.length ? `<div class="ib-cat-picks" aria-label="常用分類">${cats.slice(0, 8).map((c) =>
          `<button type="button" class="tag-btn" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-cancel>${isShare ? '不存了' : '取消'}</button>
          <button class="btn-primary">${isShare ? '存到收件匣' : '儲存'}</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    f.url.addEventListener('input', () => {
      const u = f.url.value.trim();
      $('#ib-src', dlg).textContent = data.INBOX_SOURCES[/^https?:\/\//.test(u) ? data.inboxSourceOf(u) : 'other'];
    });
    $('.ib-cat-picks', dlg)?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (b) { f.category.value = b.dataset.cat; f.category.focus(); }
    });
    $('[data-cancel]', dlg).onclick = () => {
      if (isShare) clearPending();
      dlg.close();
    };
    dlg.oncancel = () => { if (isShare) clearPending(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        // 改了網址就重新判斷來源（saveInboxItem 沒給 source 時會自己判斷）
        await data.saveInboxItem({ id: it?.id, url: fd.get('url'), title: fd.get('title'), body: fd.get('body'), category: fd.get('category') });
        if (isShare) clearPending();
        dlg.close();
        changed();
        if (isShare) { ui.tab = 'unread'; persist(); }
        await load();
        toast(isShare ? '已存到收件匣' : '已更新');
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
    (isShare ? f.category : f.title).focus();
  }

  /** 轉成靈感：標題／內容／網址帶入，轉完標成已處理 */
  async function toNote(it) {
    const title = (it.title || (it.body || '').split('\n')[0] || (it.url ? linkLabel(it.url) : '')).slice(0, 120);
    const body = [it.body && it.body !== title ? it.body : '', it.url || ''].filter(Boolean).join('\n\n');
    const tags = ['收件匣', it.category].filter(Boolean).join(',');
    await data.saveNote({ title, body, area_id: it.area_id, tags });
    await data.setInboxDone(it.id, true);
    changed();
    await Promise.all([refreshNotes(), load()]);
    toast('已轉成靈感，並標成處理完');
  }

  /** 轉成任務：要選領域；網址放進任務的相關連結 */
  function openTaskDialog(it) {
    const dlg = dialogEl();
    const title = (it.title || (it.body || '').split('\n')[0] || (it.url ? `看：${linkLabel(it.url)}` : '')).slice(0, 120);
    dlg.innerHTML = `
      <form>
        <h2>轉成任務</h2>
        <label>任務名稱<input name="title" required maxlength="200" value="${esc(title)}"></label>
        <label>領域<select name="area_id" required>
          <option value="">請選擇領域</option>
          ${state.areas.map((a) => `<option value="${a.id}" ${a.id === it.area_id ? 'selected' : ''}>${esc(a.name)}${a.on_board ? '（工作看板）' : ''}</option>`).join('')}
        </select></label>
        <label>到期日<input type="date" name="due_date"></label>
        ${it.url ? `<p class="sub">連結會放進任務的「相關連結」：${esc(linkLabel(it.url))}</p>` : ''}
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">建立任務</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.oncancel = null;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await data.createTask({ title: fd.get('title'), area_id: fd.get('area_id'), due_date: fd.get('due_date') || null,
          notes: it.body && it.body !== fd.get('title') ? it.body : null, links: it.url ? [it.url] : [] }, state.tasks);
        await data.setInboxDone(it.id, true);
        dlg.close();
        changed();
        await Promise.all([refreshTasks(), load()]);
        const onBoard = state.areasById[fd.get('area_id')]?.on_board;
        toast(`已建立任務（${onBoard ? '在工作看板' : '在任務管理'}），並標成處理完`);
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
  }

  function openHelp() {
    const dlg = dialogEl();
    const share = `${location.origin}${location.pathname}#/inbox/share?text=`;
    dlg.innerHTML = `
      <div class="ib-help">
        <h2>如何從手機分享進來</h2>
        <p>iPhone 的 Safari 不能把網頁設成分享對象，所以用內建的「捷徑」App 做一個「存到 Life OS」，之後在 Threads、小紅書、IG 按分享就能選它。</p>
        <ol>
          <li>打開「捷徑」App，按右上角 ＋ 新增捷徑，命名「存到 Life OS」。</li>
          <li>在捷徑的詳細資訊（ⓘ）打開「在分享表單中顯示」（Show in Share Sheet），接收類型只留「URL」和「文字」。</li>
          <li>加入「URL 編碼」（URL Encode）動作，對象選「捷徑輸入」（Shortcut Input）。</li>
          <li>加入「文字」（Text）動作，內容填下面這串，最後接上藍色變數「URL 編碼文字」（URL Encoded Text）：<code class="ib-code">${esc(share)}</code></li>
          <li>加入「打開 URL」（Open URLs）動作，對象選上一步的「文字」。不需要 Get Headers／Get Contents of URL。</li>
        </ol>
        <p class="sub">之後在 App 裡按「分享」→ 找到「存到 Life OS」→ 會打開 Life OS 並跳出「存到收件匣」，選分類後按存。還沒登入的話，登入後會接著跳出來。動作名稱以你手機上顯示的為準（完整步驟見 docs/12-ios-share-shortcut.md）。</p>
        <p class="sub">Threads、IG、小紅書的網頁不允許其他網站讀取內容，所以不會自動抓標題或縮圖，以分享時帶進來的文字為準。</p>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-copy>複製網址開頭</button>
          <button type="button" class="btn-primary" data-cancel>知道了</button>
        </div>
      </div>`;
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.oncancel = null;
    $('[data-copy]', dlg).onclick = async () => {
      try { await navigator.clipboard.writeText(share); toast('已複製'); } catch { toast('無法複製，請手動選取', true); }
    };
    dlg.showModal();
  }

  async function load() {
    try {
      items = await data.listInbox();
      loaded = true;
    } catch (e) {
      toast(`讀取收件匣失敗：${e.message}`, true);
    }
    render();
  }

  function itemHTML(it, staleIds) {
    const stale = staleIds.has(it.id);
    const age = data.inboxAgeDays(it);
    // 沒有標題和內容時，用去掉 https:// 的網址當標題（網域另外列在下面）
    const text = it.title || it.body || (it.url || '').replace(/^https?:\/\/(www\.)?/, '');
    const domain = it.url ? linkLabel(it.url) : '';
    const tab = data.inboxTabOf(it);
    return `
      <li class="ib-item${stale ? ' is-stale' : ''}${tab === 'done' ? ' is-done' : ''}" data-id="${it.id}">
        <span class="ib-mark ib-src-${esc(it.source)}" title="${esc(data.INBOX_SOURCES[it.source] || '其他')}" aria-label="來源：${esc(data.INBOX_SOURCES[it.source] || '其他')}">${SOURCE_MARK[it.source] || '記'}</span>
        <div class="ib-main">
          ${it.url
            ? `<a class="ib-open ib-text" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(text || domain)}</a>`
            : `<span class="ib-text">${esc(text)}</span>`}
          ${it.title && it.body ? `<span class="ib-body">${esc(it.body)}</span>` : ''}
          <span class="ib-meta">
            ${domain ? `<span class="ib-domain">${esc(domain)}</span>` : ''}
            ${it.category ? `<span class="ib-cat">${esc(it.category)}</span>` : ''}
            <span class="ib-age">${age === 0 ? '今天存入' : `存入 ${age} 天`}</span>
            ${stale ? '<span class="ib-stale">放很久了</span>' : ''}
          </span>
        </div>
        <span class="ib-acts">
          ${it.url ? `<a class="btn-ghost ib-open" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">打開</a>` : ''}
          ${tab === 'done' ? '<button type="button" class="btn-ghost" data-act="undone">改回未處理</button>'
            : '<button type="button" class="btn-ghost" data-act="done">已處理</button>'}
          <button type="button" class="btn-ghost" data-act="note">轉靈感</button>
          <button type="button" class="btn-ghost" data-act="task">轉任務</button>
          <button type="button" class="btn-ghost" data-act="edit">編輯</button>
          <button type="button" class="btn-ghost danger" data-act="delete">刪除</button>
        </span>
      </li>`;
  }

  function render() {
    const stale = data.staleInbox(items);
    const staleIds = new Set(stale.map((i) => i.id));
    const counts = { unread: 0, opened: 0, done: 0 };
    for (const it of items) counts[data.inboxTabOf(it)]++;
    $('#ib-count', root).textContent = !loaded ? '讀取中…'
      : `未看 ${counts.unread} 則・已點開 ${counts.opened} 則${stale.length ? `・其中 ${stale.length} 則放超過 ${data.INBOX_STALE_DAYS} 天沒點開` : ''}`;
    $('#ib-tabs', root).innerHTML = Object.entries(TABS).map(([k, label]) =>
      `<button type="button" data-v="${k}" aria-pressed="${ui.tab === k}">${label} <small>${counts[k]}</small></button>`).join('');

    const inTab = items.filter((it) => data.inboxTabOf(it) === ui.tab);
    const sources = Object.keys(data.INBOX_SOURCES).filter((s) => items.some((it) => it.source === s));
    if (ui.source && !sources.includes(ui.source)) ui.source = '';
    $('#ib-sources', root).innerHTML = sources.length > 1 ? ['', ...sources].map((s) =>
      `<button type="button" data-v="${s}" aria-pressed="${ui.source === s}">${s ? `<span class="ib-mark sm ib-src-${s}" aria-hidden="true">${SOURCE_MARK[s]}</span>${esc(data.INBOX_SOURCES[s])}` : '全部來源'}</button>`).join('') : '';
    const cats = data.inboxCategories(items);
    if (ui.cat && !cats.includes(ui.cat)) ui.cat = '';
    $('#ib-catf', root).innerHTML = cats.length ? ['', ...cats].map((c) =>
      `<button type="button" data-v="${esc(c)}" aria-pressed="${ui.cat === c}">${c ? esc(c) : '全部分類'}</button>`).join('') : '';
    $('#ib-cats', root).innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');

    const shown = inTab.filter((it) => (!ui.source || it.source === ui.source) && (!ui.cat || it.category === ui.cat));
    // 未看：放很久的排最前面（最舊的先），其他新到舊
    if (ui.tab === 'unread') shown.sort((a, b) => (staleIds.has(b.id) - staleIds.has(a.id)) || (staleIds.has(a.id) ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
    $('#ib-list', root).innerHTML = shown.length ? shown.map((it) => itemHTML(it, staleIds)).join('')
      : `<li class="empty">${!loaded ? '讀取中…' : items.length
        ? (ui.source || ui.cat ? '這個篩選下沒有東西。' : { unread: '沒有還沒看的了 ✓', opened: '點開過、還沒處理的會在這裡。', done: '標成已處理、轉成靈感或任務的會在這裡。' }[ui.tab])
        : '收件匣是空的。在上面貼一個網址，或照「如何從手機分享進來」設定 iPhone 捷徑。'}</li>`;
  }

  load().then(() => {
    const pending = takePending();
    if (pending) {
      if (!pending.text && !pending.url && !pending.title) { clearPending(); toast('分享的內容是空的', true); return; }
      openItemDialog(null, { share: pending });
    }
  });
  return render; // store 更新（例如領域改名）時重畫；清單本身由這頁自己讀
}
