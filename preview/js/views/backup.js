// M8 數據與備份（Phase 5）：匯出全部資料為 JSON；匯入前顯示筆數並二次確認，只新增、不覆蓋
import * as data from '../data.js?v=202611242058';
import { reloadAll } from '../store.js?v=202611242058';
import { $, esc, toast, confirmDialog } from '../ui.js?v=202611242058';
import { isMock } from '../supabase.js?v=202611242058';
import { state } from '../store.js?v=202611242058';
import { today } from '../dates.js?v=202611242058';

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
        <p class="bk-private" role="note">🔒 備份檔沒有加密，含聯絡人、日記與復盤、內在整理、工作備註等私人內容：請存在只有自己能開的地方，不要傳給別人或上傳到公開位置。</p>
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
    <section class="card tr-sec" id="trash">
      <div class="tr-head"><h2>垃圾桶</h2>
        <label class="tr-filter">類型<select id="tr-kind"><option value="">全部</option></select></label></div>
      <p class="sub">刪除的任務、專案、靈感等會先放在這裡 ${data.TRASH_DAYS} 天，可以還原（連同任務的進度 memo、習慣的打卡等一起回來）；超過 ${data.TRASH_DAYS} 天自動清除。領域刪除不進垃圾桶。</p>
      <div id="tr-list"><p class="sub">讀取中…</p></div>
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
      ${plan._droppedLinks ? `<p class="warn">備份檔裡有 ${plan._droppedLinks} 個連結不是 http:// 或 https:// 開頭（可能被改過），匯入時會拿掉這些連結，其餘內容照常匯入。</p>` : ''}
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


  // ===== 垃圾桶（20261106 G2；資料函式在 data.js「垃圾桶」）=====
  const trBox = $('#tr-list', root);
  const trKind = $('#tr-kind', root);
  let trash = [];
  const daysLeft = (t) => Math.max(0, Math.ceil((Date.parse(t.deleted_at) + data.TRASH_DAYS * 86400000 - Date.now()) / 86400000));
  function paintTrash() {
    const kinds = [...new Set(trash.map((t) => t.table_name))];
    const keep = trKind.value;
    trKind.innerHTML = `<option value="">全部（${trash.length}）</option>${kinds.map((k) => `<option value="${esc(k)}">${esc(data.TRASH_LABELS[k] || k)}（${trash.filter((t) => t.table_name === k).length}）</option>`).join('')}`;
    trKind.value = kinds.includes(keep) ? keep : '';
    const list = trash.filter((t) => !trKind.value || t.table_name === trKind.value);
    if (!list.length) {
      trBox.innerHTML = `<p class="empty sub">${trash.length ? '這個類型沒有被刪除的資料。' : `垃圾桶是空的。刪除的資料會在這裡放 ${data.TRASH_DAYS} 天。`}</p>`;
      return;
    }
    trBox.innerHTML = `<ul class="tr-list">${list.map((t) => {
      const sub = Object.entries(t.payload?.cascade || {}).filter(([, rows]) => rows.length)
        .map(([tb, rows]) => `${data.TRASH_LABELS[tb] || data.BACKUP_LABELS[tb] || tb} ${rows.length}`).join('、');
      const left = daysLeft(t);
      return `<li class="tr-item">
        <span class="tr-kind">${esc(data.TRASH_LABELS[t.table_name] || t.table_name)}</span>
        <span class="tr-main"><span class="tr-label">${esc(t.label)}</span>
          <span class="sub tr-meta">刪除於 ${esc(stamp(new Date(t.deleted_at)).text)}${sub ? `・含 ${esc(sub)}` : ''}・<span class="${left <= 3 ? 'warn' : ''}">${left} 天後自動清除</span></span></span>
        <span class="tr-acts">
          <button type="button" class="btn-ghost" data-restore="${t.id}" aria-label="還原：${esc(t.label)}">還原</button>
          <button type="button" class="btn-ghost danger" data-purge="${t.id}" aria-label="永久刪除：${esc(t.label)}">永久刪除</button>
        </span></li>`;
    }).join('')}</ul>`;
  }
  async function loadTrash() {
    try {
      trash = await data.listTrash();
      paintTrash();
    } catch (err) {
      trBox.innerHTML = `<p class="warn">無法讀取垃圾桶：${esc(err.message)}</p><p class="sub">若還沒執行 migration 20261106_feedback.sql，垃圾桶尚未啟用。</p>`;
    }
  }
  trKind.onchange = paintTrash;
  trBox.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-restore], button[data-purge]');
    if (!b) return;
    const t = trash.find((x) => x.id === (b.dataset.restore || b.dataset.purge));
    if (!t) return;
    const kind = data.TRASH_LABELS[t.table_name] || t.table_name;
    b.disabled = true;
    try {
      if (b.dataset.restore) {
        const r = await data.restoreTrash(t.id);
        await reloadAll(); // 還原後各頁（任務、專案、靈感…）看到的是同一份
        toast(`已還原${kind}「${t.label}」${r.notes?.length ? `（${r.notes.join('；')}）` : ''}`);
      } else {
        if (!(await confirmDialog(`永久刪除${kind}「${t.label}」？之後就不能還原了。`, '永久刪除'))) { b.disabled = false; return; }
        await data.purgeTrashItem(t.id);
        toast('已永久刪除');
      }
      await loadTrash();
    } catch (err) {
      b.disabled = false;
      toast(err.message, true);
    }
  });
  loadTrash();

  return () => {};
}
