// 照片擷取文字（20261114，來自回饋 cfd1ead8：佳句想要上傳照片一鍵擷取文字）
// 用 tesseract.js 在瀏覽器裡辨識，照片不會上傳到任何伺服器。第一次使用時才從 jsDelivr 下載程式與語言資料（之後瀏覽器會快取）。
// 版本全部固定（2026-11-14 查證 npm）：tesseract.js 7.0.0、tesseract.js-core 7.0.0、@tesseract.js-data/chi_tra、eng 1.0.0（4.0.0_best_int，LSTM）。
// 繁體中文模型約 1.6MB（壓縮後）。CSP 需要：script-src 'wasm-unsafe-eval'、worker-src blob:、connect-src https://cdn.jsdelivr.net（見 docs/09）。
const LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js';
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const LANG_PATH = { chi_tra: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int',
  eng: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int' };
export const OCR_LANGS = { chi_tra: '中文', eng: '英文' };
const MAX_SIDE = 2400; // 太大的照片先縮小，加快辨識

/** 照片太大就縮到最長邊 MAX_SIDE（回傳 Blob；小的直接用原檔） */
async function shrink(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k >= 1) { bmp.close?.(); return file; }
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.92));
}

/**
 * 整理辨識結果：中文字之間多出來的空白拿掉；書本排版的斷行（中文接中文）接回同一行；空行（段落）保留。
 * 英文照原樣，只把斷在行尾的連字號接回。
 */
export function tidyOcrText(raw) {
  const CJK = '[\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef]';
  return String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(new RegExp(`(${CJK})[ \\t]+(?=${CJK})`, 'g'), '$1')
    // 中文前後的半形標點換成全形，並拿掉標點旁的空白（辨識常把「，」認成「 , 」）
    .replace(new RegExp(`(${CJK})\\s*([,;:!?])\\s*(?=${CJK}|$)`, 'gm'), (m, a, p) => a + { ',': '，', ';': '；', ':': '：', '!': '！', '?': '？' }[p])
    .replace(new RegExp(`(${CJK})\\s+(?=[，。、；：！？」』）])`, 'g'), '$1')
    .replace(new RegExp(`([，。、；：！？「『（])\\s+(?=${CJK})`, 'g'), '$1')
    .split(/\n{2,}/)
    .map((para) => para.split('\n').map((l) => l.trim()).filter(Boolean)
      .reduce((acc, line) => {
        if (!acc) return line;
        if (new RegExp(`${CJK}$`).test(acc) || new RegExp(`^${CJK}`).test(line)) return acc + line;
        if (/-$/.test(acc)) return acc.slice(0, -1) + line;
        return `${acc} ${line}`;
      }, ''))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

/** 辨識一張照片；onProgress(0~1, 說明文字) */
export async function recognizeImage(file, lang = 'chi_tra', onProgress = () => {}) {
  if (!LANG_PATH[lang]) throw new Error('不支援這個語言');
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('請選一張照片');
  onProgress(0, '準備辨識（第一次使用要下載約 2MB）…');
  let Tesseract;
  try {
    Tesseract = await import(LIB);
  } catch {
    throw new Error('下載文字辨識程式失敗，請確認網路後再試一次');
  }
  const { createWorker } = Tesseract.default || Tesseract;
  const STAGE = { 'loading tesseract core': '載入辨識程式', 'loading language traineddata': '下載語言資料', 'initializing api': '準備中', 'recognizing text': '辨識中' };
  const worker = await createWorker(lang, 1, {
    workerPath: WORKER, corePath: CORE, langPath: LANG_PATH[lang],
    logger: (m) => { if (typeof m.progress === 'number') onProgress(m.progress, STAGE[m.status] || '處理中'); },
  });
  try {
    const img = await shrink(file);
    const { data } = await worker.recognize(img);
    return tidyOcrText(data?.text || '');
  } finally {
    await worker.terminate();
  }
}
