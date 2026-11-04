// 想做清單（Phase J）：人生想做的事——想去的地方、想學的東西、想體驗的事。
// 資料在 bucket_items（不在 store，這頁自己讀）；排序、分類建議、拖移寫回 sort_order 都在 data.js。
import * as data from '../data.js';
import { state } from '../store.js';
import { $, esc, toast, confirmDialog, areaChip } from '../ui.js';
import { today } from '../dates.js';

const FILTER_KEY = 'lifeos-bucket-cat';
const fmtDay = (d) => d.replaceAll('-', '/');

export function mountBucket(root) {
  const ui = { cat: '' };
  try { ui.cat = localStorage.getItem(FILTER_KEY) || ''; } catch { /* 忽略 */ }
  let items = [];
  let loaded = false;

  root.innerHTML = `
    <header class="page-head"><h1>想做清單</h1><p class="sub" id="bk-count"></p></header>
    <section class="card bk-page">
      <form id="bk-add" class="quick-add bk-add">
        <input name="title" placeholder="想做的事，按 Enter 寫下" aria-label="想做的事" autocomplete="off" required maxlength="120">
        <input name="category" list="bk-cats" placeholder="分類（可自己打）" aria-label="分類" maxlength="30">
        <select name="area_id" aria-label="領域（可不指定）"></select>
        <button class="btn-primary">寫下</button>
      </form>
      <datalist id="bk-cats"></datalist>
      <div class="filters"><div class="seg" id="bk-filter" role="group" aria-label="依分類篩選"></div></div>
      <ol class="bk-list" id="bk-open"></ol>
      <h2 class="bk-done-head">已完成</h2>
      <ol class="bk-list bk-done" id="bk-done"></ol>
    </section>`;

  const form = $('#bk-add', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    try {
      await data.addBucket({ title: f.get('title'), category: f.get('category'), area_id: f.get('area_id') }, items);
      form.title.value = '';
      form.title.focus();
      await load();
      toast('已寫進想做清單');
    } catch (err) { toast(err.message, true); }
  });

  $('#bk-filter', root).addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    ui.cat = b.dataset.v;
    try { localStorage.setItem(FILTER_KEY, ui.cat); } catch { /* 忽略 */ }
    render();
  });

  // 勾選＝完成（先問完成日與一句話）；編輯；刪除
  const onList = async (e) => {
    const li = e.target.closest('[data-id]');
    const item = li && items.find((x) => x.id === li.dataset.id);
    if (!item) return;
    if (e.type === 'change' && e.target.matches('.bk-check')) {
      e.target.checked = false; // 存檔後才真的打勾
      openDialog(item, { completing: true });
      return;
    }
    const act = e.type === 'click' && e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') openDialog(item);
    if (act === 'delete') {
      if (!(await confirmDialog(`確定刪除「${item.title}」？此操作無法復原。`))) return;
      try { await data.deleteBucket(item.id); await load(); toast('已刪除'); } catch (err) { toast(err.message, true); }
    }
  };
  for (const id of ['#bk-open', '#bk-done']) {
    $(id, root).addEventListener('click', onList);
    $(id, root).addEventListener('change', onList);
  }

  function openDialog(item, { completing = false } = {}) {
    const dlg = $('#journal-dialog');
    const done = completing || !!item.done_on;
    dlg.innerHTML = `
      <form>
        <h2>${completing ? '完成了！' : '編輯想做的事'}</h2>
        ${completing ? `<p class="bk-dlg-title">${esc(item.title)}</p>` : `
        <label>想做的事<input name="title" required maxlength="120" value="${esc(item.title)}"></label>
        <div class="row">
          <label>分類<input name="category" list="bk-cats" maxlength="30" value="${esc(item.category || '')}"></label>
          <label>領域<select name="area_id">${areaOptions(item.area_id)}</select></label>
        </div>`}
        ${done ? `
        <label>完成日<input type="date" name="done_on" required value="${item.done_on || today()}" max="${today()}"></label>
        <label>一句話<input name="note" maxlength="200" value="${esc(item.note || '')}" placeholder="例如：終於看到極光，比想像中安靜"></label>` : ''}
        <div class="dialog-actions">
          ${!completing && item.done_on ? '<button type="button" class="btn-ghost" data-reopen style="margin-right:auto">改回未完成</button>' : ''}
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">${completing ? '打勾' : '儲存'}</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    const reopen = $('[data-reopen]', dlg);
    if (reopen) {
      reopen.onclick = () => save({ ...item, done_on: null }, '已改回想做');
    }
    f.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const next = { ...item };
      if (!completing) Object.assign(next, { title: fd.get('title'), category: fd.get('category'), area_id: fd.get('area_id') });
      if (done) Object.assign(next, { done_on: fd.get('done_on'), note: fd.get('note') });
      if (next.done_on && next.done_on > today()) return toast('完成日不能在未來', true);
      save(next, completing ? '完成 ✓ 已記下' : '已更新');
    };
    async function save(next, msg) {
      try {
        await data.saveBucket(next);
        dlg.close();
        await load();
        toast(msg);
      } catch (err) { toast(err.message, true); }
    }
    dlg.showModal();
  }

  function areaOptions(selected) {
    return `<option value="">不指定領域</option>${state.areas.map((a) =>
      `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}`;
  }

  enableBucketReorder($('#bk-open', root), () => items, load);

  async function load() {
    try {
      items = await data.listBucket();
      loaded = true;
    } catch (e) {
      toast(`讀取想做清單失敗：${e.message}`, true);
    }
    render();
  }

  function itemMeta(b) {
    return `${b.category ? `<span class="bk-cat">${esc(b.category)}</span>` : ''}${areaChip(state.areasById[b.area_id])}`;
  }

  function render() {
    const keepArea = form.area_id.value;
    form.area_id.innerHTML = areaOptions(keepArea);
    form.area_id.value = keepArea;
    const cats = data.bucketCategories(items);
    $('#bk-cats', root).innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
    const used = [...new Set(items.map((b) => b.category).filter(Boolean))];
    if (ui.cat && !used.includes(ui.cat)) ui.cat = '';
    $('#bk-filter', root).innerHTML = ['', ...used].map((c) =>
      `<button type="button" data-v="${esc(c)}" aria-pressed="${c === ui.cat}">${c ? esc(c) : '全部'}</button>`).join('');
    $('#bk-filter', root).parentElement.hidden = !used.length;

    const sorted = [...items].sort(data.compareBucket);
    const shown = sorted.filter((b) => !ui.cat || b.category === ui.cat);
    const open = shown.filter((b) => !b.done_on);
    const done = shown.filter((b) => b.done_on);
    const total = items.filter((b) => !b.done_on).length;
    $('#bk-count', root).textContent = loaded ? `想做 ${total} 件・已完成 ${items.length - total} 件` : '讀取中…';

    $('#bk-open', root).innerHTML = open.length ? open.map((b) => `
      <li class="bk-item" data-id="${b.id}" data-open>
        <button class="drag" aria-label="拖移排序：${esc(b.title)}（也可用上下鍵）" title="拖移排序">⋮⋮</button>
        <input type="checkbox" class="task-done bk-check" aria-label="完成：${esc(b.title)}">
        <div class="bk-main"><span class="bk-title">${esc(b.title)}</span><span class="bk-meta">${itemMeta(b)}</span></div>
        <span class="bk-acts"><button class="btn-ghost" data-act="edit">編輯</button><button class="btn-ghost danger" data-act="delete">刪除</button></span>
      </li>`).join('')
      : `<li class="empty">${!loaded ? '讀取中…' : items.length ? (ui.cat ? '這個分類沒有還想做的事。' : '全部完成了！再寫下一件想做的事吧。')
        : '還沒有想做的事。想去的地方、想學的東西、想體驗的事，都可以先寫下來。'}</li>`;

    $('#bk-done', root).innerHTML = done.length ? done.map((b) => `
      <li class="bk-item is-done" data-id="${b.id}">
        <span class="bk-tick" aria-hidden="true">✓</span>
        <div class="bk-main">
          <span class="bk-title"><time class="bk-date" datetime="${b.done_on}">${fmtDay(b.done_on)}</time>${esc(b.title)}</span>
          ${b.note ? `<span class="bk-note">「${esc(b.note)}」</span>` : ''}
          <span class="bk-meta">${itemMeta(b)}</span>
        </div>
        <span class="bk-acts"><button class="btn-ghost" data-act="edit">編輯</button><button class="btn-ghost danger" data-act="delete">刪除</button></span>
      </li>`).join('')
      : '<li class="empty">完成的事會以「打勾＋日期」記在這裡。</li>';
  }

  load();
  return render; // store 更新（例如領域改名）時重畫；清單本身由這頁自己讀
}

/**
 * 拖移排序（同 tasks.js 的 enableReorder，但寫 bucket_items.sort_order）：
 * 滑鼠／觸控拖把手，或聚焦把手後按上下鍵。只排未完成的。
 */
function enableBucketReorder(ul, getItems, reload) {
  let dragging = null;
  const openItems = () => [...ul.querySelectorAll(':scope > .bk-item[data-open]')];

  async function commit(li) {
    const list = openItems();
    const i = list.indexOf(li);
    const items = getItems();
    const order = data.moveBucket(items, li.dataset.id, list[i + 1]?.dataset.id, list[i - 1]?.dataset.id);
    try {
      await data.reorderBucket(order, Object.fromEntries(items.map((b) => [b.id, b])));
    } catch (e) { toast(e.message, true); }
    await reload();
  }

  ul.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag');
    if (!handle) return;
    e.preventDefault();
    dragging = handle.closest('.bk-item');
    dragging.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  ul.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const others = openItems().filter((x) => x !== dragging);
    const before = others.find((x) => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) before.before(dragging);
    else if (others.length) others.at(-1).after(dragging);
  });
  const end = () => {
    if (!dragging) return;
    const li = dragging;
    dragging = null;
    li.classList.remove('dragging');
    commit(li);
  };
  ul.addEventListener('pointerup', end);
  ul.addEventListener('pointercancel', end);
  ul.addEventListener('keydown', async (e) => {
    const handle = e.target.closest('.drag');
    if (!handle || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const li = handle.closest('.bk-item');
    const list = openItems();
    const i = list.indexOf(li);
    const target = list[e.key === 'ArrowUp' ? i - 1 : i + 1];
    if (!target) return;
    if (e.key === 'ArrowUp') target.before(li); else target.after(li);
    const id = li.dataset.id;
    await commit(li);
    ul.querySelector(`.bk-item[data-id="${id}"] .drag`)?.focus();
  });
}
