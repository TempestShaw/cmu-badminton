// Shows queue notifications and brings the page forward when one is tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = { title: 'CMU Recreational Badminton', body: 'The queue has been updated', tag: 'queue' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // Keep the generic message when the payload is missing or malformed.
  }
  event.waitUntil(self.registration.showNotification(message.title, {
    body: message.body,
    tag: message.tag,
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
    icon: '/icons/court-192.png',
    badge: '/icons/court-192.png',
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).pathname === '/');
    if (open) return open.focus();
    return self.clients.openWindow(event.notification.data?.url ?? '/');
  })());
});
