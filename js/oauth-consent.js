// AI 連接授權頁（20261118，docs/16-ai-agent-plan.md）：Claude 等 MCP 用戶端要連 Life OS 時，Supabase Auth 會轉到這頁並帶 authorization_id。
// 使用者用 Life OS 帳號登入後，看清楚是哪個用戶端、要什麼，再按「允許」或「拒絕」；結果交給 Supabase，Supabase 給出轉回用戶端的網址。
import './frame-guard.js';
import { supabase } from './supabase.js';
import { esc } from './ui.js';

const box = document.getElementById('consent');
const id = new URLSearchParams(location.search).get('authorization_id');
const SCOPE = { openid: '確認你的身分', email: '你的 Email（只用來識別帳號）', profile: '基本個人資料', phone: '電話號碼' };

function show(html) { box.innerHTML = html; }

async function loginForm(msg = '') {
  show(`<h1>登入 Why Am I Here?</h1>
    <p class="sub">有 AI 要連接你的 Life OS，先登入確認是你。</p>
    ${msg ? `<p class="warn">${esc(msg)}</p>` : ''}
    <form id="cf-login" class="consent-form">
      <label>Email<input name="email" type="email" autocomplete="username" required></label>
      <label>密碼<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn-primary">登入</button>
    </form>`);
  document.getElementById('cf-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
    if (error) loginForm('登入失敗：Email 或密碼不正確');
    else run();
  };
}

async function run() {
  if (!supabase) { show('<p class="warn">這個頁面需要連到 Supabase，請在正式網站開啟。</p>'); return; }
  if (!id) { show('<h1>沒有授權請求</h1><p class="sub">這個頁面是 AI 連接 Life OS 時自動打開的，直接開沒有作用。</p><p><a href="./">回到首頁</a></p>'); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { loginForm(); return; }
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
  if (error) { show(`<h1>無法處理這個授權</h1><p class="warn">${esc(error.message)}</p><p class="sub">可能已經過期（授權請求 10 分鐘內有效），請回到 Claude 重新連接一次。</p>`); return; }
  if (!('authorization_id' in data)) { location.href = data.redirect_url; return; } // 之前已經允許過
  let host = '';
  try { host = new URL(data.redirect_uri).hostname; } catch { host = data.redirect_uri; }
  const scopes = String(data.scope || '').split(/\s+/).filter(Boolean);
  show(`<h1>允許「${esc(data.client?.name || '未命名的應用程式')}」連接你的 Life OS？</h1>
    <p>登入帳號：<b>${esc(data.user?.email || '')}</b></p>
    <p>授權後會轉回：<b>${esc(host)}</b></p>
    <div class="consent-box">
      <p><b>它可以：</b></p>
      <ul>
        <li>讀取你的任務、每日復盤、內在整理、專案目標、習慣、飲食與保健、收藏（靈感、待看清單、書影單、佳句、工具）。</li>
        <li>新增任務（標題前會加「AI｜」）、寫 AI 洞察。</li>
      </ul>
      <p><b>它拿不到：</b>跟進對象與聯絡紀錄、回饋、Google 會議、Google 日曆私密網址、帳號 Email；任務說明與進度紀錄、書影單心得也不給。所有文字裡的 Email、電話、LINE ID、社群帳號都會先換成「［已隱藏］」。</p>
      ${scopes.length ? `<p class="sub">登入資訊範圍：${scopes.map((s) => esc(SCOPE[s] || s)).join('、')}</p>` : ''}
    </div>
    <p class="sub">之後可以在網站的總覽「AI 洞察」→「管理 AI 連接」隨時撤銷。</p>
    <div class="dialog-actions">
      <button type="button" class="btn-ghost" id="cf-deny">拒絕</button>
      <button type="button" class="btn-primary" id="cf-allow">允許</button>
    </div>`);
  const decide = async (allow) => {
    document.querySelectorAll('#consent button').forEach((b) => { b.disabled = true; });
    const { data: r, error: e } = allow ? await supabase.auth.oauth.approveAuthorization(id) : await supabase.auth.oauth.denyAuthorization(id);
    if (e) { show(`<p class="warn">${esc(e.message)}</p>`); return; }
    location.href = r.redirect_url;
  };
  document.getElementById('cf-allow').onclick = () => decide(true);
  document.getElementById('cf-deny').onclick = () => decide(false);
}
run();
