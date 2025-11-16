// sw.js — updated push handler to force persistent/native notifications
self.addEventListener('push', event => {
  console.log('[sw] push event', event);

  event.waitUntil((async () => {
    let payload = { title: 'EarthPulse', body: 'New alert', tag: `earthpulse:${Date.now()}`, data: {} };

    try {
      if (event.data) {
        const text = event.data.text();
        try {
          const j = JSON.parse(text);
          payload.title = j.title || payload.title;
          payload.body  = j.body  || payload.body;
          payload.tag   = j.tag   || payload.tag;
          payload.data  = j.data  || j || payload.data;
        } catch (e) {
          payload.body = text || payload.body;
        }
      }
    } catch (err) {
      console.warn('[sw] error reading push payload', err);
    }

    const options = {
      body: payload.body,
      tag: payload.tag,
      data: payload.data,
      renotify: true,
      requireInteraction: payload.data.requireInteraction === true ? true : true, // force true
      vibrate: [100, 50, 100],
      // set icon and badge (update paths to your assets if you have them)
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png'
    };

    try {
      console.log('[sw] showing notification', payload.title, options);
      await self.registration.showNotification(payload.title, options);
    } catch (err) {
      console.error('[sw] showNotification failed', err);
    }
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});
