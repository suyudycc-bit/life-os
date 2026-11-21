// 飲食與保健（20261116，來自回饋 ec337946）：每天的飲食紀錄＋保健食品打勾，下方是近 7 天統計。
// 資料在 meal_logs、supplements、supplement_logs（不在 store，這頁自己讀）；存取與統計都在 data.js「飲食與保健」段。
import * as data from '../data.js?v=202611220214';
import { $, esc, toast, confirmDialog } from '../ui.js?v=202611220214';
import { today, addDays, formatShort } from '../dates.js?v=202611220214';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const dow = (d) => new Date(`${d}T00:00:00`).getDay();

export function mountHealth(root) {
  buildHealth(root, { page: true });
  return () => {}; // 資料不在 store；新增／修改後自己重讀
}

/**
 * 20261121（使用者：點日曆的一天就能把那天的事做完）：日曆的當日區塊嵌入同一套飲食＋保健食品（不另寫一份）。
 * 回傳 { setDay(day) }；同一天重複呼叫不會重讀。
 */
export function mountHealthDay(el, day) {
  return buildHealth(el, { page: false, day });
}

function buildHealth(root, { page, day = today() }) {
  const ui = { day };
  let meals = [];
  let supps = [];
  let logs = [];
  let weekMeals = [];
  let loaded = false;

  root.innerHTML = `${page ? `
    <header class="page-head hl-head">
      <div><h1>飲食與保健</h1><p class="sub" id="hl-date"></p></div>
      <div class="hl-nav">
        <button type="button" class="btn-ghost" id="hl-prev" aria-label="前一天">‹</button>
        <input type="date" id="hl-day" aria-label="選日期">
        <button type="button" class="btn-ghost" id="hl-next" aria-label="後一天">›</button>
        <button type="button" class="btn-ghost" id="hl-today">今天</button>
      </div>
    </header>` : ''}
    <div class="hl-grid">
      <section class="card">
        <div class="day-head"><h2>飲食</h2><span class="sub" id="hl-meal-n"></span></div>
        <form id="hl-add" class="hl-add">
          <select name="meal" aria-label="哪一餐">${Object.entries(data.MEALS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <input name="eaten_at" type="time" aria-label="幾點（可留白）">
          <input name="foods" required maxlength="1000" placeholder="吃了什麼，例如：地瓜、茶葉蛋、無糖豆漿" aria-label="吃了什麼" autocomplete="off">
          <input name="note" maxlength="1000" placeholder="備註／感受（可留白）" aria-label="備註">
          <button class="btn-primary">記下</button>
        </form>
        <div id="hl-meals"></div>
      </section>
      <section class="card">
        <div class="day-head"><h2>保健食品 <span class="sub" id="hl-supp-n"></span></h2><button type="button" class="btn-ghost" id="hl-supp-new">＋ 新增保健食品</button></div>
        <div id="hl-supps"></div>
      </section>
    </div>${page ? `
    <section class="card">
      <div class="day-head"><h2>近 7 天</h2><span class="sub">到這一天為止</span></div>
      <div id="hl-week"></div>
    </section>` : ''}`;

  const form = $('#hl-add', root);
  form.meal.value = data.guessMeal();

  const go = (d) => { ui.day = d; load(); };
  if (page) {
    $('#hl-prev', root).onclick = () => go(addDays(ui.day, -1));
    $('#hl-next', root).onclick = () => go(addDays(ui.day, 1));
    $('#hl-today', root).onclick = () => go(today());
    $('#hl-day', root).onchange = (e) => { if (e.target.value) go(e.target.value); };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await data.saveMeal({ entry_date: ui.day, meal: form.meal.value, eaten_at: form.eaten_at.value, foods: form.foods.value, note: form.note.value });
      const keep = form.meal.value;
      form.reset();
      form.meal.value = keep;
      form.foods.focus();
      await load();
      toast('已記下');
    } catch (err) { toast(err.message, true); }
  });

  $('#hl-meals', root).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-id]');
    const m = li && meals.find((x) => x.id === li.dataset.id);
    if (!m) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'edit') openMealDialog(m);
      if (act === 'del') {
        if (!(await confirmDialog(`刪除這筆飲食紀錄？（30 天內可在「數據與備份」的垃圾桶還原）`, '刪除'))) return;
        await data.deleteMeal(m.id);
        await load();
        toast('已移到垃圾桶');
      }
    } catch (err) { toast(err.message, true); }
  });

  $('#hl-supp-new', root).onclick = () => openSuppDialog(null);
  $('#hl-supps', root).addEventListener('change', async (e) => {
    const cb = e.target.closest('[data-take]');
    if (!cb) return;
    const [id, slot] = cb.dataset.take.split('|');
    cb.disabled = true;
    try {
      await data.setSupplementTaken(id, ui.day, slot, cb.checked);
      await load();
    } catch (err) {
      cb.checked = !cb.checked;
      toast(err.message, true);
    } finally { cb.disabled = false; }
  });
  $('#hl-supps', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-supp-edit]');
    const sp = b && supps.find((x) => x.id === b.dataset.suppEdit);
    if (sp) openSuppDialog(sp);
  });

  function dialogEl() {
    let dlg = $('#health-dialog');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'health-dialog'; document.body.append(dlg); }
    return dlg;
  }

  function openMealDialog(m) {
    const dlg = dialogEl();
    dlg.innerHTML = `
      <form class="hl-form">
        <h2>修改飲食紀錄</h2>
        <div class="hl-row">
          <label>日期<input type="date" name="entry_date" required value="${m.entry_date}"></label>
          <label>哪一餐<select name="meal">${Object.entries(data.MEALS).map(([k, l]) => `<option value="${k}" ${k === m.meal ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>幾點<input type="time" name="eaten_at" value="${esc((m.eaten_at || '').slice(0, 5))}"></label>
        </div>
        <label>吃了什麼<textarea name="foods" rows="3" required maxlength="1000">${esc(m.foods)}</textarea></label>
        <label>備註／感受<textarea name="note" rows="2" maxlength="1000">${esc(m.note || '')}</textarea></label>
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
        await data.saveMeal({ id: m.id, entry_date: f.entry_date.value, meal: f.meal.value, eaten_at: f.eaten_at.value, foods: f.foods.value, note: f.note.value });
        dlg.close();
        await load();
        toast('已儲存');
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
  }

  function openSuppDialog(sp) {
    const dlg = dialogEl();
    const slots = sp?.slots || ['morning'];
    dlg.innerHTML = `
      <form class="hl-form">
        <h2>${sp ? '修改保健食品' : '新增保健食品'}</h2>
        <label>名稱<input name="name" required maxlength="80" value="${esc(sp?.name || '')}" placeholder="例如：魚油、維生素 D、益生菌"></label>
        <label>一次的量（可留白）<input name="dose" maxlength="40" value="${esc(sp?.dose || '')}" placeholder="例如：1 顆、2 粒、5ml"></label>
        <fieldset class="hl-slots"><legend>什麼時候吃（可複選）</legend>
          ${Object.entries(data.SUPP_SLOTS).map(([k, l]) => `<label class="check"><input type="checkbox" name="slot" value="${k}" ${slots.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}
        </fieldset>
        <label>備註（可留白）<input name="note" maxlength="500" value="${esc(sp?.note || '')}" placeholder="例如：飯後吃、和鈣片隔開"></label>
        ${sp ? `<label class="check"><input type="checkbox" name="active" ${sp.active ? 'checked' : ''}> 還在吃（取消勾選＝停用，不出現在每天的清單，紀錄保留）</label>` : ''}
        <div class="dialog-actions">
          ${sp ? '<button type="button" class="btn-ghost danger" data-del>刪除</button>' : ''}
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    const del = $('[data-del]', dlg);
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`刪除「${sp.name}」和它所有的打勾紀錄？（30 天內可在「數據與備份」的垃圾桶還原；只是不吃了的話，取消「還在吃」就好）`, '刪除'))) return;
      try { await data.deleteSupplement(sp.id); dlg.close(); await load(); toast('已移到垃圾桶'); } catch (err) { toast(err.message, true); }
    };
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await data.saveSupplement({ id: sp?.id, name: f.name.value, dose: f.dose.value, note: f.note.value,
          slots: [...f.querySelectorAll('[name=slot]:checked')].map((x) => x.value), active: sp ? f.active.checked : true });
        dlg.close();
        await load();
        toast(sp ? '已儲存' : '已新增，之後每天都會出現在清單裡');
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
  }

  function render() {
    const d = ui.day;
    if (page) {
      $('#hl-day', root).value = d;
      $('#hl-date', root).textContent = `${formatShort(d)}（週${WEEK[dow(d)]}）${d === today() ? '・今天' : ''}`;
    }
    if (!loaded) { $('#hl-meals', root).innerHTML = '<p class="sub">載入中…</p>'; return; }
    // 飲食
    const by = data.mealsByType(meals);
    $('#hl-meal-n', root).textContent = meals.length ? `${meals.length} 筆` : '';
    $('#hl-meals', root).innerHTML = meals.length ? Object.entries(data.MEALS).filter(([k]) => by[k].length).map(([k, label]) => `
      <div class="hl-meal"><h3>${label}</h3><ul>${by[k].map((m) => `
        <li data-id="${m.id}">
          ${m.eaten_at ? `<span class="hl-time">${esc(m.eaten_at.slice(0, 5))}</span>` : ''}
          <span class="hl-foods">${esc(m.foods)}${m.note ? `<small class="sub">${esc(m.note)}</small>` : ''}</span>
          <span class="hl-acts"><button type="button" class="btn-ghost" data-act="edit">修改</button><button type="button" class="btn-ghost danger" data-act="del" aria-label="刪除">✕</button></span>
        </li>`).join('')}</ul></div>`).join('') : '<p class="empty">這一天還沒有飲食紀錄。</p>';
    // 保健食品
    const active = supps.filter((s) => s.active);
    const taken = new Set(logs.filter((l) => l.log_date === d).map((l) => `${l.supplement_id}|${l.slot}`));
    // 20261121（使用者：保健食品一多，空間被拉很長）：改成表格——時段只在表頭寫一次，一種保健食品一列
    const slotKeys = Object.keys(data.SUPP_SLOTS).filter((sl) => active.some((s) => s.slots.includes(sl)));
    const due = active.reduce((n, s) => n + s.slots.length, 0);
    const done = active.reduce((n, s) => n + s.slots.filter((sl) => taken.has(`${s.id}|${sl}`)).length, 0);
    $('#hl-supp-n', root).textContent = due ? `${done}／${due}` : '';
    $('#hl-supps', root).innerHTML = active.length ? `<table class="hl-supp-table">
      <thead><tr><th scope="col"><span class="sr-only">保健食品</span></th>${slotKeys.map((sl) => `<th scope="col">${data.SUPP_SLOTS[sl]}</th>`).join('')}</tr></thead>
      <tbody>${active.map((s) => `<tr>
        <th scope="row"><button type="button" class="hl-link" data-supp-edit="${s.id}" title="${esc(s.note ? `${s.note}（點一下修改）` : '點一下修改')}">${esc(s.name)}</button>${s.dose ? `<span class="sub">${esc(s.dose)}</span>` : ''}</th>
        ${slotKeys.map((sl) => `<td>${s.slots.includes(sl)
          ? `<input type="checkbox" data-take="${s.id}|${sl}" ${taken.has(`${s.id}|${sl}`) ? 'checked' : ''} aria-label="${esc(s.name)} ${data.SUPP_SLOTS[sl]}">`
          : '<span class="hl-na" aria-hidden="true">·</span>'}</td>`).join('')}
      </tr>`).join('')}</tbody></table>`
      : '<p class="empty">還沒有保健食品。按右上「＋ 新增保健食品」設定名稱和什麼時候吃，之後每天在這裡打勾。</p>';
    const off = supps.filter((s) => !s.active);
    if (off.length) $('#hl-supps', root).insertAdjacentHTML('beforeend', `<p class="sub hl-off">已停用：${off.map((s) => `<button type="button" class="hl-link" data-supp-edit="${s.id}">${esc(s.name)}</button>`).join('、')}</p>`);
    if (!page) return;
    // 近 7 天
    const st = data.healthStats(supps, logs, weekMeals, d, 7);
    $('#hl-week', root).innerHTML = `
      <div class="hl-week-meals">${st.mealDays.map((x) => `<div class="${x.day === d ? 'is-now' : ''}"><span class="sub">${formatShort(x.day)}（${WEEK[dow(x.day)]}）</span><b>${x.count}</b><small>餐</small></div>`).join('')}</div>
      ${st.supp.length ? `<ul class="hl-week-supp">${st.supp.map((x) => `<li><span>${esc(x.supp.name)}</span>
        <span class="progress-bar" role="img" aria-label="吃了 ${x.taken}／${x.planned} 次"><span style="width:${x.pct ?? 0}%"></span></span>
        <span class="sub">${x.planned ? `${x.taken}／${x.planned} 次` : '—'}</span></li>`).join('')}</ul>` : ''}`;
  }

  async function load() {
    const d = ui.day;
    render();
    try {
      const from = addDays(d, -6);
      const [m7, s, l] = await Promise.all([data.listMeals(from, d), data.listSupplements(), data.listSupplementLogs(from, d)]);
      if (ui.day !== d) return; // 讀取途中換日了
      weekMeals = m7;
      meals = m7.filter((m) => m.entry_date === d);
      supps = s;
      logs = l;
      loaded = true;
    } catch (err) {
      $('#hl-meals', root).innerHTML = `<p class="warn">讀取失敗：${esc(err.message)}（如果是第一次使用，需要先執行 migration 20261116_health.sql）</p>`;
      return;
    }
    render();
  }
  load();
  return { setDay: (d) => { if (d !== ui.day) go(d); } };
}
