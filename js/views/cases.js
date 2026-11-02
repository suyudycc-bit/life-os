// 案件總覽（Phase W4，工作看板的第二個分頁）：一個案件＝一個工作任務，含已完成的
// 搜尋、篩選、排序、案件歷程（進度紀錄＋計時）、重複案件合併。搬自舊看板「案件總覽」（docs/08）。
import * as data from '../data.js';
import { state, refreshTasks } from '../store.js';
import { $, esc, toast, confirmDialog, linkify, linkLabel, formatDateTime } from '../ui.js';
import { formatShort, formatHMS } from '../dates.js';
import { openTaskEditor, openMemoDialog } from './task-actions.js';

const PAGE = 50;
const FILTER_KEY = 'lifeos-cases-filter';
const f = { q: '', status: 'open', projectId: '', workTypeId: '', sort: 'recent' };
try { Object.assign(f, JSON.parse(localStorage.getItem(FILTER_KEY) || '{}')); } catch { /* 忽略 */ }
const saveF = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* 忽略 */ } };
let shown = PAGE;

const statusLabel = (t) => ({ todo: '待辦', doing: '進行中', done: '已完成', dropped: '放棄' })[t.status];

/** 在 box 裡畫案件總覽；回傳 render（資料更新時重畫，保留搜尋框焦點） */
export function mountCases(box) {
  box.innerHTML = `
    <section class="card cs-filters">
      <input type="search" id="cs-q" placeholder="搜尋案件編號、名稱、進度、連結…" aria-label="搜尋案件" value="${esc(f.q)}">
      <div class="cs-row">
        <select id="cs-status" aria-label="狀態">${Object.entries(data.CASE_STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        <select id="cs-project" aria-label="專案"></select>
        <select id="cs-type" aria-label="工作種類"></select>
        <select id="cs-sort" aria-label="排序">
          <option value="recent">最近有動靜</option><option value="case">案件編號（新到舊）</option><option value="created">建立日期（新到舊）</option>
        </select>
      </div>
    </section>
    <section class="card cs-merge" id="cs-merge" hidden></section>
    <p class="sub cs-count" id="cs-count"></p>
    <div class="table-wrap"><table class="table cs-table">
      <thead><tr><th>案件</th><th>工作</th><th>狀態</th><th>種類／專案</th><th>最近</th><th>進度</th></tr></thead>
      <tbody id="cs-body"></tbody></table></div>
    <div class="dialog-actions cs-more"><button type="button" class="btn-ghost" id="cs-more" hidden>顯示更多</button></div>`;

  const set = (patch) => { Object.assign(f, patch); shown = PAGE; saveF(); render(); };
  $('#cs-q', box).addEventListener('input', (e) => set({ q: e.target.value }));
  $('#cs-status', box).onchange = (e) => set({ status: e.target.value });
  $('#cs-project', box).onchange = (e) => set({ projectId: e.target.value });
  $('#cs-type', box).onchange = (e) => set({ workTypeId: e.target.value });
  $('#cs-sort', box).onchange = (e) => set({ sort: e.target.value });
  $('#cs-more', box).onclick = () => { shown += PAGE; render(); };
  $('#cs-body', box).addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (row && !e.target.closest('a')) openCase(row.dataset.id);
  });
  $('#cs-body', box).addEventListener('keydown', (e) => {
    const row = e.target.closest('[data-id]');
    if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCase(row.dataset.id); }
  });
  $('#cs-merge', box).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-merge]');
    if (!b) return;
    const group = mergeGroups.find((g) => g[0].task.id === b.dataset.merge);
    if (group) await mergeGroup(group);
  });

  let mergeGroups = [];
  function render() {
    const rows = data.caseRows(state.tasks, state.areasById, state.memosByTask, state.projects, state.workTags);
    const boardAreaIds = new Set(data.boardAreas(state.areas).map((a) => a.id));
    $('#cs-status', box).value = f.status;
    $('#cs-sort', box).value = f.sort;
    $('#cs-project', box).innerHTML = `<option value="">全部專案</option>${state.projects.filter((p) => boardAreaIds.has(p.area_id))
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}`;
    $('#cs-project', box).value = f.projectId;
    $('#cs-type', box).innerHTML = `<option value="">全部種類</option>${state.workTags.map((w) => `<option value="${w.id}">${esc(w.label)}</option>`).join('')}`;
    $('#cs-type', box).value = f.workTypeId;

    const list = data.filterCases(rows, f);
    $('#cs-count', box).textContent = `共 ${rows.length} 個案件，符合條件 ${list.length} 個`;
    $('#cs-body', box).innerHTML = list.length ? list.slice(0, shown).map((r) => {
      const t = r.task;
      const link = (t.links || [])[0];
      return `<tr data-id="${t.id}" tabindex="0" title="看案件歷程">
        <td class="cs-no">${esc(t.case_no || '—')}</td>
        <td class="cs-title">${esc(t.title)}${link ? ` <a class="link-chip" href="${esc(link)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(linkLabel(link))}</a>` : ''}</td>
        <td><span class="cs-st st-${t.status}">${statusLabel(t)}</span></td>
        <td class="cs-tags">${esc([r.workType, r.project].filter(Boolean).join('・') || '—')}</td>
        <td>${formatShort(r.lastDay)}</td>
        <td>${r.memoCount ? `${r.memoCount} 則` : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">沒有符合條件的案件。換個條件，或清空搜尋。</td></tr>';
    $('#cs-more', box).hidden = list.length <= shown;

    mergeGroups = data.mergeSuggestions(rows.filter((r) => r.task.status !== 'dropped'));
    const m = $('#cs-merge', box);
    m.hidden = !mergeGroups.length;
    m.innerHTML = mergeGroups.length ? `
      <h2>可能重複的案件 <span class="count">${mergeGroups.length}</span></h2>
      <p class="sub">同一個工作名稱卻有好幾個案件編號。合併後會保留最早的編號，其他案件的進度紀錄與計時搬過去、連結合併，然後刪掉重複的。</p>
      <ul class="cs-merge-list">${mergeGroups.map((g) => `<li>
        <span><b>${esc(g[0].task.title)}</b>　<span class="sub">${g.map((r) => `${esc(r.task.case_no || '無編號')}（${statusLabel(r.task)}）`).join('、')}</span></span>
        <button type="button" class="btn-timer" data-merge="${g[0].task.id}">合併成 ${esc(g[0].task.case_no || '第一個')}</button></li>`).join('')}</ul>` : '';
  }

  async function mergeGroup(group) {
    const [keep, ...drops] = group.map((r) => r.task);
    const memoN = drops.reduce((n, t) => n + (state.memosByTask[t.id] || []).length, 0);
    const msg = `把 ${drops.map((t) => t.case_no || '（無編號）').join('、')} 合併到 ${keep.case_no || '保留的案件'}？`
      + `\n會搬 ${memoN} 則進度紀錄與這些案件的計時，合併連結，然後刪除 ${drops.length} 個重複案件。`;
    if (!(await confirmDialog(msg, '合併'))) return;
    try {
      const r = await data.mergeCases(keep, drops);
      await refreshTasks();
      toast(`已合併：搬了 ${r.memos} 則進度、${r.entries} 筆計時，刪除 ${r.deleted} 個重複案件`);
    } catch (err) { toast(`合併失敗：${err.message}`, true); }
  }

  render();
  return render;
}

/** 案件歷程：基本資料、進度紀錄（時間軸）、計時 */
export async function openCase(taskId) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const dlg = $('#case-dialog');
  dlg.innerHTML = `<div class="digest"><h2>${esc(t.case_no || '')} ${esc(t.title)}</h2><p class="sub">載入中…</p></div>`;
  if (!dlg.open) dlg.showModal();
  let entries = [];
  try { entries = (await data.listEntriesForTask(t.id)).filter((e) => e.ended_at); } catch { /* 計時讀不到時只顯示其他資料 */ }
  const memos = state.memosByTask[t.id] || [];
  const project = state.projects.find((p) => p.id === t.project_id)?.name;
  const workType = state.workTags.find((w) => w.id === t.work_type_id)?.label;
  const due = data.taskDay(t);
  const total = entries.reduce((n, e) => n + data.entrySeconds(e), 0);
  const facts = [
    ['狀態', statusLabel(t)], ['工作種類', workType], ['專案', project], ['建立', formatDateTime(t.created_at)],
    ['預定', due && formatShort(due)], ['完成', t.completed_at && formatDateTime(t.completed_at)], ['累計用時', total ? formatHMS(total) : null],
  ].filter(([, v]) => v);
  dlg.innerHTML = `
    <div class="digest cs-detail">
      <h2><span class="wb-case">${esc(t.case_no || '')}</span> ${esc(t.title)}</h2>
      <dl class="cs-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      ${(t.links || []).length ? `<p class="wb-links">${t.links.map((u) => `<a class="link-chip" href="${esc(u)}" target="_blank" rel="noopener noreferrer">🔗 ${esc(linkLabel(u))}</a>`).join('')}</p>` : ''}
      ${t.notes ? `<p class="cs-notes">${linkify(t.notes)}</p>` : ''}
      <section><h3>進度紀錄 <span class="count">${memos.length}</span></h3>
        <ol class="cs-timeline">${memos.length ? memos.map((m) => `<li><time>${formatDateTime(m.created_at)}</time><div>${linkify(m.body)}</div></li>`).join('')
          : '<li class="sub">還沒有進度紀錄</li>'}</ol></section>
      ${entries.length ? `<section><h3>計時 <span class="count">${entries.length}</span></h3>
        <ul class="cs-entries">${entries.slice(0, 20).map((e) => `<li>${formatDateTime(e.started_at)}<span>${formatHMS(data.entrySeconds(e))}</span></li>`).join('')}</ul></section>` : ''}
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-close>關閉</button>
        <button type="button" class="btn-timer" data-memo>新增進度</button>
        <button type="button" class="btn-primary" data-edit>編輯</button>
      </div>
    </div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('[data-edit]', dlg).onclick = () => { dlg.close(); openTaskEditor(t); };
  $('[data-memo]', dlg).onclick = () => { dlg.close(); openMemoDialog(t.id); };
}

/** 常用詞組：一鍵複製；可新增、修改、刪除（搬自舊看板） */
export async function openPhrases() {
  const dlg = $('#phrase-dialog');
  dlg.innerHTML = '<div class="digest"><h2>常用詞組</h2><p class="sub">載入中…</p></div>';
  if (!dlg.open) dlg.showModal();
  let phrases;
  try { phrases = await data.listPhrases(); } catch (err) {
    dlg.querySelector('.sub').textContent = `讀不到常用詞組：${err.message}（需要執行 migration 20261104）`;
    return;
  }
  let editing = null;
  const render = () => {
    dlg.innerHTML = `
      <div class="digest">
        <h2>常用詞組</h2>
        <p class="sub">點詞組就會複製，可以貼到進度紀錄、信件或 Teams。</p>
        <ul class="ph-list">${phrases.length ? phrases.map((p) => `<li data-id="${p.id}">
          ${editing === p.id
            ? `<form class="ph-edit"><textarea name="body" rows="2" required maxlength="2000">${esc(p.body)}</textarea>
                <div class="dialog-actions"><button type="button" class="btn-ghost" data-cancel>取消</button><button class="btn-primary">儲存</button></div></form>`
            : `<button type="button" class="ph-copy" data-copy title="點一下複製">${esc(p.body)}</button>
               <span class="ph-actions"><button type="button" class="btn-ghost" data-edit>修改</button><button type="button" class="btn-ghost danger" data-del>刪除</button></span>`}
        </li>`).join('') : '<li class="empty">還沒有常用詞組。在下面新增第一個，例如「已寄出信件，等待回覆」。</li>'}</ul>
        <form class="ph-add"><input name="body" placeholder="新增一個常用詞組" aria-label="新增常用詞組" required maxlength="2000"><button class="btn-timer">新增</button></form>
        <div class="dialog-actions"><button type="button" class="btn-primary" data-close>完成</button></div>
      </div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    $('.ph-add', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try { phrases.push(await data.savePhrase({ body: e.target.body.value }, phrases)); render(); $('.ph-add input', dlg).focus(); }
      catch (err) { toast(err.message, true); }
    };
    $('.ph-edit', dlg)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const saved = await data.savePhrase({ id: editing, body: e.target.body.value });
        phrases = phrases.map((p) => (p.id === saved.id ? saved : p));
        editing = null;
        render();
      } catch (err) { toast(err.message, true); }
    });
  };
  // 用 onclick（不是 addEventListener），重開對話框時不會疊好幾個處理器
  dlg.onclick = async (e) => {
    const li = e.target.closest('[data-id]');
    if (!li || !dlg.contains(li)) return;
    const p = phrases.find((x) => x.id === li.dataset.id);
    if (e.target.closest('[data-copy]')) {
      const body = p.body.replace(/^\u200B+/, ''); // 舊看板留下的零寬空白不要帶走
      try { await navigator.clipboard.writeText(body); toast('已複製'); } catch {
        // 沒有剪貼簿權限時：放進一個看不見的輸入框、聚焦選取後複製
        const ta = Object.assign(document.createElement('textarea'), { value: body, readOnly: true });
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
        dlg.appendChild(ta); ta.focus(); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
        toast(ok ? '已複製' : '複製失敗，請手動選取', !ok);
      }
    }
    if (e.target.closest('[data-edit]')) { editing = p.id; render(); $('.ph-edit textarea', dlg).focus(); }
    if (e.target.closest('[data-cancel]')) { editing = null; render(); }
    if (e.target.closest('[data-del]')) {
      if (!(await confirmDialog(`刪除常用詞組「${p.body.slice(0, 30)}」？`))) return;
      try { await data.deletePhrase(p.id); phrases = phrases.filter((x) => x.id !== p.id); render(); toast('已刪除'); }
      catch (err) { toast(err.message, true); }
    }
  };
  render();
}
