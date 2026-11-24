// Service Worker（20261117，網站推播提醒）：只處理推播與點通知，不快取任何檔案（避免看到舊版網站）。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch { msg = { title: 'Why Am I Here?', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(msg.title || 'Why Am I Here?', {
    body: msg.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: msg.url || './' }, tag: 'lifeos-reminder', renotify: true,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || './';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if ('focus' in w) { await w.navigate?.(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
