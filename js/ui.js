// 共用 UI 小工具
import { formatHMS } from './dates.js';
export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
}

/** 二次確認（docs/03：破壞性操作需確認） */
export function confirmDialog(message, okLabel = '刪除') {
  const dlg = $('#confirm-dialog');
  $('#confirm-message', dlg).textContent = message;
  $('#confirm-ok', dlg).textContent = okLabel;
  // 直接聽按鈕與 Esc，不依賴 close 事件（close 是非同步派送，可能延遲）
  return new Promise((resolve) => {
    const done = (ok) => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
      dlg.close();
      resolve(ok);
    };
    const onClick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      done(b.value === 'ok');
    };
    const onCancel = (e) => { e.preventDefault(); done(false); };
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    dlg.showModal();
  });
}

/** 先跳脫再把網址轉成連結（新分頁開啟） */
export function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

export function linkLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** 讀不到網頁標題時的暫時名稱：網域＋路徑（例如 example.com/docs/a），最多 80 字 */
export function linkFallbackTitle(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '');
    try { path = decodeURIComponent(path); } catch { /* 保留原樣 */ }
    return `${u.hostname.replace(/^www\./, '')}${path}`.slice(0, 80);
  } catch { return String(url).slice(0, 80); }
}

export function formatDateTime(ts) {
  const d = new Date(ts);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`;
}

/** 用時顯示（h m s）；有 sinceISO 時表示含一段進行中的計時，畫面每秒更新 */
export function durationHTML(baseSec, sinceISO = null) {
  const sec = baseSec + (sinceISO ? (Date.now() - new Date(sinceISO)) / 1000 : 0);
  return `<span class="live-dur" data-base="${baseSec}"${sinceISO ? ` data-since="${esc(sinceISO)}"` : ''}>${formatHMS(sec)}</span>`;
}

export const PRIORITY = { 1: '高', 2: '中', 3: '低' };

export function areaChip(area) {
  if (!area) return '';
  return `<span class="chip" style="--c:${esc(area.color || '#888')}"><i></i>${esc(area.name)}</span>`;
}

/**
 * 貼上時拆出連結（同舊工作看板）：從 Planner／Excel／Teams 複製「有超連結的文字」→ 文字＋網址；
 * 只貼一段含網址的純文字 → 網址拆出來，剩下的當文字。沒有網址回傳 null。
 */
export function pastedLink(clipboardData) {
  const html = clipboardData?.getData('text/html');
  if (html) {
    const a = new DOMParser().parseFromString(html, 'text/html').querySelector('a[href^="http"]');
    if (a) return { text: a.textContent.replace(/\s+/g, ' ').trim(), url: a.href };
  }
  const plain = clipboardData?.getData('text/plain') || '';
  const m = plain.match(/https?:\/\/[^\s<>"']+/);
  if (!m) return null;
  return { text: plain.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), url: m[0] };
}

/**
 * 側欄徽章（20261106 E）：ROUTES 裡有 `badge: true` 的頁面，側欄會有 <span class="badge" data-badge="頁面id">。
 * 任何模組都可呼叫 setNavBadge('inbox', 3, '3 筆放很久沒看')；n 為 0／空值時隱藏。
 * 所在分組收合時，分組小標旁顯示組內徽章的合計（app.js 的 renderNav）。
 */
export function setNavBadge(routeId, n, label = '') {
  const b = document.querySelector(`#nav [data-badge="${CSS.escape(routeId)}"]`);
  if (!b) return;
  const num = Number(n) || 0;
  b.textContent = num;
  b.hidden = num === 0;
  b.dataset.n = num;
  if (label || num) b.setAttribute('aria-label', label || `${num} 筆`);
  const sec = b.closest('.nav-sec');
  const sum = sec?.querySelector('.nav-group-badge');
  if (sum) {
    const total = [...sec.querySelectorAll('[data-badge]')].reduce((a, x) => a + (Number(x.dataset.n) || 0), 0);
    sum.textContent = total;
    sum.hidden = total === 0;
  }
}
