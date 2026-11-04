// 跟進對象（20261106，C1）：名單依階段分組、聯絡紀錄時間軸、今天該跟進、階段設定、心法筆記。
// 資料在 contact_stages／contacts／contact_logs（不在 store，這頁自己讀）；計算都在 data.js（跟進對象段落）。
// 階段、提醒天數、聯絡類型都可自訂；預設值只是起點，不代表任何老師的心法（docs/11 Q2）。
import * as data from '../data.js';
import { state, refreshNotes } from '../store.js';
import { $, esc, toast, confirmDialog, linkify, formatDateTime } from '../ui.js';
import { openNoteDialog } from './notes.js';
import { today, formatShort } from '../dates.js';

const TAB_KEY = 'lifeos-contacts-tab';

/** 第一次用到時建立對話框（不改 index.html） */
function dialogEl() {
  let dlg = document.getElementById('contact-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'contact-dialog';
    dlg.className = 'wide ct-dialog';
    document.body.append(dlg);
  }
  return dlg;
}

const kindOptions = () => data.CONTACT_LOG_KINDS.map((k) => `<option value="${esc(k)}"></option>`).join('');

/** 最近聯絡的文字 */
function lastText(c, day) {
  const d = data.contactDaysSince(c.last_contact_on, day);
  if (d == null) return '還沒聯絡';
  return d <= 0 ? '今天聯絡' : `${d} 天前聯絡`;
}
/** 下次跟進日的標記（今天＝螢光黃、逾期＝朱紅） */
function nextHTML(c, day) {
  if (!c.next_follow_on) return '';
  const cls = c.next_follow_on < day ? 'ct-overdue' : c.next_follow_on === day ? 'ct-due' : '';
  const word = c.next_follow_on < day ? '逾期' : c.next_follow_on === day ? '今天跟進' : '下次';
  return `<span class="ct-next ${cls}">${word} ${formatShort(c.next_follow_on)}</span>`;
}

