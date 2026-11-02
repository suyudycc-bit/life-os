// Wrap up my day（Phase W3）：在工作看板上做，只看工作（工作與生活分開，使用者決定 2026-11-03）
// 流程同舊看板：逐件標投入（輕／中／重）→ 回答三題 → 依規則分析（src/js/wrapup.js，不使用 AI）→ 摘要可改、可複製、可儲存。
// 存在 daily_reviews 的工作欄位（work_reflection／work_effort／work_summary／work_analysis），不動生活復盤的三格。
import * as data from '../data.js';
import { state } from '../store.js';
import { $, esc, toast } from '../ui.js';
import { today, formatShort, localDate } from '../dates.js';
import { analyzeDay, summaryText, EFFORT_LABELS } from '../wrapup.js';

const QUESTIONS = [
  ['achievement', '今天最重要的成果是什麼？', '例如：確認 VM 驗證方向，讓下一步可以直接進行'],
  ['blocker', '今天最大的卡點是什麼？', '例如：等待醫院端回覆，導致兩項工作無法往下'],
  ['attention', '明天最需要注意什麼？', '例如：先完成法規文件，再安排臨時需求'],
];

export async function openWrapUp(day = today()) {
  const dlg = $('#wrapup-dialog');
  dlg.innerHTML = '<div class="digest"><h2>Wrap up my day</h2><p class="sub">載入中…</p></div>';
  dlg.showModal();
  let saved;
  try { saved = await data.getReview(day); } catch (err) {
    dlg.querySelector('.sub').textContent = `讀取失敗：${err.message}`;
    return;
  }
  const wu = {
    effort: { ...(saved?.work_effort || {}) },
    reflection: { achievement: '', blocker: '', attention: '', ...(saved?.work_reflection || {}) },
    result: saved?.work_summary ? { analysis: saved.work_analysis, summary: saved.work_summary } : null,
  };
  const cols = data.boardColumns(state.tasks, state.areasById, day);
  const entries = ['new', 'inprogress', 'done'].flatMap((c) => cols[c].map((task) => ({ task, column: c })));
  const workTypeOf = (t) => state.workTags.find((w) => w.id === t.work_type_id)?.label || '';
  const projectOf = (t) => state.projects.find((p) => p.id === t.project_id)?.name || '';
  const colLabel = (c) => data.BOARD_COLUMNS.find((x) => x.id === c).label;

  dlg.innerHTML = `
    <div class="digest wu">
      <div class="day-head"><h2>Wrap up my day・${formatShort(day)}</h2><span class="sub" id="wu-status" role="status">${saved?.work_summary ? '已有儲存的 Wrap up' : ''}</span></div>
      <p class="sub">用投入程度看懂今天，而不是只數工作筆數。先標記每件今日工作的實際投入（輕＝短時間處理、中＝一般投入、重＝主要心力或高複雜度），再回答三題。依規則分析，不使用 AI。</p>
      <ul class="wu-list" id="wu-list">${entries.length ? entries.map(({ task, column }) => {
        const level = wu.effort[task.id] || 'medium';
        return `<li data-id="${task.id}">
          <div class="wu-copy"><b>${esc(task.title)}</b>
            <span class="sub">${[colLabel(column), workTypeOf(task), projectOf(task)].filter(Boolean).map(esc).join('・')}</span></div>
          <div class="seg wu-effort" role="radiogroup" aria-label="「${esc(task.title)}」的投入程度">
            ${Object.entries(EFFORT_LABELS).map(([k, l]) => `<button type="button" role="radio" data-level="${k}" aria-pressed="${k === level}" aria-checked="${k === level}">${l}</button>`).join('')}
          </div></li>`;
      }).join('') : '<li class="empty">今天看板的「新接、進行中、已完成」沒有工作。你仍可回答三題，留下今天的觀察。</li>'}</ul>
      <form class="wu-questions" id="wu-q">
        ${QUESTIONS.map(([k, q, ph]) => `<label>${q}<textarea name="${k}" rows="2" maxlength="2000" placeholder="${ph}">${esc(wu.reflection[k] || '')}</textarea></label>`).join('')}
      </form>
      <div class="dialog-actions wu-actions">
        <button type="button" class="btn-ghost" data-close>關閉</button>
        <button type="button" class="btn-primary" id="wu-run">產生分析</button>
      </div>
      <div id="wu-result"></div>
    </div>`;

  const q = $('#wu-q', dlg);
  const readQ = () => Object.fromEntries(QUESTIONS.map(([k]) => [k, q[k].value.trim()]));
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('#wu-list', dlg).addEventListener('click', (e) => {
    const b = e.target.closest('[data-level]');
    if (!b) return;
    wu.effort[b.closest('li').dataset.id] = b.dataset.level;
    b.parentElement.querySelectorAll('[data-level]').forEach((x) => {
      x.setAttribute('aria-pressed', String(x === b));
      x.setAttribute('aria-checked', String(x === b));
    });
    if (wu.result) $('#wu-status', dlg).textContent = '投入程度已變更，記得重新產生分析並儲存';
  });
  $('#wu-run', dlg).onclick = () => {
    wu.reflection = readQ();
    for (const { task } of entries) wu.effort[task.id] ||= 'medium';
    const analysis = analyzeDay({
      entries, effort: wu.effort, reflection: wu.reflection, future: { tomorrow: cols.tomorrow, backlog: cols.backlog },
      workTypeOf, projectOf, day, createdDay: (t) => localDate(t.created_at),
    });
    wu.result = { analysis, summary: summaryText(day, analysis, wu.reflection) };
    $('#wu-status', dlg).textContent = '已產生分析，尚未儲存';
    renderResult();
    $('#wu-result', dlg).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  function renderResult() {
    const a = wu.result?.analysis;
    const el = $('#wu-result', dlg);
    if (!a) { el.innerHTML = ''; return; }
    const bars = (items) => items.length ? items.map((x) => `<div class="wu-bar"><span class="wu-bar-label">${esc(x.label)}</span>
      <span class="wu-bar-track"><i style="width:${x.percent}%"></i></span><b>${x.percent}%</b></div>`).join('') : '<p class="sub">沒有資料</p>';
    const list = (title, items) => `<div><h3>${title}</h3><ul>${(items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    el.innerHTML = `
      <div class="wu-head"><h3>${esc(a.headline)}</h3><p>${esc(a.overview)}</p></div>
      <div class="grid-2 wu-grid">
        <div><h3>工作種類投入</h3>${bars(a.workTypes || [])}</div>
        <div><h3>專案投入</h3>${bars(a.projects || [])}</div>
      </div>
      <div class="wu-lists">${list('今日觀察', a.insights)}${list('可以優化', a.optimizations)}${list('明天要注意', a.attention)}${list('明日優先', a.tomorrowActions)}</div>
      <label class="wu-summary">復盤摘要（可修改後再儲存、複製）<textarea id="wu-text" rows="10">${esc(wu.result.summary)}</textarea></label>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="wu-copy">複製摘要</button>
        <button type="button" class="btn-primary" id="wu-save">儲存 Wrap up</button>
      </div>`;
    $('#wu-text', dlg).oninput = (e) => { wu.result.summary = e.target.value; };
    $('#wu-copy', dlg).onclick = async () => {
      try { await navigator.clipboard.writeText($('#wu-text', dlg).value); toast('已複製復盤摘要'); } catch {
        $('#wu-text', dlg).select();
        const ok = document.execCommand('copy');
        toast(ok ? '已複製復盤摘要' : '複製失敗，請手動選取', !ok);
      }
    };
    $('#wu-save', dlg).onclick = async () => {
      try {
        await data.saveWrapUp(day, {
          work_reflection: readQ(), work_effort: wu.effort, work_summary: $('#wu-text', dlg).value.trim() || null, work_analysis: a,
        });
        $('#wu-status', dlg).textContent = `已儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
        toast('已儲存 Wrap up');
      } catch (err) { toast(`儲存失敗：${err.message}`, true); }
    };
  }
  renderResult();
}
