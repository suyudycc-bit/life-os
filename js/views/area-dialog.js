// 新增領域視窗；回傳建立的領域，取消則回傳 null
import * as data from '../data.js';
import { $, esc, toast } from '../ui.js';

const PALETTE = ['#d64f7a', '#1f9bb0', '#7a8b2e', '#b5652b', '#5560c9', '#8f6b4a'];

export function openAreaDialog(areas, { onBoard = false } = {}) {
  const dlg = $('#area-dialog');
  const used = new Set(areas.map((a) => a.color));
  const color = PALETTE.find((c) => !used.has(c)) || PALETTE[0];
  dlg.innerHTML = `
    <form>
      <h2>新增領域</h2>
      <label>名稱<input name="name" required maxlength="30" placeholder="例如：家庭、理財、語言學習"></label>
      <div class="row">
        <label>類型<select name="kind">
          ${Object.entries(data.AREA_KINDS).map(([k, l]) => `<option value="${k}" ${k === 'life' ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select></label>
        <label>顏色<input type="color" name="color" value="${color}"></label>
      </div>
      <label class="check"><input type="checkbox" name="on_board" ${onBoard ? 'checked' : ''}> 列入工作看板（之後可在工作看板的「列入設定」改）</label>
      <p class="sub">類型用於之後的統計分組；顏色會用在任務標籤、日曆與圖表。</p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" data-cancel>取消</button>
        <button class="btn-primary">建立</button>
      </div>
    </form>`;
  const form = $('form', dlg);
  // 與 confirmDialog 相同：不依賴非同步的 close 事件
  return new Promise((resolve) => {
    const done = (area) => {
      dlg.oncancel = null;
      dlg.close();
      resolve(area);
    };
    $('[data-cancel]', dlg).onclick = () => done(null);
    dlg.oncancel = (e) => { e.preventDefault(); done(null); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        done(await data.createArea({ name: form.name.value, kind: form.kind.value, color: form.color.value, on_board: form.on_board.checked }, areas));
      } catch (err) {
        toast(err.message, true);
      }
    };
    dlg.showModal();
    form.name.focus();
  });
}
