// 人生週格（20261121，#/weeks）：把「人生週記」的概念補進 Life OS——讓剩下的週次看得見，但不多一個要寫的地方。
// 一列＝一歲、一格＝一週（data.lifeWeekOf）。每格的內容不另存，彙整那幾天的每日復盤（心情、里程碑、感恩、收獲）
// 與完成的生活任務；未來的格子標出目標期限與 Future Log。生日存在登入帳號（data.getLifeSettings）。
// 數字都由 data.lifeWeeksSummary 算，這裡只顯示。
import * as data from '../data.js';
import { state } from '../store.js';
import { $, esc, toast } from '../ui.js';
import { today, formatShort } from '../dates.js';

const W = data.LIFE_WEEKS_PER_ROW;
const range = (birth, k) => { const [a, w] = k.split('-').map(Number); return data.lifeWeekRange(birth, a, w); };
const fmtRange = (r) => `${r.start.slice(0, 4)}/${formatShort(r.start)}–${formatShort(r.end)}`;
const moodClass = (m) => (m == null ? '' : ` m${Math.min(5, Math.max(1, Math.round(m)))}`);

export function mountWeeks(root) {
  root.innerHTML = `
    <header class="page-head cal-head">
      <div><h1>人生週格</h1><p class="sub">一列是一歲，一格是一週。格子的內容來自每日復盤，不用另外寫。</p></div>
      <div class="cal-tools">
        <button class="btn-timer" id="lw-book" hidden>翻閱</button>
        <button class="btn-ghost" id="lw-set" hidden>設定生日</button>
      </div>
    </header>
    <div id="lw-body"></div>`;
  const body = $('#lw-body', root);
  let settings = null;
  let sum = null;
  let seq = 0;

  async function load() {
    const my = ++seq;
    try {
      settings = await data.getLifeSettings();
      if (my !== seq) return;
      if (!settings.birth_date) { renderSetup(); return; }
      const [reviews, futureEvents] = await Promise.all([
        data.listReviewsSince(settings.birth_date),
        data.listFutureEventsFrom(today().slice(0, 7)),
      ]);
      if (my !== seq) return;
      const areaIds = new Set(state.life.areas.map((a) => a.id));
      sum = data.lifeWeeksSummary(settings.birth_date, settings.life_years, {
        reviews, tasks: state.life.tasks, goals: state.goals, futureEvents, areaIds,
      });
      renderMain();
    } catch (e) {
      body.innerHTML = `<section class="card"><p class="warn">讀取失敗：${esc(e.message)}</p></section>`;
    }
  }

  function renderSetup() {
    $('#lw-book', root).hidden = true;
    $('#lw-set', root).hidden = true;
    body.innerHTML = `
      <section class="card lw-setup">
        <h2>先告訴我你的生日</h2>
        <p class="sub">用來把一生畫成一週一格。存在你的登入帳號裡，只有你看得到，換裝置也一樣。</p>
        ${settingsForm()}
      </section>`;
    bindForm($('form', body));
  }

  function settingsForm() {
    const s = settings || {};
    return `<form class="lw-form">
      <label>生日<input type="date" name="birth_date" required max="${today()}" value="${esc(s.birth_date || '')}"></label>
      <label>想看到幾歲<input type="number" name="life_years" min="50" max="120" step="1" required value="${s.life_years || data.LIFE_YEARS_DEFAULT}"></label>
      <div class="dialog-actions"><button type="button" class="btn-ghost" data-cancel hidden>取消</button><button class="btn-primary">儲存</button></div>
    </form>`;
  }

  function bindForm(form, onDone) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        settings = await data.saveLifeSettings({ birth_date: f.get('birth_date'), life_years: Number(f.get('life_years')) });
        onDone?.();
        toast('已儲存');
        load();
      } catch (err) { toast(err.message, true); }
    };
  }

  function renderMain() {
    const birth = settings.birth_date;
    const years = settings.life_years;
    const now = sum.now;
    const cur = sum.cells.get(now.key) || { days: 0 };
    const curR = range(birth, now.key);
    $('#lw-book', root).hidden = false;
    $('#lw-set', root).hidden = false;
    const pct = Math.round((sum.lived / sum.total) * 1000) / 10;
    const rows = [];
    for (let a = 0; a < years; a++) {
      const label = a % 5 === 0 ? a : '';
      let cells = '';
      for (let w = 0; w < W; w++) {
        const k = `${a}-${w}`;
        const c = sum.cells.get(k);
        let cls;
        if (k === now.key) cls = `now${moodClass(c?.mood)}${c?.days ? ' wrote' : ''}`;
        else if (a < now.age || (a === now.age && w < now.week)) cls = c && (c.days || c.mood != null) ? `wrote${moodClass(c.mood)}` : 'past';
        else cls = `future${c?.marks.length ? ' mark' : ''}`;
        cells += `<i class="lw-c ${cls}" data-k="${k}"></i>`;
      }
      rows.push(`<span class="lw-age${a === now.age ? ' cur' : ''}">${label}</span>${cells}`);
    }
    body.innerHTML = `
      <section class="card lw-banner ${cur.days ? 'ok' : ''}">
        ${cur.days
          ? `<p>這週（${formatShort(curR.start)}–${formatShort(curR.end)}）寫了 <b>${cur.days}</b> 天復盤，這一格已經亮起來了。</p>`
          : `<p>這週（${formatShort(curR.start)}–${formatShort(curR.end)}）還沒寫復盤。今天寫一句，這一格就會亮起來。</p>`}
        <a class="btn-ghost" href="#/review/${today()}">${cur.days ? '去每日復盤' : '寫今天的復盤'}</a>
      </section>
      <div class="stats stats-4 lw-stats">
        <div class="stat card"><div class="stat-label">今年</div><div class="stat-num">${now.age}<small>歲</small></div><div class="stat-note">人生第 ${(sum.lived + 1).toLocaleString()} 週</div></div>
        <div class="stat card"><div class="stat-label">已經走過</div><div class="stat-num">${pct}<small>%</small></div><div class="stat-note">以 ${years} 歲、每年 ${W} 週計</div></div>
        <div class="stat card"><div class="stat-label">還有大約</div><div class="stat-num">${sum.remaining.toLocaleString()}<small>週</small></div><div class="stat-note">不含這週</div></div>
        <div class="stat card"><div class="stat-label">留下紀錄的週</div><div class="stat-num">${sum.logged}<small>週</small></div><div class="stat-note">有寫復盤或心情</div></div>
      </div>
      <section class="card lw-card">
        <div class="lw-legend" aria-hidden="true">
          <span><i class="lw-c past"></i>過去、沒有紀錄</span>
          <span><i class="lw-c wrote m4"></i>有寫復盤（顏色＝那週平均心情）</span>
          <span><i class="lw-c wrote"></i>有寫、沒填心情</span>
          <span><i class="lw-c now"></i>這週</span>
          <span><i class="lw-c future"></i>還沒到</span>
          <span><i class="lw-c future mark"></i>有目標期限或 Future Log</span>
        </div>
        <div class="lw-grid" role="img" aria-label="${now.age} 歲，人生第 ${sum.lived + 1} 週，還有大約 ${sum.remaining} 週">${rows.join('')}</div>
        <p class="sub">點任何一格看那一週。左邊的數字是歲數。</p>
      </section>`;
  }

  /** 一格的內容（點格子與翻閱共用） */
  function weekHTML(k, { withLink = true } = {}) {
    const birth = settings.birth_date;
    const [a, w] = k.split('-').map(Number);
    const r = range(birth, k);
    const c = sum.cells.get(k);
    const isFuture = r.start > today();
    const list = (title, items) => (items?.length
      ? `<div class="lw-sec"><h3>${title}</h3><ul>${items.map((x) => `<li><a href="#/review/${x.day}" class="lw-day">${formatShort(x.day)}</a>${esc(x.text)}</li>`).join('')}</ul></div>` : '');
    let inner;
    if (isFuture) {
      const ahead = (a * W + w) - (sum.lived);
      inner = `<p class="sub">${ahead.toLocaleString()} 週以後。</p>
        ${c?.marks.length
          ? `<div class="lw-sec"><h3>這週的安排</h3><ul>${c.marks.map((m) => `<li><span class="lw-day">${m.day ? formatShort(m.day) : `${Number(m.month.slice(5))} 月`}</span>${m.kind === 'goal' ? '◆ 目標期限：' : ''}${esc(m.title)}</li>`).join('')}</ul></div>`
          : '<p class="sub">這一週還是空白的。</p>'}`;
    } else if (!c || (!c.days && c.mood == null && !c.done)) {
      inner = '<p class="sub">這週沒有留下紀錄。</p>';
    } else {
      const facts = [
        c.days ? `寫了 ${c.days} 天復盤` : '',
        c.mood != null ? `平均心情 ${c.mood}（${esc(data.MOOD_LEVELS[Math.round(c.mood)])}）` : '',
        c.done ? `完成 ${c.done} 件生活任務` : '',
      ].filter(Boolean).join('・');
      inner = `<p class="lw-facts">${c.mood != null ? `<i class="sw${moodClass(c.mood)}" aria-hidden="true"></i>` : ''}${facts}</p>
        ${list('里程碑', c.milestones)}${list('感恩', c.gratitude)}${list('收獲', c.gains)}`;
    }
    return `<h2>${a} 歲・第 ${w + 1} 週</h2>
      <p class="sub">${fmtRange(r)}${a * W + w === sum.lived ? '・這週' : ''}</p>
      ${inner}
      ${withLink && !isFuture ? `<p><a href="#/review/${r.end > today() ? today() : r.end}" class="lw-go">到這週的每日復盤 ›</a></p>` : ''}`;
  }

  function dialogEl() {
    let dlg = document.getElementById('lw-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'lw-dialog';
      dlg.className = 'wide';
      document.body.append(dlg);
      // 點日期連結（跳到每日復盤）時順便關掉
      dlg.addEventListener('click', (e) => { if (e.target.closest('a[href^="#/"]')) dlg.close(); });
    }
    return dlg;
  }

  function openWeek(k) {
    const dlg = dialogEl();
    dlg.onkeydown = null;
    dlg.innerHTML = `<div class="lw-dlg">${weekHTML(k)}<div class="dialog-actions"><button type="button" class="btn-ghost" data-close>關閉</button></div></div>`;
    $('[data-close]', dlg).onclick = () => dlg.close();
    dlg.showModal();
    $('[data-close]', dlg).focus();
  }

  /** 翻閱：只翻有內容的週（舊→新），從最新一頁開始；左右鍵翻頁 */
  function openBook() {
    const pages = [...sum.cells.entries()]
      .filter(([, c]) => c.days || c.mood != null || c.milestones.length || c.gratitude.length || c.gains.length)
      .map(([k]) => k)
      .filter((k) => range(settings.birth_date, k).start <= today())
      .sort((x, y) => { const [a1, w1] = x.split('-').map(Number); const [a2, w2] = y.split('-').map(Number); return a1 - a2 || w1 - w2; });
    if (!pages.length) { toast('還沒有寫過復盤；寫了之後這裡會一週一頁。'); return; }
    let i = pages.length - 1;
    const dlg = dialogEl();
    const draw = () => {
      dlg.innerHTML = `<div class="lw-dlg lw-page">
        <p class="lw-run">人生週格・翻閱</p>
        ${weekHTML(pages[i])}
        <div class="lw-turn">
          <button type="button" class="btn-ghost" data-prev ${i === 0 ? 'disabled' : ''} aria-label="上一頁">‹ 前一頁</button>
          <span class="lw-folio">${i + 1} / ${pages.length}</span>
          <button type="button" class="btn-ghost" data-next ${i === pages.length - 1 ? 'disabled' : ''} aria-label="下一頁">後一頁 ›</button>
        </div>
        <div class="dialog-actions"><button type="button" class="btn-ghost" data-close>關閉</button></div>
      </div>`;
      $('[data-prev]', dlg).onclick = () => { if (i > 0) { i--; draw(); $('[data-prev]', dlg).focus(); } };
      $('[data-next]', dlg).onclick = () => { if (i < pages.length - 1) { i++; draw(); $('[data-next]', dlg).focus(); } };
      $('[data-close]', dlg).onclick = () => dlg.close();
    };
    dlg.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' && i > 0) { i--; draw(); }
      if (e.key === 'ArrowRight' && i < pages.length - 1) { i++; draw(); }
    };
    draw();
    dlg.showModal();
    $('[data-close]', dlg).focus();
  }

  function openSettings() {
    const dlg = dialogEl();
    dlg.onkeydown = null;
    dlg.innerHTML = `<div class="lw-dlg"><h2>生日與想看到的歲數</h2><p class="sub">存在登入帳號裡，只有你看得到。</p>${settingsForm()}</div>`;
    const form = $('form', dlg);
    const cancel = $('[data-cancel]', dlg);
    cancel.hidden = false;
    cancel.onclick = () => dlg.close();
    bindForm(form, () => dlg.close());
    dlg.showModal();
  }

  body.addEventListener('click', (e) => {
    const c = e.target.closest('.lw-grid .lw-c');
    if (c && sum) openWeek(c.dataset.k);
  });
  $('#lw-book', root).onclick = () => sum && openBook();
  $('#lw-set', root).onclick = openSettings;

  load();
  return function render() { if (settings) load(); };
}
