// Servis360 Şoför PWA Service Worker
const CACHE_NAME = 'servis360-driver-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Bildirime tıklandığında veya bildirim butonlarına basıldığında
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 1. "Canlı Konumu Durdur" butonuna basıldıysa
      if (action === 'stop') {
        clientList.forEach((client) => {
          client.postMessage({ type: 'STOP_TRACKING_FROM_NOTIFICATION' });
        });
        return;
      }

      // 2. "Devam Et" butonuna basıldıysa veya bildirimin gövdesine tıklandıysa
      for (const client of clientList) {
        if (client.url.includes('driver.html') && 'focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow('/driver.html');
      }
    })
  );
});

// Sayfadan gelen bildirim talepleri
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, options } = event.data;
    const finalOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [250, 100, 250],
      ...options
    };
    self.registration.showNotification(title, finalOptions);
  }
});

