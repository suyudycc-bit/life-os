// 過期未完成的生活任務清單（20261111 B3 從總覽開始；20261121 抽出來給日曆的「今天」共用）。
// 資料：data.overdueOverview（＝月度遷移的 migrationCandidates）；動作：data.migrateTasks（移到今天／排到之後＝下個月 1 日／不做了），只改任務本身。
import * as data from '../data.js?v=202611220224';
import { state, refreshTasks } from '../store.js?v=202611220224';
import { esc, toast, confirmDialog, areaChip } from '../ui.js?v=202611220224';
import { today, addDays, formatShort } from '../dates.js?v=202611220224';
import { bindTaskList } from './task-actions.js?v=202611220224';

export const laterDay = () => `${data.nextMonth(data.monthOf(today()))}-01`;

/** 掛事件：勾選完成、點標題編輯（同其他任務清單）＋三個遷移按鈕。每個清單只呼叫一次 */
export function bindOverdueList(ul) {
  bindTaskList(ul);
  ul.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-ovd]');
    if (!btn) return;
    const id = btn.closest('.task').dataset.id;
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const action = btn.dataset.ovd;
    if (action === 'drop' && !(await confirmDialog(`把「${t.title}」標成「不做了」（放棄）？${state.running?.task_id === id ? '正在計時的會先停止。' : ''}`, '不做了'))) return;
    btn.closest('.ovd-acts').querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await data.migrateTasks([id], action, { targetDay: today(), tasks: state.tasks, running: state.running });
      await refreshTasks(); // 重讀任務、計時與 daily_summary，各頁數字跟著更新
      toast(action === 'forward' ? '已移到今天' : action === 'later' ? `已排到 ${formatShort(laterDay())}` : '已標成不做了');
    } catch (err) {
      btn.closest('.ovd-acts')?.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      toast(err.message, true);
    }
  });
}

/** 清單內容：{ items, allYesterday, html }；limit＝最多列幾件 */
export function overdueListHTML(day = today(), limit = Infinity) {
  const { items, allYesterday } = data.overdueOverview(state.life.tasks, day);
  const later = formatShort(laterDay());
  const html = items.slice(0, limit).map(({ task: t, day: d, daysLate }) => `
      <li class="task ovd-item" data-id="${t.id}" data-open>
        <input type="checkbox" class="task-done" aria-label="標記完成：${esc(t.title)}">
        <div class="task-main">
          <div class="task-title"><button type="button" class="ovd-title" data-act="edit" title="編輯任務">${esc(t.title)}</button></div>
          <div class="task-meta">${areaChip(state.areasById[t.area_id])}
            <span class="overdue">${d === addDays(day, -1) ? '昨天' : `過期 ${daysLate} 天`}（${formatShort(d)}）</span></div>
        </div>
        <span class="ovd-acts">
          <button type="button" class="btn-ghost" data-ovd="forward" aria-label="移到今天：${esc(t.title)}">移到今天</button>
          <button type="button" class="btn-ghost" data-ovd="later" title="排到下個月 ${later}" aria-label="排到之後（${later}）：${esc(t.title)}">排到之後</button>
          <button type="button" class="btn-ghost danger" data-ovd="drop" aria-label="不做了：${esc(t.title)}">不做了</button>
        </span>
      </li>`).join('');
  return { items, allYesterday, html };
}
