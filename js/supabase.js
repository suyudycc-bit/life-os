import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// supabase-js 固定版本，從 jsDelivr 載入
const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
// 網址加 ?mock=1 一律使用本機模擬資料庫（即使已設定 Supabase），方便調整介面
export const isMock = new URLSearchParams(location.search).has('mock');

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
