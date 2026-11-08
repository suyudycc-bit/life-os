// 標籤與分類（#/tags，20261106 G3）：一頁管理領域、看板標籤、各種自由標籤與分類。
// 資料函式都在 data.js「標籤管理 20261106（E）」段落；這裡只負責顯示與確認。
// 改名／刪除前先說明會影響幾筆並確認；更新後由資料層檢查實際筆數。
import * as data from '../data.js';
import { state, reloadAll } from '../store.js';
import { $, esc, toast, confirmDialog } from '../ui.js';

const PALETTE = ['#3b6fd8', '#8a5cd6', '#e08a2e', '#2f9e6b', '#d64f7a', '#1f9bb0', '#7a8b2e', '#b5652b', '#5560c9', '#8f6b4a'];
const FREE_SCOPES = ['note', 'media', 'bucket', 'inbox', 'contact'];
const SCOPE_HINT = {
  note: '靈感卡片上的 #標籤。改成已有的名稱＝合併；刪除只是把標籤從靈感上拿掉，靈感本身不刪。',
  media: '書影單票根上的標籤。改名、合併、刪除同靈感標籤。',
  bucket: '想做清單每一項的分類（一項一個）。刪除＝把這些項目的分類清空。',
  inbox: '待看清單每一筆的主題分類（一筆一個）。刪除＝清空分類。',
  contact: '跟進對象的標籤。改名、合併、刪除同靈感標籤。',
};

/** 頁內共用的小對話框（第一次用到時建立） */
function tagDialog() {
  let dlg = $('#tags-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'tags-dialog';
    document.body.append(dlg);
  }
  return dlg;
}
/** 顯示表單；按確定時呼叫 onOk(form)，回傳 true 才關閉。取消回傳 null */
function openForm(html, onOk) {
  const dlg = tagDialog();
  dlg.innerHTML = `<form>${html}</form>`;
  const form = $('form', dlg);
  return new Promise((resolve) => {
    const done = (v) => { dlg.oncancel = null; dlg.close(); resolve(v); };
    $('[data-cancel]', dlg).onclick = () => done(null);
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button.btn-primary', form);
      btn.disabled = true;
      try {
        const v = await onOk(form);
        if (v !== false) done(v ?? true);
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    };
    dlg.showModal();
    const first = $('input:not([type=hidden]), select', form);
    first?.focus();
    if (first?.tagName === 'INPUT') first.select(); // 改名時直接整段取代
  });
}
const actions = (ok = '儲存') => `<div class="dialog-actions"><button type="button" class="btn-ghost" data-cancel>取消</button><button class="btn-primary">${ok}</button></div>`;

