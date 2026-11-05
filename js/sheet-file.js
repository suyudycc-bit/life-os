// 讀試算表檔案 → 列（字串陣列的陣列，第一列是標題）。給「匯入規劃表」用。
// - CSV：先當 UTF-8 解；不是合法 UTF-8 就當 Big5（Windows Excel「另存 CSV」常見）。
// - Excel（.xlsx）：用瀏覽器內建的 DecompressionStream 解壓，不另載函式庫。
//   讀「規劃表」或「每日進度」分頁，沒有就讀第一個分頁。日期若是 Excel 序號，交給 data.planDate 換算。
import { cfaParseCSV } from './data.js';

export async function readSheetFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.xls')) throw new Error('不支援舊版 .xls，請在 Excel 另存成 .xlsx 或 CSV');
  if (name.endsWith('.xlsx')) return readXlsx(await file.arrayBuffer());
  return cfaParseCSV(decodeText(await file.arrayBuffer()));
}

function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* 不是 UTF-8 */ }
  try { return new TextDecoder('big5').decode(buf); } catch { return new TextDecoder().decode(buf); }
}

// ---- .xlsx（zip）----
async function unzip(buf) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('這不是有效的 .xlsx 檔');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const fname = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    files[fname] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (fname) => {
    const f = files[fname];
    if (!f) return null;
    const start = f.local + 30 + v.getUint16(f.local + 26, true) + v.getUint16(f.local + 28, true);
    const raw = new Uint8Array(buf, start, f.size);
    if (f.method === 0) return dec.decode(raw);
    if (f.method !== 8) throw new Error('無法讀取這個 .xlsx 的壓縮格式，請改存成 CSV');
    if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器無法直接讀 Excel，請改存成 CSV 再匯入');
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const byTag = (node, tag) => [...node.getElementsByTagName(tag)];
const textOf = (si) => byTag(si, 't').map((t) => t.textContent).join('');

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0] || 'A';
  return [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

async function readXlsx(buf) {
  const read = await unzip(buf);
  const wb = await read('xl/workbook.xml');
  if (!wb) throw new Error('這不是有效的 .xlsx 檔');
  const sheets = byTag(xml(wb), 'sheet').map((s) => ({
    name: s.getAttribute('name'),
    rid: s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'),
  }));
  const pick = sheets.find((s) => /規劃表|每日進度/.test(s.name)) || sheets[0];
  if (!pick) throw new Error('Excel 裡沒有工作表');
  const rels = xml((await read('xl/_rels/workbook.xml.rels')) || '<x/>');
  let target = byTag(rels, 'Relationship').find((r) => r.getAttribute('Id') === pick.rid)?.getAttribute('Target') || 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const shared = await read('xl/sharedStrings.xml');
  const strings = shared ? byTag(xml(shared), 'si').map(textOf) : [];
  const sheet = await read(target);
  if (!sheet) throw new Error(`讀不到工作表「${pick.name}」`);
  const rows = [];
  for (const row of byTag(xml(sheet), 'row')) {
    const r = [];
    for (const c of byTag(row, 'c')) {
      const t = c.getAttribute('t');
      const vEl = byTag(c, 'v')[0];
      let val = '';
      if (t === 's') val = strings[Number(vEl?.textContent)] ?? '';
      else if (t === 'inlineStr') val = textOf(c);
      else if (t === 'b') val = vEl?.textContent === '1' ? 'TRUE' : 'FALSE';
      else val = vEl?.textContent ?? '';
      r[colIndex(c.getAttribute('r'))] = val;
    }
    rows.push(Array.from(r, (x) => x ?? ''));
  }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}
