import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'

/**
 * UserMenu 嵌入到 Header 右侧，未登录或禁用时不渲染。
 * 提供：用户头像/姓名 + 弹出菜单 + 退出登录入口。
 */
export default function UserMenu() {
  const { status, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (status !== 'authenticated' || !user) return null

  const display = user.name || user.email || user.id.slice(0, 8)
  const initial = (user.name?.[0] || user.email?.[0] || '?').toUpperCase()

  const handleLogout = async () => {
    setOpen(false)
    await logout()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
        aria-label="账户菜单"
      >
        {user.picture_url ? (
          <img
            src={user.picture_url}
            alt=""
            className="w-7 h-7 rounded-full object-cover bg-gray-200 dark:bg-gray-800"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-semibold flex items-center justify-center">
            {initial}
          </span>
        )}
        <span className="hidden sm:inline text-sm text-gray-700 dark:text-gray-200 max-w-[120px] truncate">
          {display}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-56 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 dark:border-white/[0.06]">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {user.name || '未命名用户'}
            </div>
            {user.email && (
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {user.email}
              </div>
            )}
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
              来源：{user.oidc_provider}
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}
