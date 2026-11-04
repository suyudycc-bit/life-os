// 書影單（Phase J）：書、電影、影集、Podcast、課程。像貼在手帳上的票根：左邊封面、右邊撕線後的資料。
// 資料只呼叫 data.js「手帳（Phase J）」的書影單函式；封面搜尋在 covers.js。
import * as data from '../data.js';
import { refreshNotes } from '../store.js';
import { $, esc, toast, confirmDialog, linkLabel } from '../ui.js';
import { today, formatShort } from '../dates.js';
import { searchCovers, canSearchCover, COVER_SEARCH } from '../covers.js';

const { MEDIA_KINDS, MEDIA_STATUS } = data;
// 各類型的動詞：想讀／想看／想聽／想上
const VERB = { book: '讀', movie: '看', tv: '看', podcast: '聽', course: '上' };
const STAMP = { book: '讀畢', movie: '看畢', tv: '看畢', podcast: '聽畢', course: '結業' };
const STATUS_ORDER = ['want', 'doing', 'done', 'dropped'];
// 快速改狀態：下一步
const NEXT = { want: { to: 'doing', label: '開始' }, doing: { to: 'done', label: '看完了' }, dropped: { to: 'want', label: '放回想看' } };

// 篩選記在這台裝置（localStorage），讀寫都包 try/catch
const FILTER_KEY = 'lifeos-media-filter';
function loadFilter() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTER_KEY) || '{}');
    return { status: MEDIA_STATUS[f.status] ? f.status : 'want', kind: MEDIA_KINDS[f.kind] ? f.kind : '' };
  } catch { return { status: 'want', kind: '' }; }
}
export function saveMediaFilter(f) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* 忽略 */ }
}

const stars = (n, cls = 'md-stars') => (n ? `<span class="${cls}" aria-label="${n} 星">${'★'.repeat(n)}<span class="md-stars-off">${'★'.repeat(5 - n)}</span></span>` : '');

/** 封面：有網址就疊一張圖在佔位上，圖載入失敗（.broken）時露出佔位 */
export function coverHTML(m, size = '') {
  return `<div class="md-cover ${size}" data-kind="${esc(m.kind)}">
    <div class="md-ph" aria-hidden="true"><span class="md-ph-kind">${esc(MEDIA_KINDS[m.kind] || '')}</span>
      <span class="md-ph-title">${esc(m.title)}</span>${m.creator ? `<span class="md-ph-by">${esc(m.creator)}</span>` : ''}</div>
    ${m.cover_url ? `<img class="md-cover-img" src="${esc(m.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  </div>`;
}
/** 封面圖載入失敗時改顯示佔位（error 不冒泡，所以用捕獲階段） */
export function bindCoverFallback(root) {
  root.addEventListener('error', (e) => {
    if (e.target.matches?.('img.md-cover-img')) e.target.closest('.md-cover')?.classList.add('broken');
  }, true);
}

function ticketHTML(m) {
  const next = NEXT[m.status];
  const verb = VERB[m.kind];
  const nextLabel = next && (next.to === 'done' ? `${verb}完了` : next.to === 'want' ? `放回想${verb}` : next.label);
  const meta = [MEDIA_KINDS[m.kind], m.release_year].filter(Boolean).join('・');
  return `<article class="md-ticket" data-id="${m.id}" data-status="${m.status}">
    ${coverHTML(m)}
    <div class="md-info">
      <p class="md-meta">${esc(meta)}</p>
      <h3><button type="button" class="md-title" data-edit aria-label="編輯：${esc(m.title)}">${esc(m.title)}</button></h3>
      ${m.creator ? `<p class="md-by">${esc(m.creator)}</p>` : ''}
      ${stars(m.rating)}
      ${m.status === 'done' && m.review ? `<p class="md-review">${esc(m.review)}</p>` : ''}
      <div class="md-foot">
        ${m.status === 'done' ? `<span class="md-stamp">${STAMP[m.kind]}${m.finished_on ? `<b>${esc(formatShort(m.finished_on))}</b>` : ''}</span>`
          : m.status === 'doing' && m.started_on ? `<span class="sub md-since">${esc(formatShort(m.started_on))} 開始</span>` : ''}
        ${m.status === 'dropped' ? '<span class="sub">已放棄</span>' : ''}
        <span class="md-actions">
          ${m.link_url ? `<a class="btn-ghost" href="${esc(m.link_url)}" target="_blank" rel="noopener noreferrer" title="${esc(m.link_url)}">${esc(linkLabel(m.link_url))} ↗</a>` : ''}
          ${next ? `<button type="button" class="btn-ghost md-next" data-next="${next.to}">→ ${esc(nextLabel)}</button>` : ''}
          ${m.status === 'done' && m.review ? (m.note_id
            ? '<button type="button" class="btn-ghost md-saved" data-note title="再按一次會更新同一則">✓ 已存到知識庫</button>'
            : '<button type="button" class="btn-ghost" data-note>存到靈感知識庫</button>') : ''}
        </span>
      </div>
    </div>
  </article>`;
}

