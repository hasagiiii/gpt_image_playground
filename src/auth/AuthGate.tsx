import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import LoginModal from './LoginModal'

/**
 * AuthGate 是高阶组件：
 * - status === 'disabled'：直接放行（兼容纯静态部署）
 * - status === 'loading'：渲染轻量占位
 * - status === 'authenticated'：渲染子组件
 * - status === 'unauthenticated'：渲染首页并叠加登录弹窗（强制登录）
 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-sm text-gray-500 dark:text-gray-400">正在加载…</div>
      </div>
    )
  }

  return (
    <>
      {children}
      {status === 'unauthenticated' && <LoginModal />}
    </>
  )
}