export function mountTags(root) {
  const ui = { loading: false, again: false, cache: null };

  root.innerHTML = `<div class="tg-page">
    <header class="page-head"><h1>標籤與分類</h1>
      <p class="sub">各頁用到的領域、標籤、分類都在這裡整理。改名或刪除前會先告訴你影響幾筆；刪掉的看板標籤 30 天內可以在「數據與備份」的垃圾桶還原。</p></header>
    <nav class="tg-toc" aria-label="本頁目錄" id="tg-toc"></nav>
    <div id="tg-body"><p class="sub">讀取中…</p></div></div>`;
  const page = $('.tg-page', root); // 事件掛在本頁的外層（#main 會給其他頁重用）

  async function load() {
    const [areaUsage, workUsage, workTags] = await Promise.all([
      data.tagAreaUsage(), data.tagWorkUsage().catch(() => ({})), data.listWorkTags().catch(() => null),
    ]);
    const free = {};
    await Promise.all(FREE_SCOPES.map(async (s) => {
      try {
        const rows = await data.tagRows(s);
        free[s] = { rows, usage: await data.tagUsage(s, rows) };
      } catch (e) {
        free[s] = { error: e.message };
      }
    }));
    return { areaUsage, workUsage, workTags, free };
  }

  function paint(c) {
    const sections = [
      ['tg-areas', '領域'], ['tg-work', '工作看板標籤'],
      ...FREE_SCOPES.map((s) => [`tg-${s}`, data.TAG_SCOPES[s].label]),
    ];
    $('#tg-toc', root).innerHTML = sections.map(([id, l]) => `<button type="button" class="tag-btn" data-jump="${id}">${esc(l)}</button>`).join('');
    $('#tg-body', root).innerHTML = areasHTML(c) + workHTML(c) + FREE_SCOPES.map((s) => freeHTML(s, c.free[s])).join('');
  }

  function areasHTML(c) {
    const rows = state.areas.map((a) => {
      const u = c.areaUsage[a.id] || {};
      const total = Object.values(u).reduce((x, y) => x + y, 0);
      const detail = Object.entries(u).map(([t, n]) => `${data.BACKUP_LABELS[t] || t} ${n}`).join('・');
      return `<li class="tg-row">
        <span class="tg-swatch" style="--c:${esc(a.color || '#888')}" aria-hidden="true"></span>
        <span class="tg-name">${esc(a.name)} <small class="sub">${esc(data.AREA_KINDS[a.kind] || '')}${a.on_board ? '・列入工作看板' : ''}</small></span>
        <span class="tg-count" title="${esc(detail)}">${total} 筆</span>
        <span class="tg-detail sub">${esc(detail) || '沒有資料'}</span>
        <span class="tg-acts">
          <button type="button" class="btn-ghost" data-area-edit="${a.id}" aria-label="編輯領域：${esc(a.name)}">編輯</button>
          <button type="button" class="btn-ghost danger" data-area-del="${a.id}" aria-label="刪除領域：${esc(a.name)}">刪除</button>
        </span></li>`;
    }).join('');
    return `<section class="card tg-sec" id="tg-areas">
      <div class="tg-head"><h2>領域</h2><button type="button" class="btn-primary" data-area-add>＋ 新增領域</button></div>
      <p class="sub">每個任務、計時、專案、目標都掛一個領域。刪除時，掛在上面的資料要先改掛到另一個領域。</p>
      <ul class="tg-list">${rows}</ul></section>`;
  }

  function workHTML(c) {
    if (!c.workTags) return `<section class="card tg-sec" id="tg-work"><h2>工作看板標籤</h2><p class="sub">尚未啟用工作看板（需要先執行 migration 20261104）。</p></section>`;
    const block = (kind) => {
      const list = c.workTags.filter((t) => (t.kind || 'type') === kind);
      return `<div class="tg-sub">
        <h3>${esc(data.WORK_TAG_KINDS[kind])}</h3>
        <form class="tg-add" data-wt-add="${kind}">
          <input name="label" maxlength="30" placeholder="新的${esc(data.WORK_TAG_KINDS[kind])}名稱" aria-label="新增${esc(data.WORK_TAG_KINDS[kind])}">
          <button class="btn-ghost">新增</button>
        </form>
        <ul class="tg-list">${list.map((t) => `<li class="tg-row">
          <span class="tg-swatch" style="--c:${esc(t.color || '#667085')}" aria-hidden="true"></span>
          <span class="tg-name">${esc(t.label)}${t.active === false ? ' <small class="sub">（已停用）</small>' : ''}</span>
          <span class="tg-count">${c.workUsage[t.id] || 0} 件</span>
          <span class="tg-acts">
            <button type="button" class="btn-ghost" data-wt-edit="${t.id}" aria-label="改名：${esc(t.label)}">改名</button>
            <button type="button" class="btn-ghost danger" data-wt-del="${t.id}" aria-label="刪除：${esc(t.label)}">刪除</button>
          </span></li>`).join('') || '<li class="empty">還沒有。可以在上面新增，或在工作看板新增工作時直接打字建立。</li>'}</ul></div>`;
    };
    return `<section class="card tg-sec" id="tg-work"><h2>工作看板標籤</h2>
      <p class="sub">工作看板上「工作種類」與「專案標籤」（只是看板上的標籤，不會建立專案）。改成同類已有的名稱＝合併。</p>
      <div class="tg-cols">${block('type')}${block('project')}</div></section>`;
  }

  function freeHTML(scope, f) {
    const s = data.TAG_SCOPES[scope];
    const head = `<div class="tg-head"><h2>${esc(s.label)}</h2>${f.error ? '' : `<button type="button" class="btn-ghost" data-free-add="${scope}">＋ 新增</button>`}</div>`;
    if (f.error) return `<section class="card tg-sec" id="tg-${scope}">${head}<p class="sub">尚未啟用（需要先執行 migration 20261106）。</p></section>`;
    const empty = f.rows.length
      ? `還沒有${s.array ? '標籤' : '分類'}。按「＋ 新增」可以把新的${s.array ? '標籤' : '分類'}套到幾筆資料上。`
      : `目前還沒有資料；之後有資料時，這裡會列出用到的${s.array ? '標籤' : '分類'}。`;
    return `<section class="card tg-sec" id="tg-${scope}">${head}
      <p class="sub">${esc(SCOPE_HINT[scope])}</p>
      <ul class="tg-list">${f.usage.map((u) => `<li class="tg-row">
        <span class="tg-name">${s.array ? '#' : ''}${esc(u.name)}</span>
        <span class="tg-count">${u.count} ${esc(s.unit.slice(0, 1))}</span>
        <span class="tg-acts">
          <button type="button" class="btn-ghost" data-free-ren="${scope}" data-name="${esc(u.name)}" aria-label="改名：${esc(u.name)}">改名</button>
          <button type="button" class="btn-ghost danger" data-free-del="${scope}" data-name="${esc(u.name)}" aria-label="刪除：${esc(u.name)}">刪除</button>
        </span></li>`).join('') || `<li class="empty">${empty}</li>`}</ul></section>`;
  }

  // ---- 動作 ----
  const after = async (msg) => {
    toast(msg);
    await reloadAll(); // 其他頁面（靈感、書影單、任務的領域…）看到同一份更新後的資料；也會觸發本頁重讀
  };

  async function editArea(area) {
    const a = area || { name: '', kind: 'life', color: PALETTE.find((p) => !state.areas.some((x) => x.color === p)) || PALETTE[0] };
    const res = await openForm(`<h2>${area ? '編輯領域' : '新增領域'}</h2>
      <label>名稱<input name="name" required maxlength="30" value="${esc(a.name)}"></label>
      <div class="row">
        <label>類型<select name="kind">${Object.entries(data.AREA_KINDS).map(([k, l]) => `<option value="${k}" ${k === a.kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label>顏色<input type="color" name="color" value="${esc(a.color || '#888888')}"></label>
      </div>
      <p class="sub">顏色用在任務標籤、日曆與圖表；改名不影響任何資料的歸屬。</p>${actions(area ? '儲存' : '建立')}`, async (f) => {
      await data.tagSaveArea({ id: area?.id, name: f.name.value, kind: f.kind.value, color: f.color.value }, state.areas);
      return area ? '已更新領域' : '已新增領域';
    });
    if (res) await after(res);
  }

  async function deleteArea(area, usage) {
    const u = usage[area.id] || {};
    const total = Object.values(u).reduce((x, y) => x + y, 0);
    if (state.areas.length <= 1) { toast('至少要保留一個領域', true); return; }
    if (!total) {
      if (!(await confirmDialog(`刪除領域「${area.name}」？目前沒有任何資料掛在上面。領域刪除後不進垃圾桶。`))) return;
      try { await data.tagDeleteArea(area.id, null, state.areas); await after('已刪除領域'); } catch (e) { toast(e.message, true); }
      return;
    }
    const others = state.areas.filter((x) => x.id !== area.id);
    const list = Object.entries(u).map(([t, n]) => `<li>${esc(data.BACKUP_LABELS[t] || t)} ${n} 筆</li>`).join('');
    const ok = await openForm(`<h2>刪除領域「${esc(area.name)}」</h2>
      <p>還有 <b>${total}</b> 筆資料掛在這個領域，${data.TAG_AREA_REFS.some((r) => r.restrict && u[r.table]) ? '直接刪除會被擋下（任務、計時、專案、目標不能沒有領域）' : '直接刪除會讓它們變成沒有領域'}：</p>
      <ul class="tg-impact">${list}</ul>
      <label>先把這 ${total} 筆改掛到<select name="to">${others.map((o) => `<option value="${o.id}">${esc(o.name)}${o.on_board !== area.on_board ? (o.on_board ? '（工作看板）' : '（生活）') : ''}</option>`).join('')}</select></label>
      <p class="sub">${area.on_board ? '這個領域列入工作看板；改掛到生活領域的任務會離開看板、改到任務管理。' : '改掛到列入工作看板的領域時，那些任務會改在工作看板顯示。'}領域刪除後不進垃圾桶。</p>
      ${actions(`改掛 ${total} 筆並刪除`)}`, async (f) => {
      const to = state.areasById[f.to.value];
      const { moved } = await data.tagDeleteArea(area.id, f.to.value, state.areas);
      const n = Object.values(moved).reduce((x, y) => x + y, 0);
      return `已把 ${n} 筆改掛到「${to?.name}」，並刪除「${area.name}」`;
    });
    if (ok) await after(ok);
  }

  async function addWorkTag(kind, input) {
    const label = input.value.trim();
    if (!label) { input.focus(); return; }
    if (ui.cache.workTags.some((t) => (t.kind || 'type') === kind && t.label === label)) { toast(`已有「${label}」`, true); return; }
    try {
      await data.saveWorkTag({ label, kind });
      await after(`已新增${data.WORK_TAG_KINDS[kind]}「${label}」`);
    } catch (e) { toast(e.message, true); }
  }

  async function editWorkTag(tag) {
    const kind = tag.kind || 'type';
    const n = ui.cache.workUsage[tag.id] || 0;
    const res = await openForm(`<h2>改名：${esc(tag.label)}</h2>
      <label>名稱<input name="label" required maxlength="30" value="${esc(tag.label)}"></label>
      <label>顏色<input type="color" name="color" value="${esc(tag.color || '#667085')}"></label>
      <p class="sub">${n} 件工作用這個${esc(data.WORK_TAG_KINDS[kind])}，改名後一起改。改成同類已有的名稱會合併（舊的那個進垃圾桶）。</p>${actions()}`, async (f) => {
      const label = f.label.value.trim();
      const same = ui.cache.workTags.find((t) => t.id !== tag.id && (t.kind || 'type') === kind && t.label === label);
      if (same) {
        if (!(await confirmDialog(`已有「${label}」。把 ${n} 件工作改用「${label}」，並把「${tag.label}」移到垃圾桶？`, '合併'))) return false;
        const m = await data.tagMergeWorkTag(tag, same);
        return `已合併：${m} 件工作改用「${label}」`;
      }
      await data.saveWorkTag({ id: tag.id, label, color: f.color.value, kind });
      return '已更新';
    });
    if (res) await after(res);
  }

  async function deleteWorkTag(tag) {
    const n = ui.cache.workUsage[tag.id] || 0;
    if (!(await confirmDialog(`刪除${data.WORK_TAG_KINDS[tag.kind || 'type']}「${tag.label}」？${n ? `${n} 件工作會取消這個標籤（工作本身不刪）。` : '目前沒有工作用它。'}30 天內可在垃圾桶還原。`))) return;
    try { await data.deleteWorkTag(tag.id); await after(`已刪除「${tag.label}」，可在垃圾桶還原`); } catch (e) { toast(e.message, true); }
  }

  async function renameFree(scope, name) {
    const s = data.TAG_SCOPES[scope];
    const f = ui.cache.free[scope];
    const n = f.usage.find((u) => u.name === name)?.count || 0;
    const res = await openForm(`<h2>改名：${s.array ? '#' : ''}${esc(name)}</h2>
      <label>新名稱<input name="to" required maxlength="30" value="${esc(name)}" list="tg-names"></label>
      <datalist id="tg-names">${f.usage.filter((u) => u.name !== name).map((u) => `<option value="${esc(u.name)}">`).join('')}</datalist>
      <p class="sub">會改 ${n} ${esc(s.unit)}。改成已有的名稱＝合併。</p>${actions('改名')}`, async (form) => {
      const to = form.to.value.trim().replace(/^#+/, '');
      if (to === name) return '名稱沒有變';
      const merge = f.usage.some((u) => u.name === to);
      const affected = (await data.tagAffected(scope, name)).length;
      if (!(await confirmDialog(`${merge ? `合併到已有的「${to}」` : `改名為「${to}」`}，共 ${affected} ${s.unit}會更新。確定？`, merge ? '合併' : '改名'))) return false;
      const done = await data.tagRename(scope, name, to);
      return `已${merge ? '合併' : '改名'}，更新 ${done} 筆`;
    });
    if (res) await after(res);
  }

  async function deleteFree(scope, name) {
    const s = data.TAG_SCOPES[scope];
    const affected = (await data.tagAffected(scope, name)).length;
    if (!(await confirmDialog(`從 ${affected} ${s.unit}${s.array ? '移除標籤' : '清空分類'}「${name}」？資料本身不會刪除。`))) return;
    try { const n = await data.tagDelete(scope, name); await after(`已從 ${n} 筆移除「${name}」`); } catch (e) { toast(e.message, true); }
  }

  async function addFree(scope) {
    const s = data.TAG_SCOPES[scope];
    const f = ui.cache.free[scope];
    if (!f.rows.length) { toast(`目前沒有任何資料可以套用${s.array ? '標籤' : '分類'}`, true); return; }
    const items = f.rows.map((r) => ({ r, t: s.title(r) || '（未命名）' })).sort((a, b) => a.t.localeCompare(b.t, 'zh-Hant'));
    const res = await openForm(`<h2>新增${esc(s.label)}</h2>
      <label>名稱<input name="name" required maxlength="30"></label>
      <fieldset class="tg-pick"><legend>套用到哪幾筆（${s.array ? '加上這個標籤' : '分類會改成這個'}）</legend>
        <ul>${items.map(({ r, t }) => `<li><label class="check"><input type="checkbox" name="ids" value="${r.id}"> ${esc(t)}
          ${!s.array && r[s.col] ? `<small class="sub">（目前：${esc(r[s.col])}）</small>` : ''}</label></li>`).join('')}</ul>
      </fieldset>${actions('套用')}`, async (form) => {
      const ids = [...form.querySelectorAll('input[name=ids]:checked')].map((x) => x.value);
      if (!ids.length) throw new Error('請至少勾選一筆');
      const replacing = s.array ? 0 : f.rows.filter((r) => ids.includes(r.id) && r[s.col] && r[s.col] !== form.name.value.trim()).length;
      if (replacing && !(await confirmDialog(`其中 ${replacing} 筆原本有別的分類，會被改成「${form.name.value.trim()}」。確定套用到 ${ids.length} 筆？`, '套用'))) return false;
      const n = await data.tagAdd(scope, form.name.value, ids);
      return `已套用到 ${n} 筆`;
    });
    if (res) await after(res);
  }

  page.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || !ui.cache) return;
    const c = ui.cache;
    if (b.dataset.jump) { document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
    if ('areaAdd' in b.dataset) return editArea(null);
    if (b.dataset.areaEdit) return editArea(state.areasById[b.dataset.areaEdit]);
    if (b.dataset.areaDel) return deleteArea(state.areasById[b.dataset.areaDel], c.areaUsage);
    if (b.dataset.wtEdit) return editWorkTag(c.workTags.find((t) => t.id === b.dataset.wtEdit));
    if (b.dataset.wtDel) return deleteWorkTag(c.workTags.find((t) => t.id === b.dataset.wtDel));
    if (b.dataset.freeAdd) return addFree(b.dataset.freeAdd);
    if (b.dataset.freeRen) return renameFree(b.dataset.freeRen, b.dataset.name);
    if (b.dataset.freeDel) return deleteFree(b.dataset.freeDel, b.dataset.name);
  });
  page.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-wt-add]');
    if (!f) return;
    e.preventDefault();
    addWorkTag(f.dataset.wtAdd, f.label);
  });

  // 資料更新時重讀（同時有多次通知只跑一次，跑完若又有通知再跑一次）
  async function render() {
    if (ui.loading) { ui.again = true; return; }
    ui.loading = true;
    try {
      ui.cache = await load();
      if (page.isConnected) paint(ui.cache);
    } catch (e) {
      if (page.isConnected) $('#tg-body', root).innerHTML = `<p class="warn">讀取失敗：${esc(e.message)}</p>`;
    } finally {
      ui.loading = false;
      if (ui.again) { ui.again = false; render(); }
    }
  }
  return render;
}
