import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRuntimeConfig, getAuthRuntimeConfig } from './runtimeEnv'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getRuntimeConfig', () => {
  it('优先返回 window.__APP_CONFIG__ 注入值', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: { DEFAULT_API_URL: 'https://injected.example/v1' } })
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://env.example/v1')
    expect(getRuntimeConfig('DEFAULT_API_URL')).toBe('https://injected.example/v1')
  })

  it('注入缺失时回退 import.meta.env', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: {} })
    vi.stubEnv('VITE_DEFAULT_API_URL', 'https://env.example/v1')
    expect(getRuntimeConfig('DEFAULT_API_URL')).toBe('https://env.example/v1')
  })

  it('trim 首尾空白', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: { DEFAULT_API_URL: '  https://x/v1  ' } })
    expect(getRuntimeConfig('DEFAULT_API_URL')).toBe('https://x/v1')
  })

  it('注入与 env 均缺失时返回空串', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: {} })
    vi.stubEnv('VITE_DEFAULT_API_URL', undefined)
    expect(getRuntimeConfig('DEFAULT_API_URL')).toBe('')
  })
})

describe('getAuthRuntimeConfig 三态', () => {
  it('注入为 undefined 时回退 env（仍 undefined）', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: {} })
    vi.stubEnv('VITE_AUTH_BACKEND_URL', undefined)
    expect(getAuthRuntimeConfig()).toBeUndefined()
  })

  it('注入为空串时保留空串（同源），不归一为 undefined', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: { AUTH_BACKEND_URL: '' } })
    expect(getAuthRuntimeConfig()).toBe('')
  })

  it('注入为 disabled 时原样返回', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: { AUTH_BACKEND_URL: 'disabled' } })
    expect(getAuthRuntimeConfig()).toBe('disabled')
  })

  it('注入 URL 时原样返回', () => {
    vi.stubGlobal('window', { __APP_CONFIG__: { AUTH_BACKEND_URL: 'https://api.example.com' } })
    expect(getAuthRuntimeConfig()).toBe('https://api.example.com')
  })
})
