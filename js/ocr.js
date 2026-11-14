// 照片擷取文字（20261114，來自回饋 cfd1ead8：佳句想要上傳照片一鍵擷取文字）
// 用 tesseract.js 在瀏覽器裡辨識，照片不會上傳到任何伺服器。第一次使用時才從 jsDelivr 下載程式與語言資料（之後瀏覽器會快取）。
// 版本全部固定（2026-11-14 查證 npm）：tesseract.js 7.0.0、tesseract.js-core 7.0.0、@tesseract.js-data/chi_tra、eng 1.0.0（4.0.0_best_int，LSTM）。
// 繁體中文模型約 1.6MB（壓縮後）。CSP 需要：script-src 'wasm-unsafe-eval'、worker-src blob:、connect-src https://cdn.jsdelivr.net（見 docs/09）。
const LIB = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
const WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js';
const CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
const LANG_PATH = { chi_tra: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int',
  chi_tra_vert: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra_vert@1.0.0/4.0.0_best_int',
  eng: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int' };
// 20261114 第二版（使用者回報真實書頁照片辨識成亂碼）：加直排、自動判斷橫直、影像增強、信心分數
export const OCR_LANGS = { auto: '中文（自動判斷橫直）', chi_tra: '中文橫排', chi_tra_vert: '中文直排', eng: '英文' };
const MAX_SIDE = 2400; // 太大的照片先縮小，加快辨識
const MIN_SIDE = 1600; // 太小的放大（字太小認不出來）
const AUTO_RETRY_BELOW = 70; // 自動模式：依版面選的那一種信心低於這個分數，再用另一種試一次，取分數高的

/**
 * 影像增強：縮放到適合大小 → 灰階 → 除以模糊後的背景（去掉陰影、光線不均）→ 拉開對比。回傳 canvas。
 * 書頁照片常有一邊暗一邊亮、紙張泛黃，直接丟給辨識會把陰影當成字；先把背景壓平再辨識。
 */
async function enhance(file) {
  const bmp = await createImageBitmap(file).catch(() => null); // 預設會套用照片的 EXIF 方向
  if (!bmp) throw new Error('讀不到這張照片，換一張試試（支援 JPG、PNG、HEIC 依瀏覽器而定）');
  const long = Math.max(bmp.width, bmp.height);
  const k = long > MAX_SIDE ? MAX_SIDE / long : long < MIN_SIDE ? MIN_SIDE / long : 1;
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  // 背景：縮到 1/24 再放大（等於大範圍模糊），字會被抹掉，只剩紙的明暗
  const sw = Math.max(1, Math.round(w / 24));
  const sh = Math.max(1, Math.round(h / 24));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sg = small.getContext('2d');
  sg.filter = 'blur(2px)';
  sg.drawImage(c, 0, 0, sw, sh);
  const bg = document.createElement('canvas');
  bg.width = w; bg.height = h;
  const bgg = bg.getContext('2d', { willReadFrequently: true });
  bgg.imageSmoothingQuality = 'high';
  bgg.drawImage(small, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const back = bgg.getImageData(0, 0, w, h).data;
  const d = img.data;
  const gray = new Float32Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const by = 0.299 * back[i] + 0.587 * back[i + 1] + 0.114 * back[i + 2];
    const v = Math.min(255, (y / Math.max(by, 1)) * 235); // 紙變成接近白、字保持深
    gray[p] = v;
    hist[v | 0]++;
  }
  // 對比：第 1% 暗到第 60% 亮之間拉開（書頁大部分是紙，取 60% 當白）
  const total = w * h;
  let acc = 0; let lo = 0; let hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.01) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.6) { hi = v; break; } }
  const span = Math.max(30, hi - lo);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = Math.max(0, Math.min(255, ((gray[p] - lo) / span) * 255));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
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

