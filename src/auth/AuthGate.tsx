import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import LoginPage from './LoginPage'

/**
 * AuthGate 是高阶组件：
 * - status === 'disabled'：直接放行（兼容纯静态部署）
 * - status === 'loading'：渲染轻量占位
 * - status === 'authenticated'：渲染子组件
 * - 其他：渲染登录页
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'disabled' || status === 'authenticated') {
    return <>{children}</>
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-sm text-gray-500 dark:text-gray-400">正在加载…</div>
      </div>
    )
  }

  return <LoginPage />
}
