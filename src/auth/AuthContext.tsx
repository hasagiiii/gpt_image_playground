import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  consumeAuthHash,
  fetchUser,
  getAccessToken,
  isAuthEnabled,
  logout as apiLogout,
  type PublicUser,
} from './api'

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'disabled'

export type AuthContextValue = {
  status: AuthStatus
  user: PublicUser | null
  /** 触发刷新当前用户（拉 /auth/user）*/
  refreshUser: () => Promise<void>
  /** 退出登录 */
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isAuthEnabled() ? 'loading' : 'disabled')
  const [user, setUser] = useState<PublicUser | null>(null)
  const initialized = useRef(false)

  const refreshUser = useCallback(async () => {
    if (!isAuthEnabled()) return
    if (!getAccessToken()) {
      setStatus('unauthenticated')
      setUser(null)
      return
    }
    try {
      const u = await fetchUser()
      if (u) {
        setUser(u)
        setStatus('authenticated')
      } else {
        setUser(null)
        setStatus('unauthenticated')
      }
    } catch {
      setUser(null)
      setStatus('unauthenticated')
    }
  }, [])

  const handleLogout = useCallback(async () => {
    await apiLogout()
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  // 启动时：先消费 callback hash，再拉用户
  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    if (!isAuthEnabled()) {
      setStatus('disabled')
      return
    }
    consumeAuthHash()
    void refreshUser()
  }, [refreshUser])

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, refreshUser, logout: handleLogout }),
    [status, user, refreshUser, handleLogout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    // 在未启用认证时 AuthProvider 也会挂载，所以这里只可能是漏挂
    throw new Error('useAuth must be used within <AuthProvider>')
  }
  return ctx
}
