// M6 靈感知識庫（Phase 4）：搜尋標題／正文／標籤、依領域分類、#標籤、記錄靈感彈窗
import * as data from '../data.js';
import { state, refreshNotes } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip, linkify, formatDateTime } from '../ui.js';

const ui = { q: '', areaId: '', tag: '' };

/** 記錄／編輯靈感的彈窗（總覽的快速記錄也用這個） */
export function openNoteDialog(note = null, preset = {}) {
  const dlg = $('#note-dialog');
  const n = note || { title: '', body: '', area_id: '', tags: [], ...preset };
  dlg.innerHTML = `
    <form>
      <h2>${note ? '編輯靈感' : '記錄靈感'}</h2>
      <label>標題<input name="title" required maxlength="120" value="${esc(n.title)}"></label>
      <div class="row">
        <label>領域<select name="area_id"><option value="">（不分領域）</option>
          ${state.areas.map((a) => `<option value="${a.id}" ${a.id === n.area_id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
        </select></label>
        <label>標籤（逗號分隔）<input name="tags" placeholder="例如：BD, 簡報, 點子" value="${esc((n.tags || []).join(', '))}"></label>
      </div>
      <label>正文<textarea name="body" rows="8" placeholder="想法、筆記、連結都可以（網址會自動變成連結）">${esc(n.body || '')}</textarea></label>
      ${note ? `<p class="sub">建立 ${formatDateTime(note.created_at)}・更新 ${formatDateTime(note.updated_at)}</p>` : ''}
      <div class="dialog-actions">
        ${note ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除</button>' : ''}
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">儲存</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  const del = $('[data-del]', dlg);
  if (del) {
    del.onclick = async () => {
      if (!(await confirmDialog(`確定刪除「${note.title}」？此操作無法復原。`))) return;
      try {
        await data.deleteNote(note.id);
        dlg.close();
        await refreshNotes();
        toast('已刪除');
      } catch (e) {
        toast(e.message, true);
      }
    };
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await data.saveNote({ id: note?.id, title: f.get('title'), area_id: f.get('area_id'), tags: f.get('tags'), body: f.get('body') });
      dlg.close();
      await refreshNotes();
      toast(note ? '已更新' : '已記錄');
    } catch (err) {
      toast(err.message, true);
    }
  };
  dlg.showModal();
  form.title.focus();
}

export function mountNotes(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>靈感知識庫</h1>
      <button class="btn-primary" id="nt-new">＋ 記錄靈感</button>
    </header>
    <section class="card">
      <input type="search" id="nt-q" class="nt-search" placeholder="搜尋標題、正文、標籤…" aria-label="搜尋靈感" value="${esc(ui.q)}">
      <div class="nt-filters" id="nt-areas" role="group" aria-label="依領域篩選"></div>
      <div class="nt-tags" id="nt-tags" aria-label="標籤"></div>
    </section>
    <p class="sub nt-count" id="nt-count"></p>
    <div class="nt-grid" id="nt-grid"></div>`;

  $('#nt-new', root).onclick = () => openNoteDialog(null, { area_id: ui.areaId });
  $('#nt-q', root).addEventListener('input', (e) => { ui.q = e.target.value; render(); });
  $('#nt-areas', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-area]');
    if (b) { ui.areaId = b.dataset.area; render(); }
  });
  $('#nt-tags', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) { ui.tag = ui.tag === b.dataset.tag ? '' : b.dataset.tag; render(); }
  });
  $('#nt-grid', root).addEventListener('click', (e) => {
    if (e.target.closest('a')) return; // 點正文裡的連結就直接開連結
    const tagBtn = e.target.closest('[data-tag]');
    if (tagBtn) { ui.tag = tagBtn.dataset.tag; render(); return; }
    const card = e.target.closest('[data-id]');
    const note = card && state.notes.find((n) => n.id === card.dataset.id);
    if (note) openNoteDialog(note);
  });

  function render() {
    if (ui.areaId && !state.areasById[ui.areaId]) ui.areaId = '';
    const counts = Object.fromEntries(state.areas.map((a) => [a.id, 0]));
    for (const n of state.notes) if (n.area_id in counts) counts[n.area_id]++;
    $('#nt-areas', root).innerHTML = [
      `<button type="button" data-area="" aria-pressed="${!ui.areaId}">全部 <span class="count">${state.notes.length}</span></button>`,
      ...state.areas.map((a) => `<button type="button" data-area="${a.id}" aria-pressed="${ui.areaId === a.id}" style="--c:${esc(a.color || '#888')}">
        <i class="dot"></i>${esc(a.name)} <span class="count">${counts[a.id]}</span></button>`),
    ].join('');

    const tags = data.tagCounts(state.notes);
    if (ui.tag && !tags.some(([t]) => t === ui.tag)) ui.tag = '';
    $('#nt-tags', root).innerHTML = tags.length
      ? tags.map(([t, c]) => `<button type="button" class="tag-btn" data-tag="${esc(t)}" aria-pressed="${ui.tag === t}">#${esc(t)} <small>${c}</small></button>`).join('')
      : '';

    const list = data.searchNotes(state.notes, ui);
    const filtered = ui.q || ui.areaId || ui.tag;
    $('#nt-count', root).textContent = filtered ? `找到 ${list.length} 則${ui.tag ? `（標籤 #${ui.tag}）` : ''}` : `共 ${list.length} 則`;
    $('#nt-grid', root).innerHTML = list.length ? list.map((n) => `
      <article class="card nt-card" data-id="${n.id}" tabindex="0" role="button" aria-label="編輯靈感：${esc(n.title)}">
        <h3>${esc(n.title)}</h3>
        ${n.area_id ? `<div class="nt-area">${areaChip(state.areasById[n.area_id])}</div>` : ''}
        ${n.body ? `<p class="nt-body">${linkify(n.body)}</p>` : ''}
        ${(n.tags || []).length ? `<div class="nt-card-tags">${n.tags.map((t) => `<button type="button" class="tag-btn" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}</div>` : ''}
        <p class="nt-time">建立 ${formatDateTime(n.created_at)}${new Date(n.updated_at) - new Date(n.created_at) > 60000 ? `・更新 ${formatDateTime(n.updated_at)}` : ''}</p>
      </article>`).join('')
      : `<div class="card empty-page"><p>${state.notes.length ? '找不到符合的靈感，換個關鍵字或篩選看看。' : '還沒有靈感。按右上角「＋ 記錄靈感」寫下第一個想法吧！'}</p></div>`;
  }

  $('#nt-grid', root).addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.nt-card')) {
      e.preventDefault();
      e.target.click();
    }
  });

  return render;
}