/**
 * 判斷橫排或直排（看版面，不看辨識分數——實測直排書頁用橫排模型辨識，字對但順序亂，分數仍有 91）：
 * 增強後的圖取深色點，算每一列、每一欄的墨水量。橫排字行與行之間有空白，所以「每列」的墨水量起伏大；
 * 直排則是「每欄」起伏大。比較兩邊的變異係數（標準差／平均）。只看有字的範圍，四周留白不算。
 */
export function layoutOf(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const rows = new Float64Array(h);
  const cols = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4] < 110) { rows[y]++; cols[x]++; }
    }
  }
  const cv = (arr) => {
    let first = arr.findIndex((v) => v > 0);
    let last = arr.length - 1;
    while (last > first && arr[last] === 0) last--;
    if (first < 0 || last - first < 10) return 0;
    let sum = 0;
    for (let i = first; i <= last; i++) sum += arr[i];
    const mean = sum / (last - first + 1);
    let v = 0;
    for (let i = first; i <= last; i++) v += (arr[i] - mean) ** 2;
    return mean ? Math.sqrt(v / (last - first + 1)) / mean : 0;
  };
  const r = cv(rows);
  const c = cv(cols);
  return { vertical: c > r * 1.1, rowsCv: Math.round(r * 100) / 100, colsCv: Math.round(c * 100) / 100 };
}

let lib = null;
async function loadLib() {
  if (lib) return lib;
  try {
    const T = await import(LIB);
    lib = T.default || T;
    return lib;
  } catch {
    throw new Error('下載文字辨識程式失敗，請確認網路後再試一次');
  }
}

const STAGE = { 'loading tesseract core': '載入辨識程式', 'loading language traineddata': '下載語言資料', 'initializing api': '準備中', 'recognizing text': '辨識中' };

/** 用一種語言辨識一次：回傳 { text, confidence(0~100), lang } */
async function runOnce(image, lang, onProgress, label) {
  const { createWorker } = await loadLib();
  const worker = await createWorker(lang, 1, {
    workerPath: WORKER, corePath: CORE, langPath: LANG_PATH[lang],
    logger: (m) => { if (typeof m.progress === 'number') onProgress(m.progress, `${label}${STAGE[m.status] || '處理中'}`); },
  });
  try {
    // 直排：一整塊由上到下、由右到左的文字（Tesseract PSM 5）；其他用自動版面分析（預設 3）
    if (lang === 'chi_tra_vert') await worker.setParameters({ tessedit_pageseg_mode: '5' });
    const { data } = await worker.recognize(image);
    return { text: tidyOcrText(data?.text || ''), confidence: Math.round(data?.confidence ?? 0), lang };
  } finally {
    await worker.terminate();
  }
}

/**
 * 辨識一張照片；mode＝auto／chi_tra／chi_tra_vert／eng；onProgress(0~1, 說明文字)。
 * 回傳 { text, confidence, lang }。auto：依版面（layoutOf）先選橫排或直排，信心低於 AUTO_RETRY_BELOW 再試另一種，取信心高的。
 */
export async function recognizeImage(file, mode = 'auto', onProgress = () => {}) {
  if (!OCR_LANGS[mode]) throw new Error('不支援這個語言');
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('請選一張照片');
  onProgress(0, '整理照片（去陰影、加強對比）…');
  const image = await enhance(file);
  if (mode !== 'auto') return runOnce(image, mode, onProgress, '');
  // 自動：先看版面決定橫排或直排；那一種的信心太低，再用另一種試一次，取信心高的
  const first = layoutOf(image).vertical ? 'chi_tra_vert' : 'chi_tra';
  const other = first === 'chi_tra' ? 'chi_tra_vert' : 'chi_tra';
  const name = { chi_tra: '橫排', chi_tra_vert: '直排' };
  const a = await runOnce(image, first, onProgress, `${name[first]}：`);
  if (a.confidence >= AUTO_RETRY_BELOW && a.text) return a;
  const b = await runOnce(image, other, onProgress, `再試${name[other]}：`);
  return b.confidence > a.confidence ? b : a;
}