let mediaDialog = null;
/** 對話框在第一次用到時建立（不必改 index.html） */
function dialogEl() {
  if (!mediaDialog) {
    mediaDialog = document.createElement('dialog');
    mediaDialog.id = 'media-dialog';
    mediaDialog.className = 'wide md-dialog';
    document.body.append(mediaDialog);
    bindCoverFallback(mediaDialog);
  }
  return mediaDialog;
}

/**
 * 新增／編輯對話框。opts.hint：顯示在最上面的提示（例如剛標成看完）。
 * onSaved：存檔（含刪除）後呼叫，讓頁面重讀。
 */
export function openMediaDialog(item = null, { preset = {}, hint = '', onSaved = () => {} } = {}) {
  const dlg = dialogEl();
  const m = item || { kind: 'book', status: 'want', title: '', tags: [], ...preset };
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  dlg.innerHTML = `
    <form novalidate>
      <h2>${item ? '編輯' : '加入書影單'}</h2>
      ${hint ? `<p class="md-hint">${esc(hint)}</p>` : ''}
      <div class="md-dlg-top">
        <div class="md-dlg-cover" id="md-preview"></div>
        <div class="md-dlg-fields">
          <div class="row">
            <label>類型<select name="kind">${opt(MEDIA_KINDS, m.kind)}</select></label>
            <label>狀態<select name="status">${opt(MEDIA_STATUS, m.status)}</select></label>
          </div>
          <label>名稱<input name="title" required maxlength="200" value="${esc(m.title)}" autocomplete="off"></label>
          <div class="row">
            <label>作者／創作者<input name="creator" maxlength="200" value="${esc(m.creator || '')}"></label>
            <label>年份<input name="release_year" type="number" min="1000" max="2999" inputmode="numeric" value="${esc(m.release_year || '')}"></label>
          </div>
        </div>
      </div>
      <div class="md-cover-row">
        <label>封面網址（https）<input name="cover_url" type="url" placeholder="https://…" value="${esc(m.cover_url || '')}"></label>
        <button type="button" class="btn-ghost md-search-btn" data-search>搜尋封面</button>
      </div>
      <p class="sub md-search-note" id="md-search-note"></p>
      <div class="md-results" id="md-results" aria-live="polite"></div>
      <label>連結<input name="link_url" type="url" placeholder="書店、片單、節目頁…" value="${esc(m.link_url || '')}"></label>
      <fieldset class="md-rate">
        <legend>評分</legend>
        ${[1, 2, 3, 4, 5].map((n) => `<label title="${n} 星"><input type="radio" name="rating" value="${n}" ${Number(m.rating) === n ? 'checked' : ''}><span aria-hidden="true">★</span><span class="sr">${n} 星</span></label>`).join('')}
        <button type="button" class="btn-ghost" data-clear-rate>清除</button>
      </fieldset>
      <div class="row">
        <label>開始日<input name="started_on" type="date" value="${esc(m.started_on || '')}"></label>
        <label>看完日<input name="finished_on" type="date" value="${esc(m.finished_on || '')}"></label>
      </div>
      <label>標籤（逗號分隔）<input name="tags" placeholder="例如：職涯, 推薦" value="${esc((m.tags || []).join(', '))}"></label>
      <label>心得<textarea name="review" rows="5" placeholder="看完的一點想法，兩三行就好">${esc(m.review || '')}</textarea></label>
      <div class="dialog-actions md-dlg-actions">
        ${item ? '<button type="button" class="btn-ghost danger" data-del>刪除</button>' : ''}
        <button type="button" class="btn-ghost" data-tonote hidden></button>
        <span class="md-spacer"></span>
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button type="button" class="btn-primary" data-save>儲存</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  const results = $('#md-results', dlg);
  const note = $('#md-search-note', dlg);
  const searchBtn = $('[data-search]', dlg);
  const toNoteBtn = $('[data-tonote]', dlg);
  let candidates = [];
  let ctrl = null; // 目前這次搜尋（關閉或再搜時中止）
  let busy = false;

  const current = () => {
    const f = new FormData(form);
    return {
      ...(item || {}), kind: f.get('kind'), status: f.get('status'), title: f.get('title'), creator: f.get('creator'),
      release_year: f.get('release_year'), cover_url: f.get('cover_url'), link_url: f.get('link_url'),
      rating: f.get('rating') || null, started_on: f.get('started_on'), finished_on: f.get('finished_on'),
      tags: data.parseTags(f.get('tags')), review: f.get('review'), area_id: item?.area_id ?? m.area_id ?? null,
    };
  };
  const renderPreview = () => {
    const c = current();
    $('#md-preview', dlg).innerHTML = coverHTML({ ...c, title: c.title || '（名稱）', cover_url: /^https:\/\//.test(c.cover_url) ? c.cover_url : '' }, 'lg');
  };
  /** resetNote：開啟或換類型時才換回預設說明；搜尋後的「查無結果／網路錯誤」要留著 */
  const renderSearchState = (resetNote = false) => {
    const kind = form.kind.value;
    const ok = canSearchCover(kind);
    searchBtn.hidden = !ok;
    searchBtn.disabled = busy;
    searchBtn.textContent = busy ? '搜尋中…' : '搜尋封面';
    if (resetNote) {
      note.textContent = ok ? `輸入名稱後按「搜尋封面」（來源：${COVER_SEARCH[kind]}），或直接貼封面網址。`
        : `${MEDIA_KINDS[kind]}沒有免金鑰的公開封面來源，請貼圖片網址（在圖片上按右鍵「複製圖片位址」）。`;
    }
  };
  const renderToNote = () => {
    const c = current();
    toNoteBtn.hidden = !(item && c.status === 'done' && c.review.trim());
    toNoteBtn.textContent = item?.note_id ? '✓ 已存到知識庫（再存一次）' : '存到靈感知識庫';
  };
  renderPreview();
  renderSearchState(true);
  renderToNote();

  form.addEventListener('input', (e) => {
    if (['title', 'creator', 'cover_url', 'kind'].includes(e.target.name)) renderPreview();
    if (e.target.name === 'kind') { ctrl?.abort(); results.innerHTML = ''; renderSearchState(true); }
    if (['status', 'review'].includes(e.target.name)) renderToNote();
  });
  form.addEventListener('change', (e) => {
    if (e.target.name === 'kind') { ctrl?.abort(); renderPreview(); results.innerHTML = ''; renderSearchState(true); }
    if (e.target.name === 'status') renderToNote();
  });
  form.title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (canSearchCover(form.kind.value)) searchBtn.click(); }
  });

  searchBtn.onclick = async () => {
    if (busy) return; // 防連點：上一次還沒回來
    const q = form.title.value.trim();
    if (!q) { note.textContent = '先輸入名稱再搜尋。'; form.title.focus(); return; }
    busy = true;
    ctrl = new AbortController();
    results.innerHTML = '';
    note.textContent = `搜尋「${q}」中…`;
    renderSearchState();
    try {
      candidates = await searchCovers(form.kind.value, q, { signal: ctrl.signal });
      note.textContent = candidates.length ? '點一個帶入封面（作者、年份空白時也會一起帶入）。'
        : `找不到「${q}」的封面。換個寫法（原文書名、少幾個字）再試，或直接貼封面網址。`;
      results.innerHTML = candidates.map((c, i) => `
        <button type="button" class="md-cand" data-i="${i}">
          <img src="${esc(c.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">
          <span class="md-cand-t">${esc(c.title)}</span>
          <span class="md-cand-s">${esc([c.creator, c.year].filter(Boolean).join('・'))}</span>
          <span class="md-cand-src">${esc(c.source)}</span>
        </button>`).join('');
    } catch (err) {
      if (err.name !== 'AbortError') note.textContent = err.message;
    } finally {
      busy = false;
      ctrl = null;
      renderSearchState();
    }
  };
  results.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    const c = b && candidates[Number(b.dataset.i)];
    if (!c) return;
    form.cover_url.value = c.cover;
    if (!form.creator.value.trim() && c.creator) form.creator.value = c.creator;
    if (!form.release_year.value && c.year) form.release_year.value = c.year;
    results.querySelectorAll('.md-cand').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    note.textContent = '已帶入封面，按「儲存」就會記下來。';
    renderPreview();
  });
  results.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.closest('.md-cand')?.remove(); }, true);

  // 評分：同一顆星再點一次＝取消
  $('.md-rate', dlg).addEventListener('click', (e) => {
    const r = e.target.closest('input[name=rating]');
    if (r && r.dataset.was === 'true') { r.checked = false; }
    form.querySelectorAll('input[name=rating]').forEach((x) => { x.dataset.was = String(x.checked); });
  });
  form.querySelectorAll('input[name=rating]').forEach((x) => { x.dataset.was = String(x.checked); });
  $('[data-clear-rate]', dlg).onclick = () => form.querySelectorAll('input[name=rating]').forEach((x) => { x.checked = false; x.dataset.was = 'false'; });

  const close = () => { ctrl?.abort(); dlg.close(); };
  const save = async () => {
    if (!form.title.value.trim()) { toast('請輸入名稱', true); form.title.focus(); return null; }
    const saved = await data.saveMedia(current());
    return saved;
  };
  // 直接聽按鈕，不依賴 close 事件（docs/03）
  $('[data-cancel]', dlg).onclick = close;
  dlg.oncancel = (e) => { e.preventDefault(); close(); };
  form.onsubmit = (e) => e.preventDefault();
  $('[data-save]', dlg).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const saved = await save();
      if (!saved) return;
      close();
      toast(item ? '已更新' : `已加入「${MEDIA_STATUS[saved.status]}」`);
      await onSaved(saved);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  };
  toNoteBtn.onclick = async () => {
    toNoteBtn.disabled = true;
    try {
      const saved = await save(); // 先存目前的心得，再寫進知識庫
      if (!saved) return;
      await data.saveMediaReviewToNote({ ...saved, note_id: saved.note_id ?? item?.note_id });
      close();
      await refreshNotes();
      toast(item?.note_id ? '已更新知識庫裡的那一則' : '已存到靈感知識庫');
      await onSaved(saved);
    } catch (err) {
      toast(err.message, true);
    } finally {
      toNoteBtn.disabled = false;
    }
  };
  const del = $('[data-del]', dlg);
  if (del) {
    del.onclick = async () => {
      if (!(await confirmDialog(`確定從書影單刪除「${item.title}」？此操作無法復原。${item.note_id ? '（已存到知識庫的那則靈感會保留）' : ''}`))) return;
      try {
        await data.deleteMedia(item.id);
        close();
        toast('已刪除');
        await onSaved(null);
      } catch (err) {
        toast(err.message, true);
      }
    };
  }
  dlg.showModal();
  form.title.focus();
}

export function mountMedia(root) {
  const ui = loadFilter();
  let items = null; // null＝載入中
  let failed = '';

  root.innerHTML = `
    <header class="page-head cal-head">
      <h1>書影單</h1>
      <button class="btn-primary" id="md-new">＋ 加入</button>
    </header>
    <div class="md-bar">
      <div class="seg md-tabs" id="md-tabs" role="group" aria-label="依狀態"></div>
      <div class="nt-filters md-kinds" id="md-kinds" role="group" aria-label="依類型篩選"></div>
    </div>
    <div class="md-shelf" id="md-shelf"></div>`;
  bindCoverFallback(root);

  const reload = async () => {
    try {
      items = await data.listMedia();
      failed = '';
    } catch (e) {
      items = items || [];
      failed = e.message;
    }
    render();
  };
  const onSaved = async (saved) => {
    // 新增或改了狀態：切到那一頁籤，才看得到剛存的那筆
    if (saved && saved.status !== ui.status) { ui.status = saved.status; saveMediaFilter(ui); }
    await reload();
  };

  $('#md-new', root).onclick = () => openMediaDialog(null, {
    preset: { kind: ui.kind || 'book', status: ui.status === 'dropped' ? 'want' : ui.status }, onSaved,
  });
  $('#md-tabs', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    ui.status = b.dataset.status;
    saveMediaFilter(ui);
    render();
  });
  $('#md-kinds', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    ui.kind = b.dataset.kind;
    saveMediaFilter(ui);
    render();
  });
  $('#md-shelf', root).addEventListener('click', async (e) => {
    if (e.target.closest('a')) return;
    const card = e.target.closest('.md-ticket');
    const m = card && items.find((x) => x.id === card.dataset.id);
    if (!m) return;
    const btn = e.target.closest('button');
    if (btn?.dataset.next) {
      const to = btn.dataset.next;
      btn.disabled = true;
      try {
        const patch = { ...m, status: to };
        if (to === 'doing' && !m.started_on) patch.started_on = today();
        const saved = await data.saveMedia(patch);
        if (to === 'done') {
          // 標成看完：提示可以寫心得與評分（狀態已經存好了，對話框只是補資料）
          await reload();
          openMediaDialog(saved, { hint: `${VERB[saved.kind]}完了！留下評分和兩三行心得吧，之後可以存到靈感知識庫。`, onSaved: reload });
          setTimeout(() => dialogEl().querySelector('textarea[name=review]')?.focus(), 0);
        } else {
          toast(`已移到「${MEDIA_STATUS[to]}」`);
          await reload();
        }
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
      return;
    }
    if (btn?.hasAttribute('data-note')) {
      btn.disabled = true;
      try {
        await data.saveMediaReviewToNote(m);
        await refreshNotes();
        toast(m.note_id ? '已更新知識庫裡的那一則' : '已存到靈感知識庫');
        await reload();
      } catch (err) {
        toast(err.message, true);
        btn.disabled = false;
      }
      return;
    }
    // 點封面或名稱都開編輯
    if (btn?.hasAttribute('data-edit') || e.target.closest('.md-cover')) openMediaDialog(m, { onSaved });
  });

  function render() {
    const tabs = $('#md-tabs', root);
    if (!tabs) return;
    if (items === null) {
      $('#md-shelf', root).innerHTML = '<p class="sub">載入中…</p>';
      return;
    }
    const ofKind = ui.kind ? items.filter((m) => m.kind === ui.kind) : items;
    const count = (s) => ofKind.filter((m) => m.status === s).length;
    tabs.innerHTML = STATUS_ORDER.map((s) => `<button type="button" data-status="${s}" aria-pressed="${ui.status === s}">${MEDIA_STATUS[s]} <span class="md-count">${count(s)}</span></button>`).join('');
    $('#md-kinds', root).innerHTML = [['', '全部'], ...Object.entries(MEDIA_KINDS)].map(([k, v]) => {
      const n = k ? items.filter((m) => m.kind === k).length : items.length;
      return `<button type="button" data-kind="${k}" aria-pressed="${ui.kind === k}">${esc(v)} <span class="count">${n}</span></button>`;
    }).join('');

    let list = ofKind.filter((m) => m.status === ui.status);
    if (ui.status === 'done') list = [...list].sort((a, b) => String(b.finished_on || '').localeCompare(String(a.finished_on || '')));
    const kindName = ui.kind ? MEDIA_KINDS[ui.kind] : '';
    const empty = {
      want: `還沒有想${kindName ? VERB[ui.kind] : '看'}的${kindName}。按右上角「＋ 加入」，把聽人推薦的書、片、節目先記下來。`,
      doing: `目前沒有進行中的${kindName}。在「想看」按「→ 開始」就會移到這裡。`,
      done: `還沒有看完的${kindName}。看完時按「→ 看完了」，順手留下評分與心得。`,
      dropped: '沒有放棄的。不想看了可以在編輯裡把狀態改成「放棄」，不用刪掉。',
    }[ui.status];
    $('#md-shelf', root).innerHTML = (failed ? `<p class="warn">讀取書影單失敗：${esc(failed)}</p>` : '')
      + (list.length ? list.map(ticketHTML).join('') : `<div class="card empty-page md-empty"><p>${empty}</p></div>`);
  }

  reload();
  return render;
}
