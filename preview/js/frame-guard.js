// 資安 20261111（C）：防止被別的網站用 iframe 嵌入（點擊劫持）。
// GitHub Pages 不能自訂回應標頭，而 <meta> 的 CSP 不支援 frame-ancestors，所以改在程式啟動時檢查：
// 被嵌入就只顯示一行說明，並讓 app.js 永遠不執行（這個模組的 top-level await 不會結束，匯入它的 app.js 就停在這裡）。
let framed;
try { framed = window.top !== window.self; } catch { framed = true; } // 跨網域讀 top 會丟錯，也算被嵌入

if (framed) {
  document.body.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'frame-notice';
  p.textContent = 'Life OS 不能嵌在其他網頁裡使用，請直接在瀏覽器分頁開啟。';
  document.body.appendChild(p);
  await new Promise(() => {});
}
