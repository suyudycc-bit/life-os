// 帳號設定：修改密碼（已登入）、忘記密碼（登入畫面）、從重設信回來後設定新密碼
// 查證來源與 Supabase 後台設定見 docs/09「修改密碼與忘記密碼」
import * as data from './data.js';
import { recoveryInUrl, authUrlError } from './supabase.js';
import { $, esc, toast } from './ui.js';

const dlg = () => $('#account-dialog');

const pwField = (name, label, autocomplete) =>
  `<label>${label}<input type="password" name="${name}" required autocomplete="${autocomplete}"></label>`;

/**
 * 開一個表單對話框。直接聽「取消」按鈕與表單送出，不依賴 dialog 的 close 事件。
 * onSubmit(form, msgEl) 回傳 true 代表完成、可以關閉；丟出錯誤則把訊息顯示在對話框裡。
 */
function openForm(title, bodyHTML, submitLabel, onSubmit) {
  const d = dlg();
  d.innerHTML = `
    <form class="account-form" novalidate>
      <h2>${title}</h2>
      ${bodyHTML}
      <p class="form-msg" role="status" aria-live="polite"></p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-act="cancel">取消</button>
        <button type="submit" class="btn-primary" data-act="ok">${submitLabel}</button>
      </div>
    </form>`;
  const form = $('form', d);
  const msg = $('.form-msg', d);
  const ok = $('[data-act="ok"]', d);
  $('[data-act="cancel"]', d).onclick = () => d.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (ok.disabled) return;
    const empty = [...form.elements].find((el) => el.required && !el.value.trim());
    if (empty) { msg.textContent = '請填寫所有欄位'; msg.classList.add('warn'); empty.focus(); return; }
    msg.classList.remove('warn');
    msg.textContent = '處理中…';
    ok.disabled = true;
    try {
      if (await onSubmit(form, msg)) d.close();
    } catch (err) {
      msg.textContent = err.message;
      msg.classList.add('warn');
    } finally {
      ok.disabled = false;
    }
  };
  d.showModal();
  form.querySelector('input')?.focus();
}

/** 新密碼的檢查：長度、兩次一致、（有目前密碼時）不能和目前的相同 */
function checkNewPassword(next, confirm, current = null) {
  if (next.length < data.PASSWORD_MIN) return `新密碼至少要 ${data.PASSWORD_MIN} 碼`;
  if (next !== confirm) return '兩次輸入的新密碼不一致';
  if (current !== null && next === current) return '新密碼不能和目前的密碼相同';
  return '';
}

/** 側欄「修改密碼」 */
export function openChangePassword() {
  openForm('修改密碼', `
    <p class="sub">為了確認是你本人，請先輸入目前的密碼。</p>
    ${pwField('current', '目前密碼', 'current-password')}
    ${pwField('next', `新密碼（至少 ${data.PASSWORD_MIN} 碼）`, 'new-password')}
    ${pwField('confirm', '確認新密碼', 'new-password')}`, '更新密碼', async (form) => {
    const { current, next, confirm } = form.elements;
    const problem = checkNewPassword(next.value, confirm.value, current.value);
    if (problem) throw new Error(problem);
    await data.changePassword(current.value, next.value);
    toast('密碼已更新，下次登入請用新密碼');
    return true;
  });
}

/** 登入畫面「忘記密碼？」 */
export function openForgotPassword(email = '') {
  openForm('忘記密碼', `
    <p class="sub">輸入註冊時的 Email，我們會寄一封重設密碼的信。點信中的連結回到這個網站後，就能設定新密碼。</p>
    <label>Email<input type="email" name="email" required autocomplete="email" value="${esc(email)}"></label>`, '寄出重設信', async (form, msg) => {
    const email = form.elements.email.value.trim();
    if (!form.elements.email.checkValidity()) throw new Error('Email 格式不正確');
    // 信件連結回到目前這一頁（去掉 query 與 hash），必須在 Supabase 後台的 Redirect URLs 名單內
    const res = await data.requestPasswordReset(email, `${location.origin}${location.pathname}`);
    msg.classList.remove('warn');
    msg.innerHTML = '如果這個 Email 有註冊，幾分鐘內會收到重設密碼的信（也請看垃圾郵件匣）。'
      + (res?.mock_link ? `<br>模擬模式不會寄信，可直接開這個連結：<a href="${esc(res.mock_link)}" target="_blank" rel="noopener">模擬的重設連結</a>（新分頁開啟，像從信箱點進來）` : '');
    const cancel = $('[data-act="cancel"]', dlg());
    cancel.textContent = '關閉';
    return false; // 留著對話框讓使用者看到提示
  });
}

/** 從重設密碼信回來（已有臨時登入狀態）：設定新密碼 */
function openRecovery() {
  openForm('設定新密碼', `
    <p class="sub">你是從「重設密碼」的信件回來的，請設定新密碼。</p>
    ${pwField('next', `新密碼（至少 ${data.PASSWORD_MIN} 碼）`, 'new-password')}
    ${pwField('confirm', '確認新密碼', 'new-password')}`, '設定新密碼', async (form) => {
    const { next, confirm } = form.elements;
    const problem = checkNewPassword(next.value, confirm.value);
    if (problem) throw new Error(problem);
    await data.updatePassword(next.value);
    toast('新密碼已設定，下次登入請用新密碼');
    return true;
  });
}

let recoveryShown = false;
/** 每次登入狀態改變時呼叫：supabase-js 發出 PASSWORD_RECOVERY，或網址本來就帶 type=recovery，就開「設定新密碼」 */
export function watchRecovery(session, event) {
  if (!session || recoveryShown) return;
  if (event === 'PASSWORD_RECOVERY' || recoveryInUrl) {
    recoveryShown = true;
    openRecovery();
  }
}

export function initAccount() {
  $('#account-btn').onclick = openChangePassword;
  if (authUrlError) {
    // 例如重設連結過期：hash 帶 error_description。清掉 hash，避免被當成頁面路由
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    setTimeout(() => toast(`連結無效或已過期，請重新申請重設密碼（${authUrlError}）`, true), 800);
  }
}
