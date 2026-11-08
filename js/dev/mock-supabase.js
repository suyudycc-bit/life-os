// 本機模擬 Supabase（僅開發測試用，網址加 ?mock=1 時啟用）
// 只實作本專案用到的 supabase-js 子集，並模擬 schema.sql 的預設值、RLS、
// set_completed_at／計時相關觸發器、一個進行中計時的唯一索引、daily_summary view 與 migrations（sort_order、links、task_memos、20261104 工作看板欄位）。真正上線一律使用 Supabase。
const DB_KEY = 'lifeos-mock-db';
const SESSION_KEY = 'lifeos-mock-session';
const TZ_OFFSET_MS = 8 * 3600 * 1000; // Asia/Taipei
const MOCK_PASSWORD_MIN = 6; // Supabase Auth 預設最短密碼長度

const load = () => {
  const db = JSON.parse(localStorage.getItem(DB_KEY) || '{"users":{},"areas":[],"tasks":[]}');
  if (!db.secMigrated) { migrate(db); localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  return db;
};
const save = (db) => localStorage.setItem(DB_KEY, JSON.stringify(db));
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const taipeiDate = (ts) => new Date(new Date(ts).getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

const DEFAULTS = {
  areas: () => ({ sort: 0, color: null, on_board: false }),
  notes: () => ({ area_id: null, body: null, category: null, tags: [], updated_at: now() }),
  habits: () => ({ area_id: null, target_per_week: 7, archived: false, project_id: null, goal_id: null }), // 20261106
  projects: () => ({ status: 'active', next_action: null, notes: null, updated_at: now(), start_date: null, end_date: null }),
  goals: () => ({ due_date: null, status: 'active', period: null, project_id: null, mainline: false }), // period：20261105；project_id：20261106；mainline：20261108
  tasks: () => ({
    status: 'todo', priority: 2, starred: false, actual_min: 0, completed_at: null, notes: null,
    project_id: null, goal_id: null, due_date: null, scheduled_start: null, estimate_min: null, updated_at: now(),
    sort_order: null, links: [], actual_sec: 0, case_no: null, work_type_id: null, board_parked: false, work_project_tag_id: null,
  }),
  work_tags: () => ({ color: '#667085', active: true, sort: 0, kind: 'type' }), // migration 20261104；kind：20261106
  routine_phrases: () => ({ sort: 0 }),
  daily_reviews: () => ({ work_reflection: {}, work_effort: {}, work_summary: null, work_analysis: {}, mood: null, energy: null,
    identity: null, affirmation: null, milestones: null, gratitude: null }), // 20261108_manifest
  // migration 20261105_journal（Phase J）
  period_reviews: () => ({ wins: null, lessons: null, next_focus: null, updated_at: now(), vision_identity: null, vision_senses: {} }),
  future_events: () => ({ day: null, area_id: null }),
  media_items: () => ({ creator: null, release_year: null, cover_url: null, link_url: null, status: 'want', rating: null, review: null,
    started_on: null, finished_on: null, tags: [], area_id: null, note_id: null, sort_order: null, updated_at: now() }),
  bucket_items: () => ({ category: null, area_id: null, done_on: null, note: null, sort_order: null }),
  // migration 20261106_feedback
  trash: () => ({ deleted_at: now() }),
  inbox_items: () => ({ url: null, title: null, body: null, source: 'other', category: null, area_id: null, opened_at: null, done_at: null }),
  contact_stages: () => ({ sort: 0, follow_days: null, color: null }),
  contacts: () => ({ stage_id: null, phone: null, line_id: null, ig: null, source: null, interests: null, tags: [], next_follow_on: null,
    last_contact_on: null, notes: null, archived: false, sort_order: null }),
  contact_logs: () => ({ kind: null, content: null, next_step: null }),
  // migration 20261108_manifest
  reflections: () => ({ entry_date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), event: null, fields: {}, wants: [], emotions: [],
    intensity_before: null, intensity_after: null, release_count: 0, feeling_after: null, next_action: null, task_id: null, area_id: null, updated_at: now() }),
};

function dailySummary(tasks, areas = []) {
  const groups = {};
  const work = new Set(areas.filter((a) => a.on_board).map((a) => a.id)); // migration 20261104b：工作／生活分開
  for (const t of tasks) {
    // migration 20261104b：已完成算完成那天，未完成算到期／排程日
    const day = t.status === 'done' && t.completed_at ? taipeiDate(t.completed_at)
      : t.due_date || (t.scheduled_start ? taipeiDate(t.scheduled_start) : null);
    if (!day) continue;
    const isWork = work.has(t.area_id);
    const g = (groups[`${t.user_id}|${day}|${isWork}`] ||= { user_id: t.user_id, day, is_work: isWork, tasks_total: 0, tasks_done: 0, actual_min: 0, estimate_min: 0, actual_sec: 0 });
    if (t.status !== 'dropped') g.tasks_total++;
    if (t.status === 'done') g.tasks_done++;
    g.actual_min += t.actual_min || 0;
    g.actual_sec += t.actual_sec || 0;
    g.estimate_min += t.estimate_min || 0;
  }
  return Object.values(groups).map((g) => ({
    ...g, completion_pct: g.tasks_total ? Math.round((100 * g.tasks_done) / g.tasks_total) : null,
  }));
}

// trg_entry_duration（含 migration 20261102b）：ended_at 有值時算秒數，分鐘由秒數四捨五入
function setDuration(e) {
  e.duration_sec = e.ended_at ? Math.round((new Date(e.ended_at) - new Date(e.started_at)) / 1000) : null;
  e.duration_min = e.duration_sec == null ? null : Math.round(e.duration_sec / 60);
}
function checkEntry(e) {
  if (e.ended_at && e.ended_at < e.started_at) return { code: '23514', message: 'new row violates check constraint "time_entries_check"' };
  return null;
}
// migration 20261108_manifest：reflections 的 check（kind、wants 只能三值、強度 0～10、次數 ≥ 0）
function checkReflection(r) {
  const bad = (name) => ({ code: '23514', message: `new row for relation "reflections" violates check constraint "${name}"` });
  if (!['mindshift', 'release', 'allow'].includes(r.kind)) return bad('reflections_kind_check');
  if (!(r.wants || []).every((w) => ['safety', 'approval', 'control'].includes(w))) return bad('reflections_wants_check');
  for (const c of ['intensity_before', 'intensity_after']) if (r[c] != null && !(r[c] >= 0 && r[c] <= 10)) return bad(`reflections_${c}_check`);
  if (!(r.release_count >= 0)) return bad('reflections_release_count_check');
  return null;
}
// trg_rollup：重算相關任務的 actual_sec，actual_min 由總秒數換算
function rollup(db, entries) {
  for (const tid of new Set(entries.map((e) => e.task_id).filter(Boolean))) {
    const t = db.tasks.find((x) => x.id === tid);
    if (!t) continue;
    t.actual_sec = (db.time_entries || []).filter((e) => e.task_id === tid).reduce((n, e) => n + (e.duration_sec || 0), 0);
    t.actual_min = Math.round(t.actual_sec / 60);
    t.updated_at = now();
  }
}

// 模擬 migration 20261102b 的「補算既有資料」：舊的模擬資料沒有秒數欄位時補上
function migrate(db) {
  if (db.secMigrated) return;
  for (const e of db.time_entries || []) setDuration(e);
  for (const t of db.tasks || []) t.actual_sec ??= 0;
  rollup(db, db.time_entries || []);
  db.secMigrated = true;
}

class Query {
  constructor(client, table) {
    Object.assign(this, { client, table, op: 'select', filters: [], orders: [], payload: null, mode: 'many' });
  }
  select() { return this; } // 寫入後 .select() 一律回傳受影響的列
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  gte(col, val) { this.filters.push((r) => r[col] != null && r[col] >= val); return this; }
  is(col, val) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  in(col, vals) { const set = new Set(vals); this.filters.push((r) => set.has(r[col])); return this; }
  lt(col, val) { this.filters.push((r) => r[col] != null && r[col] < val); return this; }
  lte(col, val) { this.filters.push((r) => r[col] != null && r[col] <= val); return this; }
  limit(n) { this.max = n; return this; }
  range(from, to) { this.from = from; this.max = to - from + 1; return this; }
  upsert(row, { onConflict } = {}) { this.op = 'upsert'; this.payload = row; this.conflict = onConflict.split(','); return this; }
  order(col, { ascending = true } = {}) { this.orders.push([col, ascending]); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  run() {
    const uid = this.client.uid();
    if (!uid) return { data: null, error: { message: 'not authenticated' } };
    const db = load();
    const own = (r) => r.user_id === uid; // RLS：只能存取自己的資料
    const match = (r) => own(r) && this.filters.every((f) => f(r));
    let out;
    if (this.table === 'daily_summary') {
      out = dailySummary(db.tasks, db.areas).filter(match);
    } else {
      const rows = (db[this.table] ||= []);
      if (this.op === 'select') out = rows.filter(match);
      if (this.op === 'insert') {
        out = [].concat(this.payload).map((r) => ({
          ...DEFAULTS[this.table]?.(), ...r, id: r.id || uuid(), user_id: uid, created_at: r.created_at || now(),
        }));
        if (this.table === 'habit_logs') { // unique (habit_id, log_date)
          for (const r of out) {
            if (rows.some((x) => x.habit_id === r.habit_id && x.log_date === r.log_date)) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "habit_logs_habit_id_log_date_key"' } };
            }
          }
        }
        // migration 20261104：tasks (user_id, case_no) 唯一（null 不限）；20261106：work_tags 改成 (user_id, kind, label) 唯一
        const uniq = { tasks: (x) => x.case_no, work_tags: (x) => `${x.kind || 'type'}|${x.label}` }[this.table];
        if (uniq) {
          const seen = new Set(rows.filter((x) => x.user_id === uid).map(uniq).filter((v) => v != null));
          for (const r of out) {
            const k = uniq(r);
            if (k == null) continue;
            if (seen.has(k)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_unique"` } };
            seen.add(k);
          }
        }
        // 20261106：還原垃圾桶時帶原本的 id，主鍵重複要報錯
        for (const r of out) if (rows.some((x) => x.id === r.id)) return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_pkey"` } };
        if (this.table === 'reflections') {
          for (const r of out) { const err = checkReflection(r); if (err) return { data: null, error: err }; }
        }
        if (this.table === 'time_entries') {
          for (const r of out) {
            const err = checkEntry(r) || (r.ended_at == null && rows.some((x) => x.user_id === uid && x.ended_at == null)
              ? { code: '23505', message: 'duplicate key value violates unique constraint "time_entries_one_running"' } : null);
            if (err) return { data: null, error: err };
            setDuration(r);
          }
        }
        rows.push(...out);
        if (this.table === 'time_entries') rollup(db, out);
      }
      if (this.op === 'upsert') { // daily_reviews：unique (user_id, review_date)
        const row = { ...this.payload, user_id: uid };
        const hit = rows.find((r) => this.conflict.every((c) => r[c] === row[c]));
        if (hit) Object.assign(hit, row);
        else rows.push({ ...DEFAULTS[this.table]?.(), ...row, id: uuid() });
        out = [hit || rows.at(-1)];
      }
      if (this.op === 'update') {
        out = rows.filter(match);
        for (const r of out) {
          const old = { ...r };
          Object.assign(r, this.payload);
          if (this.table === 'reflections') {
            const err = checkReflection(r);
            if (err) { Object.assign(r, old); return { data: null, error: err }; }
          }
          if (this.table === 'time_entries') {
            const err = checkEntry(r);
            if (err) { Object.assign(r, old); return { data: null, error: err }; }
            setDuration(r);
            rollup(db, [old, r]);
          }
          if (this.table === 'tasks') { // trg_task_completed
            if (r.status === 'done' && old.status !== 'done') r.completed_at = now();
            else if (r.status !== 'done') r.completed_at = null;
            r.updated_at = now();
          }
        }
      }
      if (this.op === 'delete') {
        out = rows.filter(match);
        if (this.table === 'areas') { // 20261106（E）：tasks／計時／專案／目標 on delete restrict，其餘 set null
          const ids = new Set(out.map((r) => r.id));
          for (const t of ['tasks', 'time_entries', 'projects', 'goals']) {
            if ((db[t] || []).some((r) => ids.has(r.area_id))) {
              return { data: null, error: { code: '23503', message: `update or delete on table "areas" violates foreign key constraint on table "${t}"` } };
            }
          }
          for (const t of ['habits', 'notes', 'media_items', 'bucket_items', 'future_events', 'inbox_items', 'reflections']) {
            for (const r of db[t] || []) if (ids.has(r.area_id)) r.area_id = null;
          }
        }
        db[this.table] = rows.filter((r) => !out.includes(r));
        if (this.table === 'tasks') { // task_memos on delete cascade；time_entries.task_id on delete set null
          const ids = new Set(out.map((r) => r.id));
          db.task_memos = (db.task_memos || []).filter((m) => !ids.has(m.task_id));
          for (const e of db.time_entries || []) if (ids.has(e.task_id)) e.task_id = null;
        }
        if (this.table === 'time_entries') rollup(db, out);
        // on delete set null（20261106：goals／habits 掛專案、habits 掛目標、看板專案標籤、跟進階段）
        const SET_NULL = {
          projects: [['tasks', 'project_id'], ['goals', 'project_id'], ['habits', 'project_id']],
          goals: [['tasks', 'goal_id'], ['habits', 'goal_id']],
          work_tags: [['tasks', 'work_type_id'], ['tasks', 'work_project_tag_id']],
          contact_stages: [['contacts', 'stage_id']],
          tasks: [['reflections', 'task_id']], // 20261108：內在整理的「下一步轉任務」
        }[this.table];
        if (SET_NULL) {
          const ids = new Set(out.map((r) => r.id));
          for (const [t, col] of SET_NULL) for (const r of db[t] || []) if (ids.has(r[col])) r[col] = null;
        }
        if (this.table === 'contacts') { // contact_logs on delete cascade
          const ids = new Set(out.map((r) => r.id));
          db.contact_logs = (db.contact_logs || []).filter((l) => !ids.has(l.contact_id));
        }
        if (this.table === 'habits') { // habit_logs on delete cascade
          const ids = new Set(out.map((r) => r.id));
          db.habit_logs = (db.habit_logs || []).filter((l) => !ids.has(l.habit_id));
        }
        if (this.table === 'notes') { // media_items.note_id on delete set null（migration 20261105）
          const ids = new Set(out.map((r) => r.id));
          for (const m of db.media_items || []) if (ids.has(m.note_id)) m.note_id = null;
        }
      }
      save(db);
    }
    for (const [col, asc] of [...this.orders].reverse()) {
      out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.max != null) out = out.slice(this.from || 0, (this.from || 0) + this.max);
    out = structuredClone(out);
    if (this.mode === 'single') {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `expected 1 row, got ${out.length}` } };
    }
    if (this.mode === 'maybe') return { data: out[0] || null, error: null };
    return { data: out, error: null };
  }
}

