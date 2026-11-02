// M8 數據與備份（Phase 5）：匯出全部資料為 JSON；匯入前顯示筆數並二次確認，只新增、不覆蓋
import * as data from '../data.js';
import { reloadAll } from '../store.js';
import { $, esc, toast, confirmDialog } from '../ui.js';
import { isMock } from '../supabase.js';
import { state } from '../store.js';
import { today } from '../dates.js';
import { convertBoardExport } from '../workboard-import.js';

const LAST_EXPORT_KEY = 'lifeos-last-export';

function stamp(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { file: `${p.year}${p.month}${p.day}-${p.hour}${p.minute}`, text: `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}` };
}

export function mountBackup(root) {
  let last = null;
  try { last = localStorage.getItem(LAST_EXPORT_KEY); } catch { /* 忽略 */ }
  root.innerHTML = `
    <header class="page-head"><h1>數據與備份</h1>
      <p class="sub">資料存在雲端（Supabase），但免費方案沒有自動備份，建議定期匯出一份放在自己的電腦或雲端硬碟。</p></header>
    ${isMock ? '<p class="warn card">目前是本機模擬模式：匯出的是這個瀏覽器裡的模擬資料。</p>' : ''}
    <div class="grid-2">
      <section class="card">
        <h2>匯出</h2>
        <p class="sub">下載一個 JSON 檔，包含領域、任務、專案、目標、計時、復盤、靈感、習慣等全部資料。</p>
        <div class="dialog-actions bk-actions"><button class="btn-primary" id="bk-export">下載備份</button></div>
        <p class="sub" id="bk-last">${last ? `這台裝置上次匯出：${esc(last)}` : '這台裝置還沒匯出過。'}</p>
      </section>
      <section class="card">
        <h2>匯入</h2>
        <p class="sub">從備份檔還原。只會<b>新增</b>目前沒有的資料，不會覆蓋或刪除既有資料；重複匯入同一份也不會變兩份。</p>
        <label class="bk-file"><input type="file" id="bk-file" accept="application/json,.json"></label>
        <div id="bk-plan"></div>
      </section>
    </div>
    <section class="card">
      <h2>從舊工作看板匯入</h2>
      <p class="sub">把「每日工作報告看板」的工作搬進來：還在看板上的未完成工作＋最近 30 天完成的，連同進度備註、專案標籤、工作種類、Wrap up 與常用詞組。
        先在看板的 Apps Script 加匯出功能，再打開「看板網址<code>?export=lifeos</code>」下載 <code>work-board-export.json</code>（步驟見 docs/08 第 6 節）。
        和一般匯入一樣只新增、不覆蓋；同案件編號的工作不會重複。</p>
      <label class="wb-target">放進哪個領域<select id="wb-area"></select></label>
      <label class="bk-file"><input type="file" id="wb-file" accept="application/json,.json"></label>
      <div id="wb-plan"></div>
    </section>`;

  $('#bk-export', root).onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '匯出中…';
    try {
      const backup = await data.exportAll();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      const s = stamp();
      a.href = URL.createObjectURL(blob);
      a.download = `life-os-backup-${s.file}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      const total = Object.values(backup.tables).reduce((n, r) => n + r.length, 0);
      try { localStorage.setItem(LAST_EXPORT_KEY, s.text); } catch { /* 忽略 */ }
      $('#bk-last', root).textContent = `這台裝置上次匯出：${s.text}（共 ${total} 筆）`;
      toast(`已匯出 ${total} 筆`);
    } catch (err) {
      toast(`匯出失敗：${err.message}`, true);
    } finally {
      btn.disabled = false;
      btn.textContent = '下載備份';
    }
  };

  /** 顯示匯入計畫（各表將新增／略過的筆數），確認後寫入 */
  function showPlan(box, plan, intro, input) {
    box.innerHTML = `${intro}
      <table class="table bk-table">
        <thead><tr><th>資料</th><th>將新增</th><th>已存在略過</th></tr></thead>
        <tbody>${data.BACKUP_TABLES.filter((t) => plan[t].add.length || plan[t].skip).map((t) => `<tr><td>${data.BACKUP_LABELS[t]}</td><td>${plan[t].add.length}</td><td>${plan[t].skip}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">沒有資料</td></tr>'}</tbody>
      </table>
      <div class="dialog-actions bk-actions"><button class="btn-primary" data-run>匯入</button></div>`;
    const total = data.BACKUP_TABLES.reduce((n, t) => n + plan[t].add.length, 0);
    const run = $('[data-run]', box);
    if (!total) {
      run.disabled = true;
      run.textContent = '沒有需要新增的資料';
      return;
    }
    run.onclick = async () => {
      const summary = data.BACKUP_TABLES.filter((t) => plan[t].add.length).map((t) => `${data.BACKUP_LABELS[t]} ${plan[t].add.length}`).join('、');
      if (!(await confirmDialog(`確定匯入 ${total} 筆？（${summary}）既有資料不會被覆蓋。`, '匯入'))) return;
      run.disabled = true;
      run.textContent = '匯入中…';
      try {
        const result = await data.runImport(plan);
        const n = Object.values(result).reduce((a, b) => a + b, 0);
        await reloadAll();
        box.innerHTML = `<p>✓ 已匯入 ${n} 筆。</p>`;
        input.value = '';
        toast(`已匯入 ${n} 筆`);
      } catch (err) {
        run.disabled = false;
        run.textContent = '匯入';
        toast(`匯入失敗：${err.message}（已匯入的部分會保留，可再匯入一次補齊）`, true);
      }
    };
  }

  const readJson = async (file) => {
    try { return JSON.parse(await file.text()); } catch { throw new Error('檔案不是有效的 JSON'); }
  };

  const planBox = $('#bk-plan', root);
  $('#bk-file', root).onchange = async (e) => {
    const file = e.target.files[0];
    planBox.innerHTML = '';
    if (!file) return;
    try {
      const backup = await readJson(file);
      planBox.innerHTML = '<p class="sub">比對中…</p>';
      const plan = await data.planImport(backup);
      showPlan(planBox, plan, `<p class="sub">備份時間：${backup.exported_at ? esc(stamp(new Date(backup.exported_at)).text) : '不明'}</p>`, e.target);
    } catch (err) {
      planBox.innerHTML = `<p class="warn">無法讀取：${esc(err.message)}</p>`;
    }
  };

  const wbBox = $('#wb-plan', root);
  // 預設放進「列入工作看板」的第一個領域；沒有的話用類型是工作的領域
  const wbArea = $('#wb-area', root);
  const preferred = state.areas.find((a) => a.on_board) || state.areas.find((a) => a.kind === 'work');
  wbArea.innerHTML = state.areas.map((a) => `<option value="${a.id}" ${a.id === preferred?.id ? 'selected' : ''}>${esc(a.name)}${a.on_board ? '（已列入工作看板）' : ''}</option>`).join('');
  // 換領域要重新產生計畫
  wbArea.onchange = () => { const input = $('#wb-file', root); if (input.files[0]) input.dispatchEvent(new Event('change')); };
  $('#wb-file', root).onchange = async (e) => {
    const file = e.target.files[0];
    wbBox.innerHTML = '';
    if (!file) return;
    try {
      const raw = await readJson(file);
      wbBox.innerHTML = '<p class="sub">轉換與比對中…</p>';
      const { backup, stats } = convertBoardExport(raw, {
        areas: state.areas, areaId: wbArea.value, projects: state.projects, workTags: await data.listWorkTags(), today: today(),
      });
      const plan = await data.planImport(backup);
      showPlan(wbBox, plan, `
        <p class="sub">看板資料到 ${esc(stats.latest)}，共 ${stats.cases} 件工作：要搬未完成 ${stats.open} 件、${esc(stats.cutoff)} 之後完成的 ${stats.doneRecent} 件；
          略過較早完成的 ${stats.skippedOld} 件、已從看板刪除的 ${stats.removed} 件。全部放進「${esc(state.areasById[wbArea.value]?.name || '')}」。
          ${state.areasById[wbArea.value]?.on_board ? '' : '<b>這個領域還沒列入工作看板</b>，匯入後到工作看板的「列入設定」勾選才看得到。'}</p>
        ${stats.removedTitles.length ? `<details class="wb-removed"><summary class="sub">看已從看板刪除、不會搬的 ${stats.removed} 件</summary>
          <ul>${stats.removedTitles.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
          <p class="sub">如果其中有還要做的，先回舊看板把它放回任一欄，再重新匯出。</p></details>` : ''}`, e.target);
    } catch (err) {
      wbBox.innerHTML = `<p class="warn">無法匯入：${esc(err.message)}</p>`;
    }
  };

  return () => {};
}
