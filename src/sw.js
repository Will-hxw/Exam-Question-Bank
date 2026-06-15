const CACHE_NAME = 'cquccp-9f396a0faf';
const INDEX_URL = new URL('index.html', self.registration.scope).href;
const VERSION_URL = new URL('version.txt', self.registration.scope).href;
const PRECACHE_URLS = [
  INDEX_URL,
  VERSION_URL,
  new URL('icon.98efd515c8.jpg', self.registration.scope).href,
  new URL('questions-compact.9f396a0faf.json', self.registration.scope).href
];
const IMMUTABLE_URLS = new Set([
  new URL('questions-compact.9f396a0faf.json', self.registration.scope).href,
  new URL('questions-compact.json', self.registration.scope).href,
  new URL('icon.98efd515c8.jpg', self.registration.scope).href,
  new URL('ai.7e2db9d398.js', self.registration.scope).href
]);

self.addEventListener('install', function(event) {
  var succeeded = 0;
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // 逐个缓存，避免一个失败拖累全部
      return Promise.all(PRECACHE_URLS.map(function(url) {
        return cache.add(url).then(function() { succeeded++; }).catch(function(e) {
          console.warn('[SW] precache failed for:', url, e);
        });
      }));
    }).then(function() {
      if (succeeded > 0 || PRECACHE_URLS.length === 0) return self.skipWaiting();
      console.warn('[SW] all precache URLs failed, not activating');
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(key) {
        if (key.indexOf('cquccp-') === 0 && key !== CACHE_NAME) {
          return caches.delete(key);
        }
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

function isSameScope(url) {
  var scopePath = new URL(self.registration.scope).pathname;
  return url.origin === location.origin && url.pathname.indexOf(scopePath) === 0;
}

function cacheFirst(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cached) {
      if (cached) return cached;
      return fetch(request).then(function(response) {
        if (response && response.ok) {
          cache.put(request, response.clone()).catch(function(e) {
            console.warn('[SW] cache put failed:', request.url, e);
          });
        }
        return response;
      });
    });
  });
}

// 后台检查 version.txt，版本变化则刷新 HTML 缓存并通知客户端
function checkVersionAndRefresh() {
  return fetch(VERSION_URL, {cache: 'no-cache'}).then(function(netRes) {
    if (!netRes || !netRes.ok) return;
    return netRes.text().then(function(netVersion) {
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(VERSION_URL).then(function(cachedRes) {
          if (!cachedRes) {
            return cache.put(VERSION_URL, netRes.clone());
          }
          return cachedRes.text().then(function(cachedVersion) {
            if (netVersion.trim() === cachedVersion.trim()) return;
            // 版本变了，拉新 HTML 并更新缓存
            return fetch(INDEX_URL, {cache: 'no-cache'}).then(function(htmlRes) {
              if (!htmlRes || !htmlRes.ok) return;
              return Promise.all([
                cache.put(INDEX_URL, htmlRes.clone()),
                cache.put(VERSION_URL, netRes.clone())
              ]).then(function() {
                return self.clients.matchAll().then(function(clients) {
                  clients.forEach(function(client) {
                    client.postMessage({ type: 'new-version' });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

self.addEventListener('fetch', function(event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (!isSameScope(url)) return;

  // HTML: 缓存秒开 + version.txt 探版本
  if (request.mode === 'navigate' || url.href === INDEX_URL) {
    event.respondWith(
      caches.match(INDEX_URL).then(function(cached) {
        return cached || fetch(request);
      })
    );
    event.waitUntil(checkVersionAndRefresh().catch(function() {}));
    return;
  }

  // version.txt 自身：走网络，失败才缓存
  if (url.href === VERSION_URL) {
    event.respondWith(
      fetch(request, {cache: 'no-cache'}).catch(function() {
        return caches.match(VERSION_URL);
      })
    );
    return;
  }

  if (IMMUTABLE_URLS.has(url.href)) {
    event.respondWith(cacheFirst(request));
  }
});
