// 外觀主題選擇（20261117，使用者：「想要有新皮膚，可以選擇換主題」）
// 套用與記錄由 theme-boot.js（window.lifeosTheme）負責；這裡只做選擇視窗。只記在這台裝置，不寫資料庫。
// 各主題的顏色、字型在 style.css 末段「外觀主題」；對照見 DESIGN.md「外觀主題」。
import { $, esc } from './ui.js?v=202611211924';

export const THEME_INFO = [
  { id: 'journal', name: '手帳日頁', note: '方格紙、墨綠書布側欄、楷體（預設）', sw: ['#f6f8f5', '#173b34', '#1c2a4a'] },
  { id: 'warm', name: '暖米白', note: '米白底、深色側欄、陶土橘按鈕、霞鶩文楷 Mono', sw: ['#faf9f5', '#181715', '#b35e3e'] },
  { id: 'clean', name: '簡潔白', note: '白底、淺灰側欄、紫色按鈕、圓體', sw: ['#ffffff', '#f6f5f4', '#5645d4'] },
  { id: 'dark', name: '深色夜間', note: '深色底、亮字、圓體，晚上不刺眼', sw: ['#16191b', '#0f1a17', '#4f6fc8'] },
];

const T = () => window.lifeosTheme;

function dlg() {
  let d = $('#theme-dialog');
  if (!d) { d = document.createElement('dialog'); d.id = 'theme-dialog'; document.body.append(d); }
  return d;
}

export function openThemeDialog() {
  if (!T()) return;
  const d = dlg();
  const cur = T().chosen();
  d.innerHTML = `
    <form method="dialog" class="theme-form">
      <h2>外觀主題</h2>
      <p class="sub">選了馬上換；只記在這台裝置，手機和電腦可以各用各的。</p>
      <div class="theme-list" role="radiogroup" aria-label="外觀主題">
        ${THEME_INFO.map((t) => `
          <label class="theme-opt">
            <input type="radio" name="theme" value="${t.id}" ${t.id === cur ? 'checked' : ''}>
            <span class="theme-sw" aria-hidden="true">${t.sw.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>
            <span class="theme-txt"><b>${esc(t.name)}</b><small>${esc(t.note)}</small></span>
          </label>`).join('')}
      </div>
      <label class="check"><input type="checkbox" name="auto" ${T().autoDark() ? 'checked' : ''}> 系統是深色模式時，自動改用「深色夜間」</label>
      <div class="dialog-actions"><button value="close" class="btn-primary">完成</button></div>
    </form>`;
  const form = d.querySelector('form');
  form.addEventListener('change', () => {
    T().set(form.theme.value, form.auto.checked);
  });
  d.showModal();
}

export function initTheme() {
  const btn = $('#theme-btn');
  if (btn) btn.onclick = openThemeDialog;
}
