// 「當日」一律以 Asia/Taipei 判斷（docs/02 時區規則）
export const TZ = 'Asia/Taipei';

const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 任意時間點 → 台北日期字串 YYYY-MM-DD */
export function localDate(d = new Date()) {
  return ymd.format(d instanceof Date ? d : new Date(d));
}

export function today() {
  return localDate(new Date());
}

/** YYYY-MM-DD 加減天數（純日期運算，不受時區影響） */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** timestamptz → datetime-local 輸入框用的台北時間字串 */
export function toLocalInput(ts) {
  if (!ts) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** datetime-local（視為台北時間）→ ISO timestamptz */
export function fromLocalInput(v) {
  return v ? new Date(`${v}:00+08:00`).toISOString() : null;
}

export function formatShort(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}/${Number(d)}`;
}

export function formatTime(ts) {
  return ts ? toLocalInput(ts).slice(11) : '';
}

/** 該日所在週的週一（YYYY-MM-DD） */
export function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=週日
  return addDays(dateStr, -((dow + 6) % 7));
}

/** 台北日期 00:00 的 ISO 時間 */
export function dayStartISO(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).toISOString();
}

/** 秒數 → 「1h 2m 5s」，省略為 0 的單位；全為 0 時顯示「0s」 */
export function formatHMS(sec) {
  const t = Math.max(0, Math.round(sec || 0));
  const parts = [[Math.floor(t / 3600), 'h'], [Math.floor((t % 3600) / 60), 'm'], [t % 60, 's']]
    .filter(([n]) => n > 0).map(([n, u]) => `${n}${u}`);
  return parts.join(' ') || '0s';
}

/** 差異秒數 → 「+1m 5s」／「−58m」／「0s」（實際 − 預計，+ 表示超過預計） */
export function formatSignedHMS(sec) {
  const r = Math.round(sec || 0);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${formatHMS(Math.abs(r))}`;
}

/** 分鐘 → 「1h 5m」（資料庫以分鐘存的值，例如 actual_min、estimate_min） */
export function formatMin(min) {
  return formatHMS(Math.round(min || 0) * 60).replace(/^0s$/, '0m');
}

/** 秒數 → 00:00:00（計時中顯示用） */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
