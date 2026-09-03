const CACHE_NAME = 'gpt-image-playground-v0.6.34-scoped-match-v1'
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './logo.png']
const APP_SHELL_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.registration.scope).href))
const ASSETS_PATH = new URL('./assets/', self.registration.scope).pathname
const AUTH_PATH = new URL('./auth/', self.registration.scope).pathname
const API_PATH = '/api/'
const SCOPED_API_PATH = new URL('./api/', self.registration.scope).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map(async (key) => {
        // 单个删除失败不应中断其余清理，否则旧 cache 会一直残留。
        if (key !== CACHE_NAME) return caches.delete(key).catch(() => false)
        // 历史版本缓存过带用户身份的 API 响应，而 caches.match 会遍历全部 cache，
        // 残留条目会让接口一直读到陈旧数据，这里显式清掉。
        const cache = await caches.open(key)
        const requests = await cache.keys()
        return Promise.all(requests
          .filter((request) => new URL(request.url).pathname.includes('/api/'))
          .map((request) => cache.delete(request).catch(() => false)))
      })),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // OIDC 的跨域重定向链必须由浏览器原生导航处理。
  if (url.pathname.startsWith(AUTH_PATH)) return

  // API 请求始终交给浏览器网络栈，不进入 Service Worker 的响应与缓存流程。
  if (url.pathname.startsWith(API_PATH) || url.pathname.startsWith(SCOPED_API_PATH)) return

  // Range 请求的响应是 206，Cache API 不接受，直接交给浏览器处理。
  if (request.headers.has('range')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy))
          }
          return response
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match('./index.html'))),
    )
    return
  }

  // 只缓存明确的静态资源，避免按 URL 缓存带用户身份的 API 响应。
  if (!APP_SHELL_URLS.has(request.url) && !url.pathname.startsWith(ASSETS_PATH)) return

  const isAsset = url.pathname.startsWith(ASSETS_PATH)

  event.respondWith(
    // 必须限定 cacheName：caches.match 不指定时会遍历全部 cache，
    // 历史版本残留的条目（含 API 响应）会被错误命中。
    caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => {
      // 历史版本把 SPA fallback 的 HTML 按 asset URL 缓存过，这类条目会让
      // 浏览器 MIME 校验失败且永不失效，命中即视为无效并回源。
      if (cached && !(isAsset && isHtmlResponse(cached))) return cached

      return fetch(request).then((response) => {
        // 206 等非完整响应无法写入 Cache，只缓存 200。
        // asset 请求拿到 HTML 说明服务端走了 SPA fallback，绝不能缓存。
        if (response.status === 200 && !(isAsset && isHtmlResponse(response))) {
          cache.put(request, response.clone())
        }
        return response
      })
    })),
  )
})

function isHtmlResponse(response) {
  return (response.headers.get('content-type') || '').includes('text/html')
}
