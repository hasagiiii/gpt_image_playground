import { useEffect, useState } from 'react'
import { listProviders, startLogin, type Provider } from './api'

export default function LoginPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listProviders()
      .then((list) => {
        if (alive) {
          setProviders(list)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (alive) {
          setError(String(err?.message ?? err))
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 shadow-lg p-8">
        <div className="flex flex-col items-center gap-2 mb-6">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            GPT Image Playground
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            登录后即可使用
          </p>
        </div>

        {loading && (
          <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            正在加载登录方式…
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
            无法加载登录方式：{error}
          </div>
        )}

        {!loading && !error && providers.length === 0 && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-300">
            后端未配置任何 OIDC 提供商。请联系管理员。
          </div>
        )}

        <div className="flex flex-col gap-2 mt-2">
          {providers.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => startLogin(p.name)}
              className="w-full rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] hover:bg-gray-100 dark:hover:bg-white/[0.08] text-gray-900 dark:text-gray-100 px-4 py-2.5 text-sm font-medium transition-colors"
            >
              使用 {p.display_name} 登录
            </button>
          ))}
        </div>

        <p className="mt-6 text-xs text-center text-gray-400 dark:text-gray-500">
          登录信息由第三方提供商管理
        </p>
      </div>
    </div>
  )
}
