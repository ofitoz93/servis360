// Servis360 Şoför PWA Service Worker (v2.2 - Web Push & Arka Plan Bildirimi Destekli)
const CACHE_NAME = 'servis360-driver-v2.2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// SUNUCUDAN GELEN WEB PUSH BİLDİRİMLERİ (Telefon ekranı kapalı ve uygulama kapalıyken bile çalışır!)
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: '🔔 Servis Saati Geldi!', body: event.data.text() };
    }
  }

  const title = data.title || '⏰ Servis360 Sefer Bildirimi';
  const options = {
    body: data.body || 'Sefer saatiniz geldi. Canlı GPS yayınını başlatmak için dokunun.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [500, 200, 500, 200, 500, 200, 800],
    tag: data.tag || ('servis360-trip-alarm-' + Date.now()),
    renotify: true,
    requireInteraction: true,
    silent: false,
    data: {
      url: data.url || '/driver.html',
      trip_mode: data.trip_mode || 'morning',
      auto_start: true
    },
    actions: [
      { action: 'start', title: '▶️ Aç & Canlı Konumu Başlat' },
      { action: 'dismiss', title: 'Kapat' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Bildirime tıklandığında veya bildirim butonlarına basıldığında
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;

  if (action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. "Canlı Konumu Durdur" butonuna basıldıysa
      if (action === 'stop') {
        clientList.forEach((client) => {
          client.postMessage({ type: 'STOP_TRACKING_FROM_NOTIFICATION' });
        });
        return;
      }

      // 2. Halihazırda açık bir driver.html sekmesi varsa odaklan ve başlat
      for (const client of clientList) {
        if (client.url.includes('driver.html') && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICKED_AUTO_START' });
          return client.focus();
        }
      }

      // 3. Sekme açık değilse yeni pencere aç
      if (self.clients.openWindow) {
        return self.clients.openWindow('/driver.html?autostart=1');
      }
    })
  );
});

// Sayfadan gelen bildirim talepleri (Sayfa açıkken gönderilen yerel bildirimler)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const finalOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [300, 150, 300],
      ...options
    };
    self.registration.showNotification(title, finalOptions);
  }
});
