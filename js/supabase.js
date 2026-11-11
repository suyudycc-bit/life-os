import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// supabase-js 固定版本，從 jsDelivr 載入
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
// 網址加 ?mock=1 使用本機模擬資料庫（即使已設定 Supabase），方便調整介面。
// 資安 20261111（C）：只在本機開發主機生效；正式站（github.io 等）忽略 ?mock=1，免得有人在正式網址用模擬帳密、看到模擬畫面
export const isLocalDevHost = (host) => {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
};
export const isMock = isLocalDevHost(location.hostname) && new URLSearchParams(location.search).has('mock');

// 從「重設密碼」信件連結回來時，網址 hash 會帶 type=recovery（失效的連結則帶 error_description）。
// supabase-js 建立 client 時會讀走並清掉 hash，所以要在建立之前先記下來（docs/09「忘記密碼」）
const urlHash = new URLSearchParams(location.hash.replace(/^#/, ''));
export const recoveryInUrl = urlHash.get('type') === 'recovery';
export const authUrlError = urlHash.get('error_description') || urlHash.get('error_code') || '';

async function createClientForEnv() {
  if (isMock) {
    // 僅供本機測試介面；資料存在這台瀏覽器，不會同步，也不會碰到 Supabase
    const { createMockClient } = await import('./dev/mock-supabase.js');
    return createMockClient();
  }
  if (isConfigured) {
    const { createClient } = await import(SUPABASE_CDN);
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return null;
}

export const supabase = await createClientForEnv();