// 模擬模式的示範帳號：自動登入，不需註冊
export const DEMO_EMAIL = 'demo@lifeos.local';
export const DEMO_PASSWORD = 'demo1234';
const DEMO_SEEDED_KEY = 'lifeos-mock-demo-seeded';

/** 第一次進入模擬模式時，為示範帳號放幾筆範例任務（只做一次，刪掉不會再長回來） */
export async function seedDemoTasks(client, areas) {
  if (localStorage.getItem(DEMO_SEEDED_KEY) || !areas.length) return;
  if (client.uid() !== load().users[DEMO_EMAIL]?.id) return;
  localStorage.setItem(DEMO_SEEDED_KEY, '1');
  const day = (n) => taipeiDate(Date.now() + n * 86400000);
  const [work, career, side, health] = areas.map((a) => a.id);
  const rows = [
    { title: '整理 BD 提案簡報', area_id: work, priority: 1, starred: true, due_date: day(0), estimate_min: 60 },
    { title: '回覆轉譯組會議紀錄', area_id: work, priority: 2, due_date: day(0) },
    { title: '更新履歷與作品集', area_id: career, priority: 1, starred: true, due_date: day(2) },
    { title: '報價單寄給接案客戶', area_id: side, priority: 1, due_date: day(-1) },
    { title: '跑步 30 分鐘', area_id: health, priority: 3, due_date: day(0), estimate_min: 30 },
    { title: '研究線上課程', area_id: career, priority: 3 },
  ].filter((r) => r.area_id);
  await client.from('tasks').insert(rows);
}

