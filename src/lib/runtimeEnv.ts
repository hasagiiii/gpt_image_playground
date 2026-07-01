export function readRuntimeEnv(value: string | undefined): string {
  return String.prototype.trim.call(value ?? '')
}

// 统一运行时配置读取：优先 Go 注入的 window.__APP_CONFIG__[key]，
// 缺失时回退 import.meta.env['VITE_' + key]（保证 dev 与现有测试零改动），最后 trim。
export function getRuntimeConfig(key: string): string {
  const injected = typeof window !== 'undefined' ? window.__APP_CONFIG__?.[key] : undefined
  const fallback = (import.meta.env as Record<string, string | undefined>)['VITE_' + key]
  return readRuntimeEnv(injected ?? fallback)
}

// auth 专用读取：保留 undefined / 'disabled' / 空串 三态语义，不做空串归一。
// 注入优先，仅当注入端未提供该键（undefined）时才回退 import.meta.env。
export function getAuthRuntimeConfig(): string | undefined {
  const injected = typeof window !== 'undefined' ? window.__APP_CONFIG__?.AUTH_BACKEND_URL : undefined
  if (injected !== undefined) return injected
  return import.meta.env.VITE_AUTH_BACKEND_URL
}
