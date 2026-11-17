// 外觀主題（20261117）：在 <head> 同步執行，畫面畫出來之前就把 data-theme 設好，避免先閃一下預設主題。
// 偏好只記在這台裝置（localStorage，和側欄收合一樣），不是資料；讀不到時用預設「手帳日頁」。
// 選擇介面在 theme.js；兩邊共用 window.lifeosTheme。
(function () {
  var THEMES = ['journal', 'warm', 'clean', 'dark'];
  var COLORS = { journal: '#173b34', warm: '#181715', clean: '#f6f5f4', dark: '#0f1a17' }; // 手機瀏覽器網址列顏色＝側欄色
  var KEY = 'lifeos-theme', AUTO_KEY = 'lifeos-theme-auto-dark';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function write(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 私密模式：只在這次有效 */ } }
  function chosen() { var t = read(KEY); return THEMES.indexOf(t) >= 0 ? t : 'journal'; }
  function autoDark() { return read(AUTO_KEY) === '1'; }
  // 實際套用的主題：勾了「跟隨系統」且系統是深色 → 深色夜間；否則用選的那款
  function resolved() { return autoDark() && mq && mq.matches ? 'dark' : chosen(); }
  function apply() {
    var t = resolved(), root = document.documentElement;
    if (t === 'journal') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[t]);
    try { document.dispatchEvent(new CustomEvent('lifeos:theme-changed', { detail: { theme: t } })); } catch (e) { /* 舊瀏覽器 */ }
  }
  if (mq) { if (mq.addEventListener) mq.addEventListener('change', function () { if (autoDark()) apply(); }); else if (mq.addListener) mq.addListener(function () { if (autoDark()) apply(); }); }
  window.lifeosTheme = {
    THEMES: THEMES, chosen: chosen, autoDark: autoDark, resolved: resolved, apply: apply,
    set: function (t, auto) {
      if (THEMES.indexOf(t) >= 0) write(KEY, t === 'journal' ? null : t);
      if (typeof auto === 'boolean') write(AUTO_KEY, auto ? '1' : null);
      apply();
    }
  };
  apply();
})();
