// 好時光日誌（20261118，docs/16 A）：停止計時或打勾完成時，畫面下方問「投入／能量」兩下就好，可略過；
// 小實驗任務完成時，順便問「學到什麼」。資料層在停止計時與完成時發出 lifeos:activity-ended，這裡接。
import * as data from '../data.js?v=202611220214';
import { state } from '../store.js?v=202611220214';
import { esc, toast } from '../ui.js?v=202611220214';

const SHOW_MS = 15000; // 沒動作 15 秒自動收起
let bar = null;
let timer = null;
let last = { key: '', at: 0 };

function close() {
  clearTimeout(timer);
  bar?.remove();
  bar = null;
}

function open({ task_id = null, entry_id = null, done = false } = {}) {
  // 停止計時＋打勾完成常常連續發生，同一件 3 秒內只問一次
  const key = `${task_id}`;
  if (last.key === key && Date.now() - last.at < 3000) return;
  last = { key, at: Date.now() };
  const task = state.tasks.find((t) => t.id === task_id) || null;
  close();
  const pick = { engagement: null, energy: null };
  bar = document.createElement('div');
  bar.className = 'energy-bar';
  bar.setAttribute('role', 'dialog');
  bar.setAttribute('aria-label', '這段做得如何');
  bar.innerHTML = `
    <p class="eb-title">${task ? `「${esc(task.title.slice(0, 30))}」` : '這段'}做得如何？<span class="sub">（可略過）</span></p>
    <div class="eb-row" data-k="engagement"><span>投入</span>${Object.entries(data.ENGAGEMENT).map(([k, l]) => `<button type="button" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="eb-row" data-k="energy"><span>能量</span>${Object.entries(data.ENERGY).map(([k, l]) => `<button type="button" data-v="${k}">${l}</button>`).join('')}</div>
    ${task?.is_experiment && done ? '<label class="eb-learn">這個小實驗學到什麼？<input maxlength="1000" placeholder="一句話就好"></label>' : ''}
    <div class="eb-actions"><button type="button" class="btn-ghost" data-skip>略過</button><button type="button" class="btn-primary" data-save>記下</button></div>`;
  document.body.append(bar);
  const reset = () => { clearTimeout(timer); timer = setTimeout(close, SHOW_MS); };
  reset();
  bar.addEventListener('focusin', () => clearTimeout(timer));
  bar.addEventListener('click', async (e) => {
    reset();
    const b = e.target.closest('.eb-row [data-v]');
    if (b) {
      const k = b.closest('.eb-row').dataset.k;
      pick[k] = pick[k] === b.dataset.v ? null : b.dataset.v;
      b.closest('.eb-row').querySelectorAll('[data-v]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === pick[k])));
      return;
    }
    if (e.target.closest('[data-skip]')) { close(); return; }
    if (e.target.closest('[data-save]')) {
      const learning = bar.querySelector('.eb-learn input')?.value.trim();
      try {
        if (pick.engagement || pick.energy) await data.logEnergy({ task_id, entry_id, area_id: task?.area_id || null, ...pick });
        if (learning) await data.updateTask(task.id, { learning });
        close();
        if (pick.engagement || pick.energy || learning) toast('已記下');
      } catch (err) { toast(err.message, true); }
    }
  });
}

export function initEnergyPrompt() {
  window.addEventListener('lifeos:activity-ended', (e) => open(e.detail || {}));
}