export function mountContacts(root) {
  const ui = { q: '', tag: '', archived: false, tab: 'list' };
  try { ui.tab = localStorage.getItem(TAB_KEY) === 'notes' ? 'notes' : 'list'; } catch { /* 忽略 */ }
  let stages = [];
  let contacts = [];
  let loaded = false;
  let failed = '';

  root.innerHTML = `
    <header class="page-head cal-head ct-head">
      <div><h1>跟進對象</h1><p class="sub" id="ct-count"></p></div>
      <div class="ct-head-actions">
        <button type="button" class="btn-ghost" id="ct-stages">階段設定</button>
        <button type="button" class="btn-primary" id="ct-new">＋ 新增對象</button>
      </div>
    </header>
    <div class="seg ct-tabs" role="group" aria-label="切換名單與心法筆記">
      <button type="button" data-tab="list">名單</button>
      <button type="button" data-tab="notes">心法筆記</button>
    </div>
    <div id="ct-list-tab">
      <section class="card ct-follow" id="ct-follow">
        <h2>今天該跟進</h2>
        <ul class="ct-follow-list" id="ct-follow-list"></ul>
      </section>
      <section class="card ct-tools">
        <input type="search" id="ct-q" class="nt-search" placeholder="搜尋姓名、電話、LINE、興趣產品、備註…" aria-label="搜尋跟進對象">
        <div class="ct-tools-row">
          <div class="nt-tags" id="ct-tags" aria-label="依標籤篩選"></div>
          <label class="check"><input type="checkbox" id="ct-archived"> 顯示已封存</label>
        </div>
      </section>
      <div class="ct-board" id="ct-board"></div>
    </div>
    <div id="ct-notes-tab" hidden>
      <section class="card">
        <div class="day-head"><h2>心法筆記</h2><button type="button" class="btn-primary" id="ct-note-new">＋ 新增筆記</button></div>
        <p class="sub">這裡的筆記存在「靈感知識庫」，標籤是 #${esc(data.CONTACT_NOTE_TAG)}；兩邊看到的是同一則。</p>
      </section>
      <div class="nt-grid" id="ct-notes"></div>
    </div>
    <p class="sub ct-privacy">個資提醒：這些聯絡資料只存在你自己的帳號（資料庫以 RLS 限定只有本人讀得到）；在「數據與備份」匯出備份時，會包含跟進對象、聯絡紀錄與階段設定，備份檔請妥善保管。</p>`;

  async function load() {
    try {
      stages = await data.ensureContactStages(); // 第一次使用時建立預設階段（之後可改）
      contacts = await data.listContacts();
      failed = '';
    } catch (e) {
      failed = e.message;
    }
    loaded = true;
    render();
  }

  // ---- 事件 ----
  $('#ct-new', root).onclick = () => openContact(null);
  $('#ct-stages', root).onclick = () => openStages();
  $('#ct-q', root).addEventListener('input', (e) => { ui.q = e.target.value; render(); });
  $('#ct-archived', root).addEventListener('change', (e) => { ui.archived = e.target.checked; render(); });
  $('#ct-tags', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]');
    if (b) { ui.tag = ui.tag === b.dataset.tag ? '' : b.dataset.tag; render(); }
  });
  root.querySelector('.ct-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    ui.tab = b.dataset.tab;
    try { localStorage.setItem(TAB_KEY, ui.tab); } catch { /* 忽略 */ }
    render();
  });
  $('#ct-follow-list', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-log]');
    const c = b && contacts.find((x) => x.id === b.dataset.log);
    if (c) { openLogOnly(c); return; }
    const o = e.target.closest('[data-open]');
    const c2 = o && contacts.find((x) => x.id === o.dataset.open);
    if (c2) openContact(c2);
  });

  const board = $('#ct-board', root);
  board.addEventListener('click', (e) => {
    if (e.target.closest('select, a')) return;
    const card = e.target.closest('.ct-card');
    const c = card && contacts.find((x) => x.id === card.dataset.id);
    if (c) openContact(c);
  });
  board.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.ct-card')) { e.preventDefault(); e.target.click(); }
  });
  board.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-move]');
    const c = sel && contacts.find((x) => x.id === sel.dataset.move);
    if (c) await move(c, sel.value);
  });
  // 拖移改階段（電腦）；手機用卡片上的選單
  let dragId = null;
  board.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.ct-card');
    if (!card) return;
    dragId = card.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    card.classList.add('dragging');
  });
  board.addEventListener('dragend', (e) => {
    e.target.closest('.ct-card')?.classList.remove('dragging');
    board.querySelectorAll('.drop-on').forEach((x) => x.classList.remove('drop-on'));
    dragId = null;
  });
  board.addEventListener('dragover', (e) => {
    const col = dragId && e.target.closest('.ct-col');
    if (!col) return;
    e.preventDefault();
    board.querySelectorAll('.drop-on').forEach((x) => x !== col && x.classList.remove('drop-on'));
    col.classList.add('drop-on');
  });
  board.addEventListener('drop', async (e) => {
    const col = e.target.closest('.ct-col');
    const c = col && contacts.find((x) => x.id === dragId);
    if (!c) return;
    e.preventDefault();
    col.classList.remove('drop-on');
    await move(c, col.dataset.stage);
  });

  async function move(c, stageId) {
    try {
      await data.contactMoveStage(c, stageId);
      contacts = await data.listContacts();
      render();
      const st = stages.find((s) => s.id === stageId);
      toast(`${c.name} → ${st ? st.label : '未分階段'}`);
    } catch (err) { toast(err.message, true); }
  }

  $('#ct-note-new', root).onclick = () => openNoteDialog(null, { tags: [data.CONTACT_NOTE_TAG] });
  $('#ct-notes', root).addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const card = e.target.closest('[data-note]');
    const n = card && state.notes.find((x) => x.id === card.dataset.note);
    if (n) openNoteDialog(n);
  });
  $('#ct-notes', root).addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-note]')) { e.preventDefault(); e.target.click(); }
  });

  // ---- 畫面 ----
  function render() {
    if (!root.isConnected || !$('#ct-board', root)) return;
    root.querySelectorAll('.ct-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === ui.tab)));
    $('#ct-list-tab', root).hidden = ui.tab !== 'list';
    $('#ct-notes-tab', root).hidden = ui.tab !== 'notes';
    renderNotes();
    if (!loaded) { board.innerHTML = '<p class="sub">載入中…</p>'; return; }
    if (failed) {
      board.innerHTML = `<section class="card"><p class="warn">讀取跟進對象失敗：${esc(failed)}</p>
        <p class="sub">請確認已在 Supabase 執行 migration 20261106_feedback.sql。</p></section>`;
      $('#ct-follow', root).hidden = true;
      return;
    }
    const day = today();
    const stagesById = Object.fromEntries(stages.map((s) => [s.id, s]));
    const active = contacts.filter((c) => !c.archived);
    const follow = data.contactsToFollow(contacts, stages, day);
    $('#ct-count', root).textContent = `${active.length} 位${follow.length ? `・今天該跟進 ${follow.length} 位` : ''}`;

    $('#ct-follow', root).hidden = false;
    $('#ct-follow-list', root).innerHTML = follow.length ? follow.map((f) => `
      <li class="ct-follow-row ct-r-${f.reason}">
        <button type="button" class="ct-follow-name" data-open="${f.contact.id}">${esc(f.contact.name)}</button>
        <span class="ct-follow-why">${esc(data.contactFollowReason(f, stagesById))}</span>
        <button type="button" class="btn-ghost ct-log-btn" data-log="${f.contact.id}">記一筆聯絡</button>
      </li>`).join('')
      : `<li class="empty">${active.length ? '今天沒有要跟進的人。記聯絡紀錄時順手排好下次跟進日，到期就會出現在這裡。' : '還沒有對象。按右上角「＋ 新增對象」加入第一位。'}</li>`;

    const tags = data.contactTagCounts(contacts);
    if (ui.tag && !tags.some(([t]) => t === ui.tag)) ui.tag = '';
    $('#ct-tags', root).innerHTML = tags.map(([t, n]) =>
      `<button type="button" class="tag-btn" data-tag="${esc(t)}" aria-pressed="${ui.tag === t}">#${esc(t)} <small>${n}</small></button>`).join('');

    const list = data.contactFilter(contacts, ui);
    const filtering = ui.q || ui.tag;
    const groups = data.contactsByStage(list, stages);
    const stageOpts = (sel) => `${stages.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
      ${!stagesById[sel] ? '<option value="" selected>未分階段</option>' : ''}`;
    board.innerHTML = groups.map((g) => `
      <section class="ct-col" data-stage="${g.stage?.id || ''}" aria-label="${esc(g.stage?.label || '未分階段')}">
        <h3 class="ct-col-head"><span>${esc(g.stage?.label || '未分階段')}</span><span class="ct-col-n">${g.contacts.length}</span>
          ${g.stage?.follow_days ? `<span class="ct-col-rule">${g.stage.follow_days} 天提醒</span>` : ''}</h3>
        <ul class="ct-cards">${g.contacts.map((c) => `
          <li class="ct-card${c.archived ? ' archived' : ''}" data-id="${c.id}" draggable="true" tabindex="0" role="button" aria-label="打開 ${esc(c.name)} 的資料">
            <div class="ct-card-top"><b class="ct-name">${esc(c.name)}</b>${c.archived ? '<span class="ct-arch">已封存</span>' : ''}${nextHTML(c, day)}</div>
            <div class="ct-meta">${lastText(c, day)}${c.source ? `・${esc(c.source)}` : ''}</div>
            ${c.interests ? `<p class="ct-int">${esc(c.interests)}</p>` : ''}
            ${(c.tags || []).length ? `<div class="ct-card-tags">${c.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : ''}
            <div class="ct-move"><select data-move="${c.id}" aria-label="改 ${esc(c.name)} 的階段">${stageOpts(c.stage_id)}</select></div>
          </li>`).join('') || `<li class="ct-empty">${filtering ? '沒有符合的人' : '拖到這裡'}</li>`}</ul>
      </section>`).join('') || '<p class="sub">還沒有階段，按「階段設定」新增。</p>';
  }

  function renderNotes() {
    const notes = data.contactNotes(state.notes);
    $('#ct-notes', root).innerHTML = notes.length ? notes.map((n) => `
      <article class="card nt-card" data-note="${n.id}" tabindex="0" role="button" aria-label="編輯心法筆記：${esc(n.title)}">
        <h3>${esc(n.title)}</h3>
        ${n.body ? `<p class="nt-body">${linkify(n.body)}</p>` : ''}
        <p class="nt-time">更新 ${formatDateTime(n.updated_at)}</p>
      </article>`).join('')
      : '<div class="card empty-page"><p>把課堂或書中的重點記在這裡，之後可以整理成跟進提示。</p></div>';
  }

  // ---- 對象詳情：基本資料＋聯絡紀錄 ----
  function openContact(contact) {
    const dlg = dialogEl();
    let cur = contact;
    const c = contact || { name: '', stage_id: stages[0]?.id || '', tags: [] };
    dlg.innerHTML = `
      <form class="ct-form" id="ct-form">
        <h2>${contact ? esc(contact.name) : '新增跟進對象'}</h2>
        <div class="row">
          <label>姓名<input name="name" required maxlength="80" value="${esc(c.name)}" autocomplete="off"></label>
          <label>階段<select name="stage_id">${stages.map((s) => `<option value="${s.id}" ${s.id === c.stage_id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
            <option value="" ${!stages.some((s) => s.id === c.stage_id) ? 'selected' : ''}>未分階段</option></select></label>
        </div>
        <div class="row ct-row3">
          <label>電話<input name="phone" type="tel" maxlength="40" value="${esc(c.phone || '')}" autocomplete="off"></label>
          <label>LINE<input name="line_id" maxlength="60" value="${esc(c.line_id || '')}" autocomplete="off"></label>
          <label>IG<input name="ig" maxlength="60" value="${esc(c.ig || '')}" autocomplete="off"></label>
        </div>
        <div class="row">
          <label>認識管道<input name="source" maxlength="80" value="${esc(c.source || '')}" placeholder="例如：朋友介紹、社團"></label>
          <label>下次跟進日<input name="next_follow_on" type="date" value="${esc(c.next_follow_on || '')}"></label>
        </div>
        <label>興趣產品／需求<textarea name="interests" rows="2" maxlength="500">${esc(c.interests || '')}</textarea></label>
        <label>標籤（逗號分隔）<input name="tags" value="${esc((c.tags || []).join(', '))}" placeholder="例如：同事, 保養"></label>
        <label>備註<textarea name="notes" rows="2" maxlength="2000">${esc(c.notes || '')}</textarea></label>
        <label class="check"><input type="checkbox" name="archived" ${c.archived ? 'checked' : ''}> 封存（不再出現在名單與提醒，勾「顯示已封存」才看得到）</label>
        <div class="dialog-actions">
          ${contact ? '<button type="button" class="btn-ghost danger" data-del style="margin-right:auto">刪除對象</button>' : ''}
          <button type="button" class="btn-ghost" data-cancel>${contact ? '關閉' : '取消'}</button>
          <button class="btn-primary">${contact ? '儲存資料' : '新增'}</button>
        </div>
      </form>
      ${contact ? `<section class="ct-logs">
        <h3>聯絡紀錄</h3>
        ${logFormHTML(contact)}
        <ol class="ct-timeline" id="ct-timeline"><li class="sub">載入中…</li></ol>
      </section>` : ''}
      <datalist id="ct-kinds">${kindOptions()}</datalist>`;
    const form = $('#ct-form', dlg);
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        const saved = await data.saveContact({ ...(cur || {}), name: f.get('name'), stage_id: f.get('stage_id'), phone: f.get('phone'),
          line_id: f.get('line_id'), ig: f.get('ig'), source: f.get('source'), interests: f.get('interests'), tags: f.get('tags'),
          notes: f.get('notes'), next_follow_on: f.get('next_follow_on'), archived: f.get('archived') === 'on' });
        contacts = await data.listContacts();
        render();
        if (contact) { dlg.close(); toast('已儲存'); } else { toast(`已新增 ${saved.name}，可以接著記第一筆聯絡`); openContact(saved); }
      } catch (err) { toast(err.message, true); }
    };
    if (!contact) { dlg.showModal(); form.name.focus(); return; }

    $('[data-del]', dlg).onclick = async () => {
      const logs = await data.listContactLogs(contact.id).catch(() => []);
      const msg = `確定刪除「${contact.name}」？${logs.length ? `他的 ${logs.length} 筆聯絡紀錄會一起移到垃圾桶，` : '會移到垃圾桶，'}30 天內可以還原。`;
      if (!(await confirmDialog(msg))) return;
      try {
        await data.deleteContact(contact.id);
        dlg.close();
        contacts = await data.listContacts();
        render();
        toast('已移到垃圾桶');
      } catch (err) { toast(err.message, true); }
    };

    const timeline = $('#ct-timeline', dlg);
    async function loadLogs() {
      const logs = await data.listContactLogs(contact.id);
      timeline.innerHTML = logs.length ? logs.map((l) => `
        <li data-log-id="${l.id}">
          <div class="ct-tl-head"><span class="ct-tl-date">${l.log_date.replaceAll('-', '/')}</span>${l.kind ? `<span class="ct-tl-kind">${esc(l.kind)}</span>` : ''}
            <button type="button" class="btn-ghost danger ct-tl-del" data-del-log="${l.id}" aria-label="刪除 ${l.log_date} 的紀錄">✕</button></div>
          ${l.content ? `<p class="ct-tl-body">${linkify(l.content)}</p>` : ''}
          ${l.next_step ? `<p class="ct-tl-next">下一步：${esc(l.next_step)}</p>` : ''}
        </li>`).join('') : '<li class="sub">還沒有聯絡紀錄。上面寫下第一筆。</li>';
    }
    timeline.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-del-log]');
      if (!b) return;
      if (!(await confirmDialog('確定刪除這筆聯絡紀錄？此操作無法復原。'))) return;
      try {
        await data.contactDeleteLog(cur, b.dataset.delLog);
        await afterLogChange();
        toast('已刪除紀錄');
      } catch (err) { toast(err.message, true); }
    });
    async function afterLogChange() {
      contacts = await data.listContacts();
      cur = contacts.find((x) => x.id === contact.id) || cur;
      form.next_follow_on.value = cur.next_follow_on || ''; // 基本資料表單同步，避免之後按儲存蓋回舊值
      await loadLogs();
      render();
    }
    bindLogForm(dlg, () => cur, async () => { await afterLogChange(); });
    loadLogs().catch((err) => { timeline.innerHTML = `<li class="warn">${esc(err.message)}</li>`; });
    dlg.showModal();
  }

  function logFormHTML(c) {
    return `<form class="ct-log-form" id="ct-log-form">
        <div class="row">
          <label>日期<input type="date" name="log_date" required value="${today()}" max="${today()}"></label>
          <label>類型<input name="kind" list="ct-kinds" maxlength="20" placeholder="聯絡／邀約／分享…（可自己打）"></label>
        </div>
        <label>內容<textarea name="content" rows="2" maxlength="2000" placeholder="聊了什麼、對方的反應"></textarea></label>
        <div class="row">
          <label>下一步<input name="next_step" maxlength="200" placeholder="例如：週末寄試用品"></label>
          <label>下次跟進日<input type="date" name="next_follow_on" min="${today()}"></label>
        </div>
        <p class="sub ct-hint">下次跟進日留白：${c.next_follow_on ? `原本的 ${formatShort(c.next_follow_on)} 若已到期，這筆就算跟進過了，會清掉；還沒到則保留。` : '不設定，改依階段的提醒天數。'}</p>
        <div class="dialog-actions"><button class="btn-primary">記下這筆</button></div>
      </form>`;
  }

  function bindLogForm(dlg, getContact, after) {
    const lf = $('#ct-log-form', dlg);
    lf.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(lf);
      const c = getContact();
      const logDate = f.get('log_date');
      try {
        await data.addContactLog(c, { log_date: logDate, kind: f.get('kind').trim(), content: f.get('content'), next_step: f.get('next_step'),
          next_follow_on: data.contactNextFollowForLog(c, logDate, f.get('next_follow_on')) });
        lf.reset();
        lf.log_date.value = today();
        await after();
        toast(f.get('next_follow_on') ? `已記下，${formatShort(f.get('next_follow_on'))} 再跟進` : '已記下這筆聯絡');
      } catch (err) { toast(err.message, true); }
    };
  }

  /** 「今天該跟進」的一鍵記錄：只有聯絡紀錄表單 */
  function openLogOnly(contact) {
    const dlg = dialogEl();
    dlg.innerHTML = `<h2>記一筆聯絡：${esc(contact.name)}</h2>
      <p class="sub">${lastText(contact, today())}${contact.interests ? `・${esc(contact.interests)}` : ''}</p>
      ${logFormHTML(contact)}
      <div class="dialog-actions"><button type="button" class="btn-ghost" data-open-full>看完整資料</button><button type="button" class="btn-ghost" data-cancel>取消</button></div>
      <datalist id="ct-kinds">${kindOptions()}</datalist>`;
    $('[data-cancel]', dlg).onclick = () => dlg.close();
    $('[data-open-full]', dlg).onclick = () => { dlg.close(); openContact(contact); };
    bindLogForm(dlg, () => contact, async () => {
      dlg.close();
      contacts = await data.listContacts();
      render();
    });
    dlg.showModal();
    $('#ct-log-form [name=content]', dlg).focus();
  }

  // ---- 階段設定 ----
  function openStages() {
    const dlg = dialogEl();
    const draw = () => {
      dlg.innerHTML = `<h2>階段設定</h2>
        <p class="sub">階段和「多久沒聯絡就提醒」都可以自己改；預設的六個只是起點。提醒天數留白＝這個階段不提醒（有設下次跟進日的人照樣會提醒）。</p>
        <ol class="ct-stage-list">${stages.map((s, i) => `
          <li data-sid="${s.id}">
            <input name="label" value="${esc(s.label)}" maxlength="40" aria-label="階段名稱" required>
            <label class="ct-days"><input name="follow_days" type="number" min="1" max="365" value="${s.follow_days ?? ''}" placeholder="不提醒" aria-label="${esc(s.label)} 幾天沒聯絡就提醒"> 天</label>
            <span class="sub ct-stage-n">${data.contactStageUsage(contacts, s.id)} 人</span>
            <button type="button" class="btn-ghost" data-up ${i === 0 ? 'disabled' : ''} aria-label="往前移">↑</button>
            <button type="button" class="btn-ghost" data-down ${i === stages.length - 1 ? 'disabled' : ''} aria-label="往後移">↓</button>
            <button type="button" class="btn-ghost danger" data-del aria-label="刪除階段 ${esc(s.label)}">✕</button>
          </li>`).join('')}</ol>
        <form class="ct-stage-add" id="ct-stage-add"><input name="label" maxlength="40" placeholder="新階段名稱" aria-label="新階段名稱" required><button class="btn-ghost">＋ 新增階段</button></form>
        <div class="dialog-actions"><button type="button" class="btn-primary" data-close>完成</button></div>`;
      $('[data-close]', dlg).onclick = () => dlg.close();
      $('#ct-stage-add', dlg).onsubmit = async (e) => {
        e.preventDefault();
        try { await data.contactAddStage(e.target.label.value, stages); await reload(); toast('已新增階段'); } catch (err) { toast(err.message, true); }
      };
    };
    async function reload() {
      stages = await data.listContactStages();
      contacts = await data.listContacts();
      render();
      draw();
    }
    dlg.onchange = async (e) => {
      const li = e.target.closest('[data-sid]');
      const s = li && stages.find((x) => x.id === li.dataset.sid);
      if (!s) return;
      try {
        await data.saveContactStage({ ...s, label: li.querySelector('[name=label]').value, follow_days: li.querySelector('[name=follow_days]').value });
        stages = await data.listContactStages();
        render();
        toast('已儲存');
      } catch (err) { toast(err.message, true); }
    };
    dlg.onclick = async (e) => {
      const li = e.target.closest('[data-sid]');
      const s = li && stages.find((x) => x.id === li.dataset.sid);
      if (!s) return;
      const i = stages.indexOf(s);
      try {
        if (e.target.closest('[data-up], [data-down]')) {
          const j = e.target.closest('[data-up]') ? i - 1 : i + 1;
          const order = stages.slice();
          [order[i], order[j]] = [order[j], order[i]];
          await data.contactReorderStages(order);
          await reload();
        } else if (e.target.closest('[data-del]')) {
          const n = data.contactStageUsage(contacts, s.id);
          const msg = n ? `「${s.label}」有 ${n} 位對象。刪除後他們的階段會變成空的（列在「未分階段」，可再改）。階段會移到垃圾桶，30 天內可還原。確定刪除？`
            : `確定刪除階段「${s.label}」？會移到垃圾桶，30 天內可還原。`;
          if (!(await confirmDialog(msg))) return; // 確認框疊在階段設定上面
          await data.deleteContactStage(s.id);
          await reload();
          toast('已刪除階段');
        }
      } catch (err) { toast(err.message, true); }
    };
    draw();
    // 換到其他對話框（對象詳情）時把階段設定的事件拿掉
    dlg.addEventListener('close', () => { dlg.onchange = null; dlg.onclick = null; }, { once: true });
    dlg.showModal();
  }

  load();
  return render;
}
