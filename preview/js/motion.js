/**
 * 動態與轉場（規範見 docs/03-ui-guidelines.md「動態規範」；樣式在 style.css 最後的「動態與轉場」區塊）
 * - pageEnter：換頁時內容區翻頁進場，清單項目只在這時錯開淡入（資料更新重畫不重播）
 * - watchStatNumbers：今日欄數字真的變了才短暫強調；計時中每秒跳動的數字不觸發
 * 使用者設定「減少動態」時全部不做。
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

// 進場類別保留的時間：頁面 220ms＋清單最多錯開 8 格×30ms＋單格 260ms，再留一點餘裕
const ENTER_MS = 650;
let enterTimer = null;
let enteringUntil = 0;

/** 換頁：重新開始進場動畫。快速連點時先拿掉舊的類別再加，不會疊加。 */
export function pageEnter(main) {
  clearTimeout(enterTimer);
  main.classList.remove('page-enter');
  if (reduced.matches) return;
  void main.offsetWidth; // 強制重排，讓同一個類別能重新觸發動畫
  main.classList.add('page-enter');
  enteringUntil = performance.now() + ENTER_MS;
  enterTimer = setTimeout(() => main.classList.remove('page-enter'), ENTER_MS);
}

/** 監看 root 裡的 .stat-num：文字和上次不同時加 .num-bump（進場期間、含即時計時的數字只記錄不強調） */
export function watchStatNumbers(root) {
  const last = new WeakMap();
  const check = (el) => {
    const text = el.textContent.trim();
    const prev = last.get(el);
    last.set(el, text);
    if (prev === undefined || prev === text) return;
    if (reduced.matches || performance.now() < enteringUntil) return;
    if (el.querySelector('[data-since]')) return; // 計時中：每秒更新，不強調
    el.classList.remove('num-bump');
    void el.offsetWidth;
    el.classList.add('num-bump');
  };
  new MutationObserver((records) => {
    const hit = new Set();
    for (const r of records) {
      const node = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      const el = node?.closest('.stat-num');
      if (el) hit.add(el);
      else if (node && r.type === 'childList') node.querySelectorAll?.('.stat-num').forEach((x) => hit.add(x));
    }
    hit.forEach(check);
  }).observe(root, { childList: true, characterData: true, subtree: true });
  root.addEventListener('animationend', (e) => {
    if (e.animationName === 'num-bump') e.target.classList.remove('num-bump');
  });
}
