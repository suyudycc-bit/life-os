// 提醒設定（20261117，回饋 4c43dd7a）：網站推播（早上「今天要做的」、晚上「還沒做完的」）＋Google 日曆提醒說明。
// 推播由 Edge Function push-reminders 依 reminder_settings 送出；這台裝置要先允許通知、訂閱，存進 push_subscriptions。
// iPhone：要先在 Safari 按分享 →「加入主畫面」，從主畫面打開的網站才能收通知（iOS 16.4 起，Apple 的限制）。
import * as data from '../data.js';
import { $, esc, toast } from '../ui.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** 註冊 Service Worker（只處理推播，不快取）。模擬模式、不支援的瀏覽器略過 */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('sw.js'); } catch { return null; }
}

/** base64url 公鑰 → Uint8Array（pushManager.subscribe 要的格式） */
function keyBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function currentSub() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function enableOnThisDevice() {
  if (!supported()) throw new Error(isIOS() && !standalone()
    ? 'iPhone 要先把網站「加入主畫面」，再從主畫面的圖示打開，才能開啟通知。'
    : '這個瀏覽器不支援網站通知。');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('沒有允許通知。要開啟請到瀏覽器（或 iPhone 設定 → 通知）允許這個網站。');
  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  const { publicKey } = await data.callPush('key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await data.savePushSubscription(sub);
}

async function disableOnThisDevice() {
  const sub = await currentSub();
  if (!sub) return;
  await data.deletePushSubscription(sub.endpoint);
  await sub.unsubscribe();
}

export async function openRemindDialog() {
  let dlg = $('#remind-dialog');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'remind-dialog'; document.body.append(dlg); }
  dlg.innerHTML = '<p class="sub">讀取中…</p>';
  dlg.showModal();
  let s = null;
  let devices = 0;
  let sub = null;
  let loadErr = '';
  try {
    [s, devices, sub] = await Promise.all([data.getReminderSettings(), data.countPushDevices(), currentSub()]);
  } catch (err) { loadErr = err.message; }
  s = s || { morning_on: true, morning_time: '08:30', evening_on: true, evening_time: '21:00' };
  const hm = (v) => String(v || '').slice(0, 5);
  const iosHint = isIOS() && !standalone();
  const state = !supported()
    ? (iosHint ? '這台 iPhone 要先「加入主畫面」才能收通知（見下方步驟）。' : '這個瀏覽器不支援網站通知。')
    : Notification.permission === 'denied' ? '這台裝置已封鎖通知，請到瀏覽器或系統設定允許這個網站。'
      : sub ? '這台裝置已開啟通知。' : '這台裝置還沒開啟通知。';
  dlg.innerHTML = `
    <form class="rm-form">
      <h2>提醒</h2>
      ${loadErr ? `<p class="warn">讀取設定失敗：${esc(loadErr)}（如果是第一次使用，需要先執行 migration 20261117_push.sql）</p>` : ''}
      <section>
        <h3>網站通知</h3>
        <p class="sub">${esc(state)}${devices ? `　目前有 ${devices} 台裝置會收到。` : ''}</p>
        <div class="rm-row">
          <label class="check"><input type="checkbox" name="morning_on" ${s.morning_on ? 'checked' : ''}> 早上提醒今天要做的</label>
          <input type="time" name="morning_time" value="${hm(s.morning_time)}" aria-label="早上提醒時間">
        </div>
        <div class="rm-row">
          <label class="check"><input type="checkbox" name="evening_on" ${s.evening_on ? 'checked' : ''}> 晚上提醒還沒做完的</label>
          <input type="time" name="evening_time" value="${hm(s.evening_time)}" aria-label="晚上提醒時間">
        </div>
        <p class="sub">只算生活的任務（到期日或排程是今天、或已過期，還沒完成的）；沒有要做的事就不打擾。每 15 分鐘檢查一次，所以會在設定時間後 15 分鐘內收到。</p>
        <div class="rm-actions">
          ${sub ? '<button type="button" class="btn-ghost" data-test>送一則測試通知</button><button type="button" class="btn-ghost danger" data-off>這台裝置關閉通知</button>'
            : '<button type="button" class="btn-primary" data-on>這台裝置開啟通知</button>'}
        </div>
        ${iosHint || !supported() ? `<ol class="rm-ios">
          <li>用 iPhone 的 Safari 打開這個網站。</li>
          <li>按下方「分享」→「加入主畫面」。</li>
          <li>從主畫面的圖示打開，再按「提醒」→「這台裝置開啟通知」→ 允許。</li>
        </ol>` : ''}
      </section>
      <section>
        <h3>Google 日曆提醒</h3>
        <p class="sub">有開「寫入 Google 日曆」的話，Google 上「Life OS」日曆的任務也會提醒：有排時間的提前 10 分鐘、只有到期日的在前一天晚上 9 點（已完成的不提醒）。手機要在 Google 日曆 App 允許通知。</p>
      </section>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>關閉</button>
        <button class="btn-primary" data-save>儲存時間設定</button>
      </div>
    </form>`;
  const f = $('form', dlg);
  $('[data-cancel]', dlg).onclick = () => dlg.close();
  const fields = () => ({ morning_on: f.morning_on.checked, morning_time: f.morning_time.value, evening_on: f.evening_on.checked, evening_time: f.evening_time.value });
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await data.saveReminderSettings(fields()); toast('已儲存提醒時間'); dlg.close(); } catch (err) { toast(err.message, true); }
  };
  const busy = async (btn, fn) => { btn.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; } };
  const on = $('[data-on]', dlg);
  if (on) on.onclick = () => busy(on, async () => {
    await data.saveReminderSettings(fields()); // 先存時間（沒有設定列的話會建立）
    await enableOnThisDevice();
    toast('這台裝置已開啟通知');
    openRemindDialog();
  });
  const test = $('[data-test]', dlg);
  if (test) test.onclick = () => busy(test, async () => {
    const { sent } = await data.callPush('test');
    toast(sent ? `已送出測試通知（${sent} 台裝置）` : '沒有送出：這個帳號還沒有裝置開啟通知');
  });
  const off = $('[data-off]', dlg);
  if (off) off.onclick = () => busy(off, async () => { await disableOnThisDevice(); toast('這台裝置已關閉通知'); openRemindDialog(); });
}
