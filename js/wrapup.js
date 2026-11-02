// Phase W3：Wrap up my day 的規則分析（搬自舊看板 buildReflectionAnalysis／buildReflectionSummary，不使用 AI）
// 用「投入程度」加權看懂今天：輕 1、中 2、重 3。純函式，可在 Node 直接測試。

export const EFFORT_WEIGHTS = { light: 1, medium: 2, heavy: 3 };
export const EFFORT_LABELS = { light: '輕', medium: '中', heavy: '重' };
const UNSET = '未分類';
const REPEAT_DAYS = 3; // 建立超過 3 天還排在後續，視為「一直被往後移」（舊看板是近期紀錄出現 2 次以上）

const shorten = (text, max) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
function distribution(map, total) {
  return Object.keys(map)
    .map((label) => ({ label, value: map[label], percent: total ? Math.round((map[label] / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'zh-Hant'));
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00+08:00`) - Date.parse(`${a}T12:00:00+08:00`)) / 86400000);

/**
 * @param {object} p
 * @param {{task:object, column:'new'|'inprogress'|'done'}[]} p.entries 今天的工作（看板本日三欄）
 * @param {Record<string,string>} p.effort { task_id: 'light'|'medium'|'heavy' }，沒填當「中」
 * @param {{achievement?:string, blocker?:string, attention?:string}} p.reflection 三題
 * @param {{tomorrow:object[], backlog:object[]}} p.future 看板後續兩欄
 * @param {(t:object)=>string} p.workTypeOf 工作種類名稱（沒有回空字串）
 * @param {(t:object)=>string} p.projectOf 專案名稱（沒有回空字串）
 * @param {string} p.day 'YYYY-MM-DD'
 * @param {(t:object)=>string} p.createdDay 任務建立的台北日期
 */
export function analyzeDay({ entries, effort, reflection, future, workTypeOf, projectOf, day, createdDay }) {
  const workTypeMap = {};
  const projectMap = {};
  const byColumn = { new: 0, inprogress: 0, done: 0 };
  let total = 0;
  let missingWorkType = 0;
  let missingProject = 0;
  for (const { task, column } of entries) {
    const w = EFFORT_WEIGHTS[effort[task.id]] || EFFORT_WEIGHTS.medium;
    total += w;
    byColumn[column] += w;
    const wt = workTypeOf(task) || UNSET;
    const pj = projectOf(task) || UNSET;
    workTypeMap[wt] = (workTypeMap[wt] || 0) + w;
    projectMap[pj] = (projectMap[pj] || 0) + w;
    if (wt === UNSET) missingWorkType++;
    if (pj === UNSET) missingProject++;
  }
  const workTypes = distribution(workTypeMap, total);
  const projects = distribution(projectMap, total);
  const completionPercent = total ? Math.round((byColumn.done / total) * 100) : 0;
  const unplannedPercent = total ? Math.round((byColumn.new / total) * 100) : 0;
  const kinds = workTypes.filter((x) => x.label !== UNSET).length;
  const futureLoad = future.tomorrow.length + future.backlog.length;
  const repeated = [...future.tomorrow, ...future.backlog]
    .map((t) => ({ title: t.title, days: daysBetween(createdDay(t), day) }))
    .filter((x) => x.days >= REPEAT_DAYS).sort((a, b) => b.days - a.days);
  const [primary, secondary] = workTypes;

  let headline = '今天沒有足夠的工作紀錄可判讀';
  let overview = '你仍可從三題回答留下今天的成果、卡點與明日提醒。';
  if (total > 0 && primary) {
    if (primary.label === UNSET) {
      headline = '今天的投入尚未完成工作分類';
      overview = `有 ${missingWorkType} 筆今日工作未填工作種類；補齊後才能準確判讀重心。`;
    } else if (primary.percent >= 60) {
      headline = `今天明顯聚焦在「${primary.label}」`;
      overview = `約 ${primary.percent}% 的投入落在這個區塊；${completionPercent}% 的投入已完成。`;
    } else if (kinds >= 4 && primary.percent < 40) {
      headline = '今天的投入較分散，切換情境偏多';
      overview = `最高的「${primary.label}」只占約 ${primary.percent}%，共跨越 ${kinds} 種工作。`;
    } else {
      headline = secondary ? `今天以「${primary.label}」為主，也兼顧「${secondary.label}」` : `今天主要投入「${primary.label}」`;
      overview = `主要區塊占約 ${primary.percent}%；整體投入完成率為 ${completionPercent}%。`;
    }
  }

  const insights = [];
  if (reflection.achievement) insights.push(`你認為最重要的成果是：${shorten(reflection.achievement, 90)}`);
  if (total > 0) insights.push(`完成項目承接 ${completionPercent}% 的投入；新接工作占 ${unplannedPercent}%。`);
  if (projects[0] && projects[0].label !== UNSET) insights.push(`專案投入最高的是「${projects[0].label}」（約 ${projects[0].percent}%）。`);
  if (kinds === 1) insights.push('今天的工作情境集中，切換成本相對低。');
  if (kinds >= 2 && kinds <= 3) insights.push(`今天跨 ${kinds} 種工作類型，分布尚屬可控。`);
  if (kinds >= 4) insights.push(`今天跨 ${kinds} 種工作類型，工作情境較破碎。`);
  if (missingWorkType + missingProject > 0) insights.push(`資料完整度提醒：${missingWorkType} 項缺工作種類、${missingProject} 項缺專案。`);
  if (!insights.length) insights.push('先補上今日工作或成果，下一次復盤會更具體。');

  const optimizations = [];
  if (reflection.blocker) optimizations.push(`針對卡點「${shorten(reflection.blocker, 72)}」，明天先定義一個能主動推進的小步驟，避免只停在等待。`);
  if (repeated.length) optimizations.push(`有 ${repeated.length} 項工作已排在後續超過 ${REPEAT_DAYS} 天；先為「${shorten(repeated[0].title, 52)}」設定明確的完成條件或下一個責任人。`);
  if (futureLoad >= 6) optimizations.push(`未來待處理共有 ${futureLoad} 項，建議明天只鎖定 1–3 個真正優先項，其餘保留在累積未完成。`);
  if (kinds >= 4) optimizations.push(`今天跨越 ${kinds} 種工作類型；可把同類工作批次處理，減少切換成本。`);
  if (unplannedPercent >= 35) optimizations.push(`新接工作占投入 ${unplannedPercent}%，臨時需求偏高；可預留固定緩衝時段，避免擠壓核心工作。`);
  if (missingWorkType + missingProject > 0) optimizations.push(`還有 ${missingWorkType} 項未填工作種類、${missingProject} 項未填專案；補齊後長期分析會更準確。`);
  if (!optimizations.length) optimizations.push('今天的投入與完成節奏相對穩定；明天可維持同樣的優先順序，並先完成最重要的一項。');

  const attention = [];
  if (reflection.attention) attention.push(reflection.attention);
  if (repeated.length) attention.push(`別讓「${shorten(repeated[0].title, 60)}」再次只被往後移；先決定做、拆小或取消。`);
  if (futureLoad > 0) attention.push(`明天與累積未完成合計 ${futureLoad} 項，開工前先確認排序是否仍符合實際優先級。`);
  if (!attention.length) attention.push('明天開始前先選定一件最重要的工作，完成後再開第二件。');

  const tomorrowActions = future.tomorrow.slice(0, 3).map((t) => t.title);
  if (!tomorrowActions.length && repeated[0]) tomorrowActions.push(repeated[0].title);
  if (!tomorrowActions.length) tomorrowActions.push('從今日成果或卡點中定義一個明確的下一步。');

  return {
    headline, overview, workTypes, projects, insights, optimizations, attention, tomorrowActions,
    metrics: { totalItems: entries.length, totalEffort: total, completionPercent, unplannedPercent, workTypeCount: kinds,
      futureLoad, repeatedCount: repeated.length, missingWorkType, missingProject },
  };
}

/** 可複製的復盤摘要（格式同舊看板） */
export function summaryText(day, a, reflection) {
  const bullets = (items) => (items || []).map((x) => `・${x}`).join('\n') || '・（無）';
  return [
    `【${day} 每日復盤】`,
    `【今日重心】\n${a.headline}\n${a.overview}`,
    reflection.achievement ? `【最重要成果】\n${reflection.achievement}` : '',
    reflection.blocker ? `【主要卡點】\n${reflection.blocker}` : '',
    `【可以優化】\n${bullets(a.optimizations)}`,
    `【明天要注意】\n${bullets(a.attention)}`,
    `【明日優先】\n${bullets(a.tomorrowActions)}`,
  ].filter(Boolean).join('\n\n');
}
