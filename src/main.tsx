import 'core-js/actual/array/at'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import AuthGate from './auth/AuthGate'
import 'streamdown/styles.css'
import 'katex/dist/katex.min.css'
import './index.css'
import { installMobileViewportGuards } from './lib/viewport'

// 在页面加载时重置 sessionStorage 状态，确保每次页面刷新都能重新获取 API
if (typeof window !== 'undefined') {
  sessionStorage.removeItem('githubApiFetched')
  sessionStorage.removeItem('apiKeysFetched')
}

installMobileViewportGuards()

// 历史版本的 Service Worker 会缓存任意同源 GET 响应，其中包含带用户身份的 API
// 响应；而 caches.match 不指定 cacheName 时会遍历全部 cache，残留的旧 cache 会
// 让接口一直读到首次的陈旧数据。SW 自身的清理依赖新版本被装上，一旦旧版换不掉就
// 永远不执行，因此在主线程兜底清理：这段代码随构建产物下发，不受 SW 更新阻塞影响。
async function purgeStaleHttpCaches() {
  if (!('caches' in window)) return
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        if (new URL(request.url).pathname.includes('/api/')) await cache.delete(request)
      }
    }
  } catch (error) {
    console.warn('清理历史接口缓存失败：', error)
  }
}

if ('serviceWorker' in navigator) {
  // 清理必须先于首屏接口请求，因此不等 load 事件；SW 注册照旧延后以免争抢带宽。
  void purgeStaleHttpCaches()
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch((error) => {
        console.error('Service worker registration failed:', error)
      })
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister())
    })
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </AuthProvider>
  </StrictMode>,
)
