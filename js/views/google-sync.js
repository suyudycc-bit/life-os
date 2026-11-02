// Google 日曆同步設定（Phase 5.5）與外部會議的唯讀檢視
import * as data from '../data.js';
import { $, esc, toast, formatDateTime } from '../ui.js';
import { formatShort, localDate, formatTime } from '../dates.js';
import { isMock } from '../supabase.js';

export const extTime = (iso) => formatTime(iso);

/** 會議詳細（唯讀；要改請到 Google 日曆） */
export function openExternalEvent(e) {
  const dlg = $('#event-dialog');
  const endDay = e.ends_at ? localDate(new Date(new Date(e.ends_at).getTime() - 1)) : null;
  const when = e.all_day
    ? `${formatShort(localDate(e.starts_at))}${endDay && endDay !== localDate(e.starts_at) ? `–${formatShort(endDay)}` : ''} 全天`
    : `${formatShort(localDate(e.starts_at))} ${formatTime(e.starts_at)}${e.ends_at ? `–${formatTime(e.ends_at)}` : ''}`;
  dlg.innerHTML = `
    <div class="digest">
      <h2>${esc(e.title)}</h2>
      <p>${when}</p>
      ${e.location ? `<p class="sub">地點：${esc(e.location)}</p>` : ''}
      <p class="sub">來自 Google 日曆（唯讀）。要修改請到 Google 日曆，下次同步後這裡會更新。</p>
      <div class="dialog-actions"><button type="button" class="btn-primary" data-close>知道了</button></div>
    </div>`;
  $('[data-close]', dlg).onclick = () => dlg.close();
  dlg.showModal();
}

const statusLine = (at, count, err, unit) => {
  if (err) return `<p class="warn">上次失敗：${esc(err)}</p>`;
  if (!at) return '<p class="sub">還沒同步過。</p>';
  return `<p class="sub">上次同步 ${formatDateTime(at)}・${count ?? 0} ${unit}</p>`;
};

/** @param {() => void} onSynced 同步完成後要做的事（例如重讀日曆上的會議） */
export async function openGoogleSyncDialog(onSynced) {
  const dlg = $('#google-dialog');
  dlg.innerHTML = '<div class="digest"><h2>Google 日曆同步</h2><p class="sub">讀取中…</p></div>';
  dlg.showModal();
  let s;
  try {
    s = (await data.getCalendarSync()) || {};
  } catch (e) {
    dlg.innerHTML = `<div class="digest"><h2>Google 日曆同步</h2>
      <p class="warn">讀不到同步設定：${esc(e.message)}</p>
      <p class="sub">請先在 Supabase 執行 <code>supabase/migrations/20261103_google_calendar.sql</code>，步驟見 docs/06-google-sync-setup.md。</p>
      <div class="dialog-actions"><button type="button" class="btn-primary" data-close>關閉</button></div></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    return;
  }

  dlg.innerHTML = `
    <div class="digest gs">
      <h2>Google 日曆同步</h2>
      <p class="sub">每小時自動同步一次；也可以按下方「立即同步」。${isMock ? '<br><b>模擬模式</b>：不會連到 Google，「立即同步」會放幾筆範例會議讓你看畫面。' : ''}</p>

      <section>
        <h3>① 把 Google 會議帶進 Life OS（唯讀）</h3>
        <p class="sub">到 Google 日曆 → 左側你的日曆旁「⋮」→ 設定和共用 → 整合日曆 → 複製「iCal 格式的私密網址」，貼在下面。
          這個網址等於日曆的鑰匙，不要給別人；外洩時可在同一處按「重設」。</p>
        <form class="gs-ics">
          <input name="url" type="password" autocomplete="off" placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            aria-label="iCal 格式的私密網址" value="${esc(s.google_ics_url || '')}">
          <button type="button" class="btn-ghost" data-show>顯示</button>
          <button class="btn-timer">儲存</button>
        </form>
        ${s.google_ics_url ? `<button type="button" class="btn-ghost danger" data-unlink-ics>停止讀取並清除網址</button>` : ''}
        ${s.google_ics_url ? statusLine(s.last_pull_at, s.last_pull_count, s.last_pull_error, '個會議') : ''}
      </section>

      <section>
        <h3>② 把 Life OS 任務寫進 Google</h3>
        <p class="sub">會在你的 Google 日曆新增一個「Life OS」日曆，只寫在那裡，不會動到你原本的行程。
          有排程時間的任務顯示在那個時段；只有到期日的任務顯示為全天的「到期」。請在 Life OS 修改，在 Google 改的會被覆蓋。</p>
        ${s.push_enabled
          ? `<p>✓ 已連結 Google 帳號</p>
             ${statusLine(s.last_push_at, s.last_push_count, s.last_push_error, '個任務事件')}
             <div class="dialog-actions gs-left">
               <button type="button" class="btn-ghost" data-connect>重新連結</button>
               <button type="button" class="btn-ghost danger" data-stop-push>停止寫入</button>
             </div>
             <p class="sub">停止寫入後，Google 上已有的「Life OS」日曆不會被刪，可自行在 Google 日曆刪除。</p>`
          : `<div class="dialog-actions gs-left"><button type="button" class="btn-timer" data-connect>連結 Google 帳號</button></div>
             <p class="sub">連結時若出現「Google 尚未驗證這個應用程式」，因為這是你自己建立的 App，可按「進階」→「前往（不安全）」繼續。</p>`}
      </section>

      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-close>關閉</button>
        <button type="button" class="btn-primary" data-sync ${s.google_ics_url || s.push_enabled ? '' : 'disabled'}>立即同步</button>
      </div>
    </div>`;

  const reopen = () => openGoogleSyncDialog(onSynced);
  $('[data-close]', dlg).onclick = () => dlg.close();
  $('[data-show]', dlg).onclick = (e) => {
    const input = $('.gs-ics input', dlg);
    input.type = input.type === 'password' ? 'text' : 'password';
    e.target.textContent = input.type === 'password' ? '顯示' : '隱藏';
  };
  $('.gs-ics', dlg).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await data.saveIcsUrl(e.target.url.value);
      toast(e.target.url.value.trim() ? '已儲存，按「立即同步」試試看' : '已清除');
      reopen();
    } catch (err) {
      toast(err.message, true);
    }
  };
  $('[data-unlink-ics]', dlg)?.addEventListener('click', async () => {
    try {
      await data.saveIcsUrl('');
      toast('已停止讀取；已帶進來的會議會在下次同步前保留');
      reopen();
    } catch (err) {
      toast(err.message, true);
    }
  });
  dlg.querySelectorAll('[data-connect]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        await data.startGoogleConnect(); // 成功會整頁轉到 Google
      } catch (err) {
        b.disabled = false;
        toast(err.message, true);
      }
    };
  });
  $('[data-stop-push]', dlg)?.addEventListener('click', async () => {
    try {
      await data.setPushEnabled(false);
      toast('已停止寫入 Google');
      reopen();
    } catch (err) {
      toast(err.message, true);
    }
  });
  $('[data-sync]', dlg).onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = '同步中…';
    try {
      const r = await data.syncGoogleNow();
      const err = r?.last_pull_error || r?.last_push_error;
      toast(err ? `部分失敗：${err}` : '同步完成', Boolean(err));
      onSynced?.();
      reopen();
    } catch (err) {
      b.disabled = false;
      b.textContent = '立即同步';
      toast(err.message, true);
    }
  };
}
