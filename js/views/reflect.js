// 內在整理（顯化規劃・階段三，20261108）：轉念／釋放／我允許三種便籤，共用 reflections 表。
// 資料不在 store，這頁自己讀；儲存、篩選、統計、轉任務都在 data.js「內在整理 20261108」，這裡只負責畫面。
import * as data from '../data.js';
import { state, refreshTasks } from '../store.js';
import { $, esc, toast, confirmDialog } from '../ui.js';
import { openTaskEditor } from './task-actions.js';
import { today } from '../dates.js';

const FILTER_KEY = 'lifeos-reflect-filter';
const KIND_HINT = {
  mindshift: '把「發生的事」和「腦中補上的故事」分開，再換個角度看。',
  release: '感覺它、允許它，然後一次一次放下。',
  allow: '寫下想要的，聽聽心裡的「但是」，再允許自己。',
};
// 各便籤的文字欄：[name, 標題, 提示]；name 以 f. 開頭的存在 fields
const FORMS = {
  mindshift: [
    ['event', '發生了什麼／卡住我的觀點', '例如：主管說報告「再想想」'],
    ['cols', [['f.facts', '事實', '只寫看得到、聽得到的：誰、說了什麼、做了什麼'], ['f.imagined', '想像', '我腦中補上的解讀：他一定覺得我不夠好…']]],
    ['f.ideal', '理想的自己會怎麼面對？這件事對我有什麼好處？', '換成最穩定、最有餘裕的那個我'],
    ['f.rebut', '看著自己的想像，有什麼感受？怎麼反駁它？', '這個想像有證據嗎？還有哪些可能？'],
    ['feeling_after', '分清楚之後的感受', ''],
    ['next_action', '下一步行動', '一個小小、今天做得到的動作'],
  ],
  release: [
    ['event', '想釋放的事件或念頭', '現在最卡的那件事'],
  ],
  release2: [
    ['f.body', '身體哪裡有感覺？', '胸口悶、肩膀緊、胃縮起來…'],
  ],
  release3: [
    ['feeling_after', '之後的感受', ''],
    ['next_action', '下一步', '放下之後想做的一件事'],
  ],
  allow: [
    ['event', '我想要的生活／想成為的人／想擁有的', '寫成已經發生的樣子也可以'],
    ['f.but', '「但是…」腦中冒出的反對聲音或畫面', '例如：但是我沒有那個條件…'],
    ['f.rebut', '反駁它', '這個「但是」真的成立嗎？我有哪些反例？'],
    ['feeling_after', '現在的感受', ''],
    ['next_action', '計畫／下一步', '朝它走的一小步'],
  ],
};
// 釋放的引導提問（自己寫的；照順序慢慢問自己）
const RELEASE_PROMPTS = [
  '先不推開它：可以讓這個感受在這裡待一會兒嗎？',
  '它底下藏著哪一種想要？可以把那個想要鬆開一點點嗎？',
  '如果可以放下，你願意放下嗎？',
  '什麼時候放下？——此刻也可以。',
  '放下了就按一下 +1，再感覺一次，還有剩下的嗎？',
];

function loadFilter() {
  try { return { kind: '', q: '', from: '', to: '', ...JSON.parse(localStorage.getItem(FILTER_KEY) || '{}'), q: '' }; } catch { return { kind: '', q: '', from: '', to: '' }; }
}

let reflectDialog = null;
function dialogEl() {
  if (!reflectDialog) {
    reflectDialog = document.createElement('dialog');
    reflectDialog.id = 'reflect-dialog';
    reflectDialog.className = 'rf-dialog';
    document.body.append(reflectDialog);
  }
  return reflectDialog;
}

const val = (r, name) => (name.startsWith('f.') ? r.fields?.[name.slice(2)] : r[name]) || '';
const textField = (r, [name, label, ph]) => `
  <label class="rf-field">${esc(label)}<textarea name="${name}" rows="${name === 'event' ? 2 : 3}" maxlength="4000" placeholder="${esc(ph || '')}">${esc(val(r, name))}</textarea></label>`;
