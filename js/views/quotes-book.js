// 佳句本（20261112，來自回饋 8cd19a58）：記錄佳句，可掛書影單的一本；勾「放進每日一句」的會和內建句子混合出現在總覽。
// 資料在 quotes（不在 store，這頁自己讀）；存取都在 data.js「佳句本」段，混合規則在 quotes.js。
// 網址 #/quotes/<書影單 id> 會直接篩出那一本的佳句（書影單卡片的「佳句 n」連到這裡）。
import * as data from '../data.js';
import { $, esc, toast, confirmDialog } from '../ui.js';
import { formatShort, localDate } from '../dates.js';

const MEDIA_KIND = { book: '書', movie: '電影', tv: '影集', podcast: 'Podcast', course: '課程' };

export function mountQuotes(root) {
  const ui = { q: '', mediaId: location.hash.split('/')[2] || '' };
  let quotes = [];
  let media = [];
  let loaded = false;
  const mediaById = () => Object.fromEntries(media.map((m) => [m.id, m]));

  root.innerHTML = `
    <header class="page-head"><h1>佳句本</h1><p class="sub" id="qb-count"></p></header>
    <section class="card qb-page">
      <form id="qb-add" class="qb-form">
        <label>佳句<textarea name="body" rows="3" maxlength="${data.QUOTE_MAX}" required aria-label="佳句"></textarea></label>
        <div class="qb-row">
          <label>誰說的<input name="author" maxlength="120" autocomplete="off"></label>
          <label>出處<input name="source" maxlength="200" autocomplete="off" placeholder="書名、章節、影片…"></label>
          <label>書影單<select name="media_id" id="qb-media-pick"></select></label>
        </div>
        <label>我的想法（可留白）<textarea name="thought" rows="2" maxlength="4000"></textarea></label>
        <div class="qb-actions">
          <label class="check"><input type="checkbox" name="in_daily" checked> 放進總覽的每日一句</label>
          <button class="btn-primary">記下來</button>
        </div>
      </form>
    </section>
    <section class="card">
      <div class="qb-filters">
        <input type="search" id="qb-q" placeholder="搜尋佳句、作者、出處、想法" aria-label="搜尋佳句">
        <select id="qb-media" aria-label="依書影單篩選"></select>
      </div>
      <ol class="qb-list" id="qb-list"></ol>
    </section>`;

  const form = $('#qb-add', root);
  const mediaOptions = (selected, first) => `<option value="">${first}</option>${media.map((m) =>
    `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(MEDIA_KIND[m.kind] || '')}｜${esc(m.title)}</option>`).join('')}`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await data.saveQuote({ body: f.get('body'), author: f.get('author'), source: f.get('source'), thought: f.get('thought'),
        media_id: f.get('media_id'), in_daily: form.in_daily.checked });
      const keepMedia = form.media_id.value;
      form.reset();
      form.media_id.value = keepMedia; // 連續記同一本書的佳句時不用重選
      form.in_daily.checked = true;
      form.body.focus();
      await load();
      toast('已記進佳句本');
    } catch (err) { toast(err.message, true); }
  });
  // 選了書影單、出處還空著 → 帶入書名（可再改）
  form.media_id.addEventListener('change', () => {
    const m = mediaById()[form.media_id.value];
    if (m && !form.source.value.trim()) form.source.value = m.title;
    if (m && !form.author.value.trim() && m.creator) form.author.value = m.creator;
  });

  $('#qb-q', root).addEventListener('input', (e) => { ui.q = e.target.value; render(); });
  $('#qb-media', root).addEventListener('change', (e) => {
    ui.mediaId = e.target.value;
    history.replaceState(null, '', ui.mediaId ? `#/quotes/${ui.mediaId}` : '#/quotes');
    render();
  });

  $('#qb-list', root).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-id]');
    const item = li && quotes.find((x) => x.id === li.dataset.id);
    if (!item) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'edit') openEdit(item);
      else if (act === 'copy') {
        const m = mediaById()[item.media_id];
        const cite = [item.author, item.source || m?.title].filter(Boolean).join('，');
        await navigator.clipboard.writeText(`「${item.body}」${cite ? `\n— ${cite}` : ''}`);
        toast('已複製');
      } else if (act === 'del') {
        if (!(await confirmDialog('刪除這則佳句？（30 天內可在「數據與備份」的垃圾桶還原）', '刪除'))) return;
        await data.deleteQuote(item.id);
        await load();
        toast('已移到垃圾桶');
      }
    } catch (err) { toast(err.message, true); }
  });
  $('#qb-list', root).addEventListener('change', async (e) => {
    if (!e.target.matches('.qb-daily')) return;
    const li = e.target.closest('[data-id]');
    try {
      await data.setQuoteInDaily(li.dataset.id, e.target.checked);
      const it = quotes.find((x) => x.id === li.dataset.id);
      if (it) it.in_daily = e.target.checked;
      toast(e.target.checked ? '會出現在每日一句' : '不會出現在每日一句');
      renderCount();
    } catch (err) { e.target.checked = !e.target.checked; toast(err.message, true); }
  });

  function openEdit(item) {
    let dlg = $('#qb-dialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'qb-dialog'; document.body.append(dlg); }
    dlg.innerHTML = `
      <form class="qb-form">
        <h2>修改佳句</h2>
        <label>佳句<textarea name="body" rows="4" maxlength="${data.QUOTE_MAX}" required>${esc(item.body)}</textarea></label>
        <label>誰說的<input name="author" maxlength="120" value="${esc(item.author || '')}"></label>
        <label>出處<input name="source" maxlength="200" value="${esc(item.source || '')}"></label>
        <label>書影單<select name="media_id">${mediaOptions(item.media_id, '（不掛）')}</select></label>
        <label>我的想法<textarea name="thought" rows="3" maxlength="4000">${esc(item.thought || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="in_daily" ${item.in_daily ? 'checked' : ''}> 放進總覽的每日一句</label>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await data.saveQuote({ id: item.id, body: f.body.value, author: f.author.value, source: f.source.value, thought: f.thought.value,
          media_id: f.media_id.value, in_daily: f.in_daily.checked });
        dlg.close();
        await load();
        toast('已儲存');
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
  }

  function renderCount() {
    const daily = quotes.filter((x) => x.in_daily).length;
    $('#qb-count', root).textContent = quotes.length ? `${quotes.length} 則佳句・${daily} 則放進每日一句` : '';
  }

  function render() {
    if (!loaded) { $('#qb-list', root).innerHTML = '<li class="sub">載入中…</li>'; return; }
    const byId = mediaById();
    form.media_id.innerHTML = mediaOptions(form.media_id.value, '（不掛）');
    const linked = media.filter((m) => quotes.some((x) => x.media_id === m.id));
    $('#qb-media', root).innerHTML = `<option value="">全部書影單</option>${linked.map((m) =>
      `<option value="${m.id}" ${m.id === ui.mediaId ? 'selected' : ''}>${esc(m.title)}</option>`).join('')}`;
    if (ui.mediaId && !linked.some((m) => m.id === ui.mediaId) && byId[ui.mediaId]) {
      // 從書影單點進來、這本還沒有佳句：新增表單直接預選它
      form.media_id.value = ui.mediaId;
      if (!form.source.value) form.source.value = byId[ui.mediaId].title;
    }
    renderCount();
    const list = data.filterQuotes(quotes, { q: ui.q, mediaId: linked.some((m) => m.id === ui.mediaId) ? ui.mediaId : '' }, byId);
    $('#qb-list', root).innerHTML = list.length ? list.map((x) => {
      const m = byId[x.media_id];
      const cite = [x.author, x.source].filter(Boolean).join('，');
      return `<li class="qb-item" data-id="${x.id}">
        <blockquote class="qb-body">${esc(x.body)}</blockquote>
        ${cite || m ? `<p class="qb-cite">— ${esc(cite)}${m && x.source !== m.title ? `${cite ? '・' : ''}<a href="#/media">${esc(m.title)}</a>` : ''}</p>` : ''}
        ${x.thought ? `<p class="qb-thought">${esc(x.thought)}</p>` : ''}
        <div class="qb-foot">
          <span class="sub">${formatShort(localDate(x.created_at))}</span>
          <label class="check qb-daily-l"><input type="checkbox" class="qb-daily" ${x.in_daily ? 'checked' : ''}> 每日一句</label>
          <button type="button" class="btn-ghost" data-act="copy">複製</button>
          <button type="button" class="btn-ghost" data-act="edit">修改</button>
          <button type="button" class="btn-ghost danger" data-act="del">刪除</button>
        </div></li>`;
    }).join('') : `<li class="empty">${quotes.length ? '沒有符合的佳句。' : '還沒有佳句。讀到、聽到喜歡的句子，就記在上面。'}</li>`;
  }

  async function load() {
    try {
      [quotes, media] = await Promise.all([data.listQuotes(), data.listMedia()]);
      loaded = true;
    } catch (err) {
      $('#qb-list', root).innerHTML = `<li class="warn">讀取佳句失敗：${esc(err.message)}（如果是第一次使用，需要先執行 migration 20261112_quotes.sql）</li>`;
      return;
    }
    render();
  }
  load();

  return () => {}; // 資料不在 store；新增／修改後自己重讀
}
