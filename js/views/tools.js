// 工具箱（20261114，來自回饋 34904791）：自己做的小工具（Apps Script、網站…）和在社群上收藏、之後可能用到的工具。
// 資料在 tools（不在 store，這頁自己讀）；存取都在 data.js「工具箱」段。待看清單的「存到工具箱」也寫進這裡。
import * as data from '../data.js';
import { $, esc, toast, confirmDialog, linkChip } from '../ui.js';
import { formatShort, localDate } from '../dates.js';

const FILTER_KEY = 'lifeos-tools-filter';

export function mountTools(root) {
  const ui = { kind: '', category: '', q: '' };
  try { Object.assign(ui, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'), { q: '' }); } catch { /* 忽略 */ }
  const saveUi = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ kind: ui.kind, category: ui.category })); } catch { /* 忽略 */ } };
  let tools = [];
  let loaded = false;

  root.innerHTML = `
    <header class="page-head tl-head"><div><h1>工具箱</h1><p class="sub" id="tl-count"></p></div>
      <button type="button" class="btn-primary" id="tl-new">＋ 新增工具</button></header>
    <section class="card">
      <div class="tl-filters">
        <div class="seg" id="tl-kind" role="group" aria-label="類型">
          <button type="button" data-v="">全部</button><button type="button" data-v="mine">我做的</button><button type="button" data-v="saved">收藏的</button>
        </div>
        <select id="tl-cat" aria-label="依分類篩選"></select>
        <input type="search" id="tl-q" placeholder="搜尋名稱、說明、平台" aria-label="搜尋工具">
      </div>
      <ul class="tl-list" id="tl-list"></ul>
    </section>`;

  $('#tl-new', root).onclick = () => openToolDialog(null, { kind: ui.kind || 'mine', category: ui.category }, load, tools);
  $('#tl-kind', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.kind = b.dataset.v; saveUi(); render();
  });
  $('#tl-cat', root).addEventListener('change', (e) => { ui.category = e.target.value; saveUi(); render(); });
  $('#tl-q', root).addEventListener('input', (e) => { ui.q = e.target.value; render(); });

  $('#tl-list', root).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-id]');
    const t = li && tools.find((x) => x.id === li.dataset.id);
    if (!t) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'star') { await data.setToolStarred(t.id, !t.starred); await load(); }
      if (act === 'edit') openToolDialog(t, {}, load, tools);
      if (act === 'del') {
        if (!(await confirmDialog(`把「${t.name}」移到垃圾桶？30 天內可在「數據與備份」還原。`))) return;
        await data.deleteTool(t.id);
        await load();
        toast('已移到垃圾桶');
      }
    } catch (err) { toast(err.message, true); }
  });

  function render() {
    root.querySelectorAll('#tl-kind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === ui.kind)));
    const cats = data.toolCategories(tools).filter((c) => tools.some((t) => t.category === c));
    if (ui.category && !cats.includes(ui.category)) ui.category = '';
    $('#tl-cat', root).innerHTML = `<option value="">全部分類</option>${cats.map((c) => `<option ${c === ui.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    if (!loaded) { $('#tl-list', root).innerHTML = '<li class="sub">載入中…</li>'; return; }
    const mine = tools.filter((t) => t.kind === 'mine').length;
    $('#tl-count', root).textContent = tools.length ? `${tools.length} 個工具・我做的 ${mine}・收藏的 ${tools.length - mine}` : '';
    const list = data.filterTools(tools, ui);
    $('#tl-list', root).innerHTML = list.length ? list.map(itemHTML).join('')
      : `<li class="empty">${tools.length ? '沒有符合的工具。' : '還沒有工具。自己做好的小工具、在社群看到之後想用的，都可以放進來；待看清單也可以按「存到工具箱」。'}</li>`;
  }

  function itemHTML(t) {
    const meta = [t.category, t.platform].filter(Boolean).map(esc).join('・');
    return `<li class="tl-item" data-id="${t.id}">
      <div class="tl-top">
        <button type="button" class="tl-star ${t.starred ? 'on' : ''}" data-act="star" aria-pressed="${t.starred}" title="${t.starred ? '取消常用' : '標成常用（排在前面）'}">${t.starred ? '★' : '☆'}</button>
        <h3 class="tl-name">${esc(t.name)}</h3>
        <span class="tl-kind tl-${t.kind}">${data.TOOL_KINDS[t.kind]}${t.status ? `・${data.TOOL_STATUS[t.status]}` : ''}</span>
      </div>
      ${meta ? `<p class="tl-meta">${meta}</p>` : ''}
      ${t.description ? `<p class="tl-desc">${esc(t.description)}</p>` : ''}
      <div class="tl-foot">
        ${t.url ? linkChip(t.url) : ''}
        ${t.admin_url ? `<span class="tl-admin" title="後台／原始碼">${linkChip(t.admin_url)}</span>` : ''}
        <span class="sub tl-date">${formatShort(localDate(t.updated_at || t.created_at))}</span>
        <button type="button" class="btn-ghost" data-act="edit">修改</button>
        <button type="button" class="btn-ghost danger" data-act="del">刪除</button>
      </div></li>`;
  }

  async function load() {
    try {
      tools = await data.listTools();
      loaded = true;
    } catch (err) {
      $('#tl-list', root).innerHTML = `<li class="warn">讀取工具箱失敗：${esc(err.message)}（如果是第一次使用，需要先執行 migration 20261114_tools.sql）</li>`;
      return;
    }
    render();
  }
  render();
  load();
  return () => {}; // 資料不在 store；新增／修改後自己重讀
}

/** 新增／修改工具（工具箱頁、待看清單「存到工具箱」共用）。preset：預設欄位；onSaved：存好之後 */
export function openToolDialog(tool, preset = {}, onSaved = null, existing = []) {
  let dlg = $('#tool-dialog');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'tool-dialog'; document.body.append(dlg); }
  const v = { kind: 'mine', ...preset, ...(tool || {}) };
  const opts = (list) => list.map((x) => `<option value="${esc(x)}"></option>`).join('');
  dlg.innerHTML = `
    <form class="tl-form">
      <h2>${tool ? '修改工具' : '新增工具'}</h2>
      <div class="seg tl-kind-pick" role="group" aria-label="類型">
        <button type="button" data-kind="mine" aria-pressed="${v.kind === 'mine'}">我做的</button>
        <button type="button" data-kind="saved" aria-pressed="${v.kind === 'saved'}">收藏的</button>
      </div>
      <label>名稱<input name="name" required maxlength="120" value="${esc(v.name || '')}"></label>
      <label>使用網址<input name="url" type="url" maxlength="2000" value="${esc(v.url || '')}" placeholder="https://"></label>
      <label class="tl-mine-only">後台／原始碼網址（可留白）<input name="admin_url" type="url" maxlength="2000" value="${esc(v.admin_url || '')}" placeholder="Apps Script 專案、試算表、GitHub…"></label>
      <div class="tl-row">
        <label>分類<input name="category" list="tl-dl-cat" maxlength="40" value="${esc(v.category || '')}" autocomplete="off"></label>
        <label>平台<input name="platform" list="tl-dl-plat" maxlength="40" value="${esc(v.platform || '')}" autocomplete="off"></label>
        <label class="tl-saved-only">狀態<select name="status">
          ${Object.entries(data.TOOL_STATUS).map(([k, l]) => `<option value="${k}" ${(v.status || 'want') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <datalist id="tl-dl-cat">${opts(data.toolCategories(existing))}</datalist>
      <datalist id="tl-dl-plat">${opts(data.toolPlatforms(existing))}</datalist>
      <label>說明（做什麼用、怎麼用）<textarea name="description" rows="4" maxlength="4000">${esc(v.description || '')}</textarea></label>
      <label class="check"><input type="checkbox" name="starred" ${v.starred ? 'checked' : ''}> 常用（排在前面）</label>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  const f = $('form', dlg);
  let kind = v.kind;
  const sync = () => {
    dlg.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kind)));
    $('.tl-mine-only', dlg).hidden = kind !== 'mine';
    $('.tl-saved-only', dlg).hidden = kind !== 'saved';
  };
  dlg.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { kind = b.dataset.kind; sync(); }; });
  sync();
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const saved = await (preset.save || data.saveTool)({
        id: tool?.id, kind, name: f.name.value, url: f.url.value, admin_url: f.admin_url.value, category: f.category.value,
        platform: f.platform.value, status: f.status.value, description: f.description.value, starred: f.starred.checked,
      });
      dlg.close();
      toast(tool ? '已儲存' : '已放進工具箱');
      await onSaved?.(saved);
    } catch (err) { toast(err.message, true); }
  };
  dlg.showModal();
}