const fieldsHTML = (r, list) => list.map((f) => (f[0] === 'cols'
  ? `<div class="rf-cols">${f[1].map((c) => textField(r, c)).join('')}</div>` : textField(r, f))).join('');

/** 0～10 的強度刻度（再點一次已選的＝取消） */
const scaleHTML = (name, label, v) => `
  <div class="rf-scale-row"><span class="rf-scale-k" id="rf-${name}-k">${label}</span>
    <div class="rf-scale" role="group" aria-labelledby="rf-${name}-k" data-scale="${name}">${Array.from({ length: 11 }, (_, i) =>
      `<button type="button" data-v="${i}" aria-pressed="${v === i}" aria-label="${label} ${i}">${i}</button>`).join('')}</div></div>`;

export function mountReflect(root) {
  const ui = loadFilter();
  let items = [];
  let loaded = false;

  root.innerHTML = `
    <header class="page-head rf-head">
      <div><h1>內在整理</h1><p class="sub">卡住的時候寫一張便籤：轉念、釋放、我允許。</p></div>
    </header>
    <div class="rf-new" role="group" aria-label="寫一張新便籤">
      ${Object.entries(data.REFLECT_KINDS).map(([k, label]) => `
        <button type="button" class="rf-new-btn rf-k-${k}" data-new="${k}">
          <span class="rf-new-t">＋${label}</span><span class="rf-new-d">${KIND_HINT[k]}</span>
        </button>`).join('')}
    </div>
    <section class="card rf-stats" id="rf-stats" aria-labelledby="rf-stats-h"></section>
    <section class="card rf-page">
      <h2>寫過的便籤</h2>
      <div class="rf-filters">
        <div class="seg" id="rf-kinds" role="group" aria-label="依類型篩選"></div>
        <input type="search" id="rf-q" placeholder="搜尋內容、情緒…" aria-label="搜尋便籤" value="">
        <span class="rf-dates">
          <input type="date" id="rf-from" aria-label="從哪天" value="${esc(ui.from)}"><span aria-hidden="true">～</span>
          <input type="date" id="rf-to" aria-label="到哪天" value="${esc(ui.to)}">
          <button type="button" class="btn-ghost" id="rf-clear" hidden>清除日期</button>
        </span>
      </div>
      <ul class="rf-list" id="rf-list"></ul>
    </section>`;

  const persist = () => { try { localStorage.setItem(FILTER_KEY, JSON.stringify({ kind: ui.kind, from: ui.from, to: ui.to })); } catch { /* 忽略 */ } };
  root.querySelector('.rf-new').addEventListener('click', (e) => {
    const b = e.target.closest('[data-new]');
    if (b) openEditor({ kind: b.dataset.new, entry_date: today(), fields: {}, wants: [], emotions: [], release_count: 0 });
  });
  $('#rf-kinds', root).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) { ui.kind = b.dataset.v; persist(); render(); }
  });
  $('#rf-q', root).addEventListener('input', (e) => { ui.q = e.target.value; render(); });
  $('#rf-from', root).addEventListener('change', (e) => { ui.from = e.target.value; persist(); render(); });
  $('#rf-to', root).addEventListener('change', (e) => { ui.to = e.target.value; persist(); render(); });
  $('#rf-clear', root).onclick = () => { ui.from = ''; ui.to = ''; $('#rf-from', root).value = ''; $('#rf-to', root).value = ''; persist(); render(); };

  $('#rf-list', root).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-id]');
    const r = li && items.find((x) => x.id === li.dataset.id);
    if (!r) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'task') return openTaskDialog(r);
    if (act === 'open-task') {
      const t = state.tasks.find((x) => x.id === r.task_id);
      if (t) openTaskEditor(t); else toast('找不到這件任務（可能已刪除）', true);
      return;
    }
    if (act === 'delete') return remove(r);
    if (act === 'edit' || e.target.closest('.rf-main')) openEditor(r);
  });

  async function remove(r) {
    if (!(await confirmDialog(`把這張${data.REFLECT_KINDS[r.kind]}便籤（${data.reflectionTitle(r)}）移到垃圾桶？30 天內可在「數據與備份」還原。`))) return false;
    try {
      await data.deleteReflection(r.id);
      await load();
      toast('已移到垃圾桶');
      return true;
    } catch (err) { toast(err.message, true); return false; }
  }

  /** 新增／編輯便籤 */
  function openEditor(src) {
    const r = { ...src, fields: { ...(src.fields || {}) }, wants: [...(src.wants || [])], emotions: [...(src.emotions || [])] };
    const dlg = dialogEl();
    const kind = r.kind;
    const isRelease = kind === 'release';
    const known = new Set(Object.values(data.REFLECT_EMOTIONS).flat());
    dlg.innerHTML = `
      <form class="rf-form rf-k-${kind}" novalidate>
        <div class="rf-form-head">
          <h2><span class="rf-stamp">${data.REFLECT_KINDS[kind]}</span>${r.id ? '編輯便籤' : '寫一張便籤'}</h2>
          <label class="rf-date">日期<input type="date" name="entry_date" required value="${esc(r.entry_date || today())}"></label>
        </div>
        <p class="sub rf-hint">${KIND_HINT[kind]}</p>
        ${isRelease ? `
          ${fieldsHTML(r, FORMS.release)}
          <fieldset class="rf-group"><legend>這背後是哪一種想要？（可複選）</legend>
            <div class="rf-wants">${Object.entries(data.REFLECT_WANTS).map(([k, label]) =>
              `<button type="button" class="rf-chip rf-want" data-want="${k}" aria-pressed="${r.wants.includes(k)}">${label}</button>`).join('')}</div>
          </fieldset>
          <fieldset class="rf-group"><legend>點選現在的情緒（可複選，也可以自己寫）</legend>
            ${Object.entries(data.REFLECT_EMOTIONS).map(([k, words]) => `
              <div class="rf-emo-g"><span class="rf-emo-k">${data.REFLECT_WANTS[k]}</span>
                <div class="rf-emos">${words.map((w) => `<button type="button" class="rf-chip" data-emo="${esc(w)}" aria-pressed="${r.emotions.includes(w)}">${esc(w)}</button>`).join('')}</div></div>`).join('')}
            <div class="rf-emo-g"><span class="rf-emo-k">自己寫的</span><div class="rf-emos" id="rf-own"></div></div>
            <div class="rf-own-add"><input id="rf-own-in" maxlength="20" placeholder="其他情緒，例如：空虛" aria-label="自己輸入情緒">
              <button type="button" class="btn-ghost" id="rf-own-btn">加入</button></div>
          </fieldset>
          ${fieldsHTML(r, FORMS.release2)}
          <div class="rf-guide">
            <ol>${RELEASE_PROMPTS.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
            <div class="rf-counter">
              <button type="button" class="btn-ghost rf-minus" data-count="-1" aria-label="放下次數減一">−</button>
              <output class="rf-count" aria-live="polite"><b id="rf-count">${r.release_count || 0}</b><small>次放下</small></output>
              <button type="button" class="btn-primary rf-plus" data-count="1">放下一次 +1</button>
            </div>
            ${scaleHTML('intensity_before', '開始時的強度', r.intensity_before ?? null)}
            ${scaleHTML('intensity_after', '結束時的強度', r.intensity_after ?? null)}
            <p class="sub rf-scale-note">0＝完全平靜，10＝最強烈；再點一次已選的可以取消。</p>
          </div>
          ${fieldsHTML(r, FORMS.release3)}
          <fieldset class="rf-group"><legend>順便記下這天的心情？（可不選；和每日復盤、年度手帳同一份）</legend>
            <div class="mood-pick" id="rf-mood">${[1, 2, 3, 4, 5].map((v) =>
              `<button type="button" data-v="${v}" aria-pressed="false" title="${v} ${data.MOOD_LEVELS[v]}"><i class="sw m${v}" aria-hidden="true"></i>${v}<span class="mood-word"> ${data.MOOD_LEVELS[v]}</span></button>`).join('')}</div>
          </fieldset>`
        : fieldsHTML(r, FORMS[kind])}
        <div class="dialog-actions rf-actions">
          ${r.id ? '<button type="button" class="btn-ghost danger rf-del" data-del>移到垃圾桶</button>' : ''}
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">儲存</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    let mood = null;
    const renderOwn = () => {
      const own = $('#rf-own', dlg);
      if (!own) return;
      const mine = r.emotions.filter((w) => !known.has(w));
      own.innerHTML = mine.length ? mine.map((w) => `<button type="button" class="rf-chip" data-emo="${esc(w)}" aria-pressed="true" title="再點一次移除">${esc(w)} ✕</button>`).join('')
        : '<span class="sub">（還沒有）</span>';
    };
    renderOwn();
    const addOwn = () => {
      const inp = $('#rf-own-in', dlg);
      const w = inp.value.trim();
      if (!w) return;
      if (!r.emotions.includes(w)) r.emotions.push(w);
      inp.value = '';
      dlg.querySelectorAll(`[data-emo="${CSS.escape(w)}"]`).forEach((b) => b.setAttribute('aria-pressed', 'true'));
      renderOwn();
      inp.focus();
    };
    $('#rf-own-btn', dlg)?.addEventListener('click', addOwn);
    $('#rf-own-in', dlg)?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addOwn(); } });

    f.addEventListener('click', (e) => {
      const want = e.target.closest('[data-want]');
      if (want) {
        const k = want.dataset.want;
        r.wants = r.wants.includes(k) ? r.wants.filter((x) => x !== k) : [...r.wants, k];
        want.setAttribute('aria-pressed', String(r.wants.includes(k)));
        return;
      }
      const emo = e.target.closest('[data-emo]');
      if (emo) {
        const w = emo.dataset.emo;
        const on = !r.emotions.includes(w);
        r.emotions = on ? [...r.emotions, w] : r.emotions.filter((x) => x !== w);
        dlg.querySelectorAll(`[data-emo="${CSS.escape(w)}"]`).forEach((b) => b.setAttribute('aria-pressed', String(on)));
        if (!known.has(w)) renderOwn();
        return;
      }
      const cnt = e.target.closest('[data-count]');
      if (cnt) {
        r.release_count = Math.max(0, (r.release_count || 0) + Number(cnt.dataset.count));
        const b = $('#rf-count', dlg);
        b.textContent = r.release_count;
        b.classList.remove('rf-bump');
        void b.offsetWidth; // 重新觸發小小的強調動態
        b.classList.add('rf-bump');
        return;
      }
      const sc = e.target.closest('[data-scale] button');
      if (sc) {
        const name = sc.parentElement.dataset.scale;
        const v = Number(sc.dataset.v);
        r[name] = r[name] === v ? null : v;
        sc.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === r[name])));
        return;
      }
      const md = e.target.closest('#rf-mood button');
      if (md) {
        const v = Number(md.dataset.v);
        mood = mood === v ? null : v;
        dlg.querySelectorAll('#rf-mood button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === mood)));
      }
    });
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    const del = $('[data-del]', dlg);
    if (del) del.onclick = async () => { if (await remove(r)) dlg.close(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const fields = {};
      for (const [k, v] of fd) if (k.startsWith('f.')) fields[k.slice(2)] = v;
      const row = { ...r, entry_date: fd.get('entry_date'), event: fd.get('event'), fields,
        feeling_after: fd.get('feeling_after'), next_action: fd.get('next_action') };
      const btn = $('.btn-primary:not(.rf-plus)', f);
      btn.disabled = true;
      try {
        await data.saveReflection(row);
        if (mood) await data.saveMood(row.entry_date, { mood });
        dlg.close();
        await load();
        toast(`${r.id ? '已更新' : '已存下'}這張${data.REFLECT_KINDS[kind]}便籤${mood ? '，也記下了這天的心情' : ''}`);
      } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
    };
    dlg.oncancel = null;
    dlg.showModal();
    f.event?.focus();
  }

  /** 下一步轉成任務：和待看清單一樣選領域、可填到期日 */
  function openTaskDialog(r) {
    const dlg = dialogEl();
    dlg.innerHTML = `
      <form>
        <h2>下一步轉成任務</h2>
        <label>任務名稱<input name="title" required maxlength="200" value="${esc((r.next_action || '').split('\n')[0].slice(0, 200))}"></label>
        <label>領域<select name="area_id" required>
          <option value="">請選擇領域</option>
          ${state.areas.map((a) => `<option value="${a.id}" ${a.id === r.area_id ? 'selected' : ''}>${esc(a.name)}${a.on_board ? '（工作看板）' : ''}</option>`).join('')}
        </select></label>
        <label>到期日<input type="date" name="due_date"></label>
        <p class="sub">任務的說明會記下來自哪張便籤；便籤上會顯示連到這件任務。</p>
        <div class="dialog-actions">
          <button type="button" class="btn-ghost" data-cancel>取消</button>
          <button class="btn-primary">建立任務</button>
        </div>
      </form>`;
    const f = $('form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    dlg.oncancel = null;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      try {
        await data.reflectionToTask(r, { title: fd.get('title'), area_id: fd.get('area_id'), due_date: fd.get('due_date') }, state.tasks);
        dlg.close();
        await Promise.all([refreshTasks(), load()]);
        const onBoard = state.areasById[fd.get('area_id')]?.on_board;
        toast(`已建立任務（${onBoard ? '在工作看板' : '在任務管理'}）`);
      } catch (err) { toast(err.message, true); }
    };
    dlg.showModal();
    f.title.focus();
  }

  async function load() {
    try {
      items = await data.listReflections();
      loaded = true;
    } catch (e) {
      toast(`讀取內在整理失敗：${e.message}`, true);
    }
    render();
  }

  function statsHTML() {
    const s = data.reflectionStats(items);
    const rel = s.release;
    return `
      <div class="rf-stats-head"><h2 id="rf-stats-h">近 30 天</h2><span class="sub">${s.from.replaceAll('-', '/')} ～ ${s.to.replaceAll('-', '/')}</span></div>
      <div class="rf-sum">
        <div><b>${s.total}</b><span>張便籤</span><small>${Object.entries(s.byKind).filter(([, n]) => n).map(([k, n]) => `${data.REFLECT_KINDS[k]} ${n}`).join('・') || '還沒有'}</small></div>
        <div><b>${rel.times}</b><span>次放下</span><small>釋放便籤的 +1 合計</small></div>
        <div><b>${rel.n ? `${rel.before}<i aria-hidden="true">→</i>${rel.after}` : '—'}</b><span>釋放前後強度</span>
          <small>${rel.n ? `平均${rel.drop > 0 ? `下降 ${rel.drop}` : rel.drop < 0 ? `上升 ${-rel.drop}` : '沒有變化'}（${rel.n} 張有填前後）` : '開始、結束都填強度才會算'}</small></div>
      </div>
      <p class="rf-top"><span class="rf-top-k">最常出現的想要</span>${s.wants.length ? s.wants.map((w) => `<span class="rf-tally">${w.label} <b>${w.n}</b></span>`).join('') : '<span class="sub">釋放便籤選了「想要」之後會出現在這裡</span>'}</p>
      <p class="rf-top"><span class="rf-top-k">常見情緒</span>${s.emotions.length ? s.emotions.map((x) => `<span class="rf-tally">${esc(x.word)} <b>${x.n}</b></span>`).join('') : '<span class="sub">釋放時點選的情緒會統計在這裡</span>'}</p>`;
  }

  function itemHTML(r) {
    const task = r.task_id ? state.tasks.find((t) => t.id === r.task_id) : null;
    const meta = [];
    if (r.kind === 'release') {
      if (r.wants?.length) meta.push(r.wants.map((w) => data.REFLECT_WANTS[w]).join('・'));
      if (r.intensity_before != null || r.intensity_after != null) meta.push(`強度 ${r.intensity_before ?? '?'} → ${r.intensity_after ?? '?'}`);
      if (r.release_count) meta.push(`放下 ${r.release_count} 次`);
    }
    const peek = r.kind === 'mindshift' ? r.fields?.imagined : r.kind === 'allow' ? r.fields?.but : r.fields?.body;
    return `
      <li class="rf-item rf-k-${r.kind}" data-id="${r.id}">
        <span class="rf-day"><b>${r.entry_date.slice(5).replace('-', '/')}</b><small>${r.entry_date.slice(0, 4)}</small></span>
        <div class="rf-main" role="button" tabindex="0" aria-label="編輯這張便籤：${esc(data.reflectionTitle(r))}">
          <span class="rf-line"><span class="rf-stamp sm">${data.REFLECT_KINDS[r.kind]}</span><span class="rf-title">${esc(data.reflectionTitle(r))}</span></span>
          ${peek ? `<span class="rf-peek">${esc(peek)}</span>` : ''}
          ${r.emotions?.length ? `<span class="rf-emo-line">${r.emotions.slice(0, 8).map((w) => `<span class="rf-chip sm">${esc(w)}</span>`).join('')}${r.emotions.length > 8 ? `<span class="sub">＋${r.emotions.length - 8}</span>` : ''}</span>` : ''}
          ${meta.length ? `<span class="rf-meta">${esc(meta.join('｜'))}</span>` : ''}
          ${r.feeling_after ? `<span class="rf-after">之後：${esc(r.feeling_after)}</span>` : ''}
        </div>
        <div class="rf-next">
          ${r.next_action ? `<span class="rf-next-t"><span class="rf-next-k">下一步</span>${esc(r.next_action)}</span>` : ''}
          <span class="rf-acts">
            ${task ? `<button type="button" class="btn-ghost rf-linked${task.status === 'done' ? ' is-done' : ''}" data-act="open-task" title="打開任務">→ 任務：${esc(task.title)}${task.status === 'done' ? '（已完成）' : ''}</button>`
              : r.next_action ? '<button type="button" class="btn-ghost" data-act="task">轉任務</button>' : ''}
            <button type="button" class="btn-ghost" data-act="edit">編輯</button>
            <button type="button" class="btn-ghost danger" data-act="delete">刪除</button>
          </span>
        </div>
      </li>`;
  }

  function render() {
    if (!root.isConnected || !$('#rf-list', root)) return;
    $('#rf-stats', root).innerHTML = loaded ? statsHTML() : '<p class="sub">讀取中…</p>';
    const counts = Object.fromEntries(Object.keys(data.REFLECT_KINDS).map((k) => [k, items.filter((r) => r.kind === k).length]));
    $('#rf-kinds', root).innerHTML = [['', '全部', items.length], ...Object.entries(data.REFLECT_KINDS).map(([k, l]) => [k, l, counts[k]])]
      .map(([k, l, n]) => `<button type="button" data-v="${k}" aria-pressed="${ui.kind === k}">${l} <small>${n}</small></button>`).join('');
    $('#rf-clear', root).hidden = !ui.from && !ui.to;
    const shown = data.filterReflections(items, ui);
    const filtering = ui.kind || ui.q.trim() || ui.from || ui.to;
    $('#rf-list', root).innerHTML = shown.length ? shown.map(itemHTML).join('')
      : `<li class="empty">${!loaded ? '讀取中…' : items.length && filtering ? '這個篩選下沒有便籤。' : '還沒有便籤。心裡卡住的時候，按上面的「＋轉念」「＋釋放」或「＋我允許」寫一張。'}</li>`;
  }

  // 鍵盤：在便籤內容上按 Enter／空白鍵＝編輯
  $('#rf-list', root).addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('rf-main')) { e.preventDefault(); e.target.click(); }
  });

  load();
  return render; // store 更新（例如任務改名、完成）時重畫；便籤本身由這頁自己讀
}
