// 書影單的封面搜尋（只在瀏覽器呼叫公開、免金鑰的 API；來源、查證連結與待確認事項見 docs/10-media-covers.md）
// - 書：Open Library 搜尋（關鍵字至少 3 個字）＋ Apple iTunes Search API 的 ebook（中文書多半只在這裡找得到）
// - Podcast：Apple iTunes Search API（country=TW）
// - 電影、影集、課程：沒有可用的免金鑰來源（2026-11-04 實測 iTunes 的 movie／tvShow 幾乎都查無結果），只能手貼網址
// 回傳的候選：{ title, creator, year, cover, source }；cover 一律是 https

const OL_SEARCH = 'https://openlibrary.org/search.json';
const OL_COVER = (id) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
const ITUNES = 'https://itunes.apple.com/search';

/** 哪些類型可以自動搜尋 */
export const COVER_SEARCH = {
  book: 'Open Library、Apple Books',
  podcast: 'Apple Podcasts',
};
export const canSearchCover = (kind) => kind in COVER_SEARCH;

async function getJSON(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const https = (u) => (typeof u === 'string' ? u.replace(/^http:\/\//, 'https://') : '');
/** iTunes 縮圖網址最後一段是尺寸（…/100x100bb.jpg）；換成 600x600 實測可用（2026-11-04），找不到這段就維持原網址 */
export const itunesLarge = (u) => https(u).replace(/\/\d+x\d+(bb)?\.(jpg|png)$/, '/600x600bb.$2');

async function openLibrary(q, signal) {
  const url = `${OL_SEARCH}?q=${encodeURIComponent(q)}&limit=12&fields=title,author_name,first_publish_year,cover_i`;
  const d = await getJSON(url, signal);
  return (d.docs || []).filter((x) => x.cover_i).slice(0, 8).map((x) => ({
    title: x.title, creator: (x.author_name || []).slice(0, 2).join('、'), year: x.first_publish_year || null,
    cover: OL_COVER(x.cover_i), source: 'Open Library',
  }));
}

async function itunes(q, media, country, signal) {
  const url = `${ITUNES}?term=${encodeURIComponent(q)}&media=${media}&country=${country}&limit=8`;
  const d = await getJSON(url, signal);
  return (d.results || []).filter((x) => x.artworkUrl100).map((x) => ({
    title: x.trackName || x.collectionName, creator: x.artistName || '',
    // Podcast 的 releaseDate 是最新一集的日期，不是開播年份，所以不帶
    year: media === 'podcast' || !x.releaseDate ? null : Number(String(x.releaseDate).slice(0, 4)),
    cover: itunesLarge(x.artworkUrl100), source: media === 'ebook' ? 'Apple Books' : 'Apple Podcasts',
  }));
}

/**
 * 搜尋封面候選。兩個來源都失敗才丟錯（呼叫端顯示「網路錯誤」）；任一來源有回應但沒結果就回 []。
 * 書的 ebook 用 country=US：實測 TW 商店的 ebook 只回公版古籍（例如搜「三體」得到《三略》），US 反而找得到中文書。
 */
export async function searchCovers(kind, query, { signal } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  let jobs;
  // Open Library 規定關鍵字至少 3 個字（否則回 422），太短就只查 Apple Books
  if (kind === 'book') jobs = [...([...q].length >= 3 ? [openLibrary(q, signal)] : []), itunes(q, 'ebook', 'US', signal)];
  else if (kind === 'podcast') jobs = [itunes(q, 'podcast', 'TW', signal)];
  else return [];
  const settled = await Promise.allSettled(jobs);
  if (settled.every((s) => s.status === 'rejected')) {
    const err = settled[0].reason;
    if (err?.name === 'AbortError') throw err;
    throw new Error('連不上封面來源，請檢查網路，或直接貼封面網址');
  }
  const seen = new Set();
  return settled.flatMap((s) => (s.status === 'fulfilled' ? s.value : []))
    .filter((c) => c.title && /^https:\/\//.test(c.cover) && !seen.has(c.cover) && seen.add(c.cover))
    .slice(0, 12);
}