export function createMockClient() {
  const listeners = [];
  const getSess = () => JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  const setSess = (s) => {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY);
    listeners.forEach((cb) => cb(s ? 'SIGNED_IN' : 'SIGNED_OUT', s));
  };
  const client = {
    uid: () => getSess()?.user.id,
    // Edge Functions 在模擬模式無法使用；google-sync 改成產生幾筆範例會議，方便看日曆畫面；link-title 回假標題
    functions: {
      async invoke(name, { body } = {}) {
        const uid = client.uid();
        if (!uid) return { data: null, error: { message: 'not authenticated' } };
        // link-title（讀網頁標題）的模擬：網址含 notitle → 讀不到；含 nofn → 模擬函式還沒部署（404）；其他回假標題
        if (name === 'link-title') {
          await new Promise((r) => { setTimeout(r, 400); });
          const url = String(body?.url || '');
          if (/nofn/.test(url)) return { data: null, error: { message: 'Function not found' } };
          if (/notitle/.test(url)) return { data: { title: '', error: '網站回應 403' }, error: null };
          let host = url;
          try { host = new URL(url).hostname; } catch { return { data: { title: '', error: '網址格式不正確' }, error: null }; }
          return { data: { title: `（模擬標題）${host} 的網頁` }, error: null };
        }
        if (name === 'google-oauth-start') return { data: { error: '模擬模式無法連結 Google 帳號（需要部署到 Supabase）' }, error: null };
        if (name !== 'google-sync') return { data: null, error: { message: 'Function not found' } };
        const db = load();
        const sync = (db.calendar_sync ||= []).find((s) => s.user_id === uid);
        if (!sync?.google_ics_url) return { data: { results: [] }, error: null };
        const day = (n, hh, mm) => `${taipeiDate(Date.now() + n * 86400000)}T${hh}:${mm}:00+08:00`; // 台北日期
        const samples = [
          { uid: 'demo-1', title: '（範例）客戶會議', starts_at: day(0, '10', '00'), ends_at: day(0, '11', '00'), location: '台北' },
          { uid: 'demo-2', title: '（範例）週會', starts_at: day(1, '09', '30'), ends_at: day(1, '10', '00') },
          { uid: 'demo-3', title: '（範例）員工旅遊', starts_at: day(3, '00', '00'), ends_at: day(5, '00', '00'), all_day: true },
        ].map((e) => ({ id: uuid(), user_id: uid, source: 'google', all_day: false, location: null, synced_at: now(), ...e,
          starts_at: new Date(e.starts_at).toISOString(), ends_at: new Date(e.ends_at).toISOString() }));
        db.external_events = (db.external_events || []).filter((e) => e.user_id !== uid).concat(samples);
        Object.assign(sync, { last_pull_at: now(), last_pull_count: samples.length, last_pull_error: null });
        save(db);
        return { data: { results: [{ user_id: uid, last_pull_count: samples.length, last_pull_at: sync.last_pull_at }] }, error: null };
      },
    },
    from: (table) => new Query(client, table),
    auth: {
      async getSession() { return { data: { session: getSess() }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) {
        const u = load().users[email];
        if (!u || u.password !== password) return { data: null, error: { message: 'Invalid login credentials' } };
        const session = { user: { id: u.id, email } };
        setSess(session);
        return { data: { session }, error: null };
      },
      async signUp({ email, password }) {
        const db = load();
        if (db.users[email]) return { data: null, error: { message: 'User already registered' } };
        db.users[email] = { id: uuid(), password };
        save(db);
        return client.auth.signInWithPassword({ email, password });
      },
      async signOut() { setSess(null); return { error: null }; },
      // 照 supabase-js／Supabase Auth 的行為：沒登入回 Auth session missing!；
      // 新密碼少於 6 碼或與舊密碼相同時回錯誤；成功發出 USER_UPDATED
      async updateUser({ password } = {}) {
        const sess = getSess();
        if (!sess) return { data: { user: null }, error: { message: 'Auth session missing!' } };
        const db = load();
        const u = db.users[sess.user.email];
        if (!u) return { data: { user: null }, error: { message: 'User not found' } };
        if (password !== undefined) {
          if (String(password).length < MOCK_PASSWORD_MIN) {
            return { data: { user: null }, error: { message: `Password should be at least ${MOCK_PASSWORD_MIN} characters.` } };
          }
          if (password === u.password) {
            return { data: { user: null }, error: { message: 'New password should be different from the old password.' } };
          }
          u.password = password;
        }
        save(db);
        listeners.forEach((cb) => cb('USER_UPDATED', sess));
        return { data: { user: sess.user }, error: null };
      },
      // 真的 Supabase 不論 Email 是否註冊都回成功（避免被用來試帳號）；模擬模式不寄信，
      // 對已註冊的 Email 回傳一個模擬的重設連結（data.mock_link，只有模擬模式有）
      async resetPasswordForEmail(email, { redirectTo } = {}) {
        if (!email) return { data: null, error: { message: 'Anonymous users cannot be recovered.' } };
        const u = load().users[email];
        if (!u) return { data: {}, error: null };
        const base = redirectTo || `${location.origin}${location.pathname}`;
        const mock_link = `${base}?mock=1#type=recovery&mock_email=${encodeURIComponent(email)}`;
        console.info('[mock] 重設密碼連結：', mock_link);
        return { data: { mock_link }, error: null };
      },
    },
  };
  // 模擬「點重設信的連結回來」：hash 帶 type=recovery 時，登入該帳號並在下一輪發出 PASSWORD_RECOVERY，
  // 然後清掉 hash（supabase-js 的 implicit flow 也是 setTimeout 0 才通知、並清掉網址上的 token）
  {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const email = h.get('mock_email');
    if (h.get('type') === 'recovery' && email && load().users[email]) {
      const session = { user: { id: load().users[email].id, email } };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      window.location.hash = '';
      setTimeout(() => listeners.forEach((cb) => cb('PASSWORD_RECOVERY', session)), 0);
    }
  }
  if (!getSess()) {
    const db = load();
    db.users[DEMO_EMAIL] ||= { id: uuid(), password: DEMO_PASSWORD };
    save(db);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: { id: db.users[DEMO_EMAIL].id, email: DEMO_EMAIL } }));
  }
  return client;
}
