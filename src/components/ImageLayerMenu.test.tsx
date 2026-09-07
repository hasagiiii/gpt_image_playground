// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'
import { SEEDREAM_LAYER_MODEL } from '../lib/seedreamLayers'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  decomposeImage: vi.fn(async (..._args: unknown[]) => undefined),
  showToast: vi.fn(),
  estimate: vi.fn(),
}))
vi.mock('../store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
  decomposeImage: mocks.decomposeImage,
}))
vi.mock('../auth/oidcResource', () => ({ estimateModelPricing: mocks.estimate }))

import ImageLayerMenu from './ImageLayerMenu'

const task: TaskRecord = { id: 'source', prompt: '原图', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: ['image-a'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 }

describe('图片分层二级菜单', () => {
  let host: HTMLDivElement
  let root: Root
  const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="分层"]')!
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!
  const customItem = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((el) => el.textContent === '自定义分层')!

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.estimate.mockResolvedValue({ estimated_price: 0.123456 })
    mocks.state = { settings: DEFAULT_SETTINGS, oidcApiOverride: { apiKey: 'selected-key', model: 'other-model' }, showToast: mocks.showToast }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(<ImageLayerMenu task={task} imageId="image-a" disabled={false} className="" />))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })

  it('hover 展开二级菜单，顶部展示当前 Key 对应的实时预估价格', async () => {
    await act(async () => trigger().dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    expect(menu()).not.toBeNull()
    expect(customItem()).not.toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(menu().querySelector('[role="status"]')?.textContent).toBe('≈ $0.123456')
    expect(mocks.estimate).toHaveBeenCalledWith('selected-key', SEEDREAM_LAYER_MODEL, expect.objectContaining({ layer_decomposition: true, size: 'auto', output_format: 'png' }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(mocks.decomposeImage).not.toHaveBeenCalled()
  })

  it('鼠标从触发器移入弹出层时保持打开，离开后关闭', async () => {
    await act(async () => trigger().click())
    await act(async () => trigger().dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
    await act(async () => menu().dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(menu()).not.toBeNull()
    await act(async () => menu().dispatchEvent(new MouseEvent('pointerout', { bubbles: true })))
    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(menu()).toBeNull()
  })

  it('仅展示自定义分层，点击直接调用现有 Seedream 分层，无需输入指令', async () => {
    await act(async () => trigger().click())
    expect(menu().querySelectorAll('[role="menuitem"]')).toHaveLength(1)
    await act(async () => customItem().click())
    expect(mocks.decomposeImage).toHaveBeenCalledExactlyOnceWith(task, 'image-a')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(menu()).toBeNull()
  })

  it.each([{}, { estimated_price: null }, { estimated_price: -1 }])('缺少有效报价时不显示为免费：%j', async (result) => {
    mocks.estimate.mockResolvedValueOnce(result)
    await act(async () => trigger().click())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(menu().textContent).toContain('预估不可用')
  })

  it('价格接口失败不阻止自定义分层，Escape 和外部点击关闭菜单', async () => {
    mocks.estimate.mockRejectedValueOnce(new Error('unavailable'))
    await act(async () => trigger().click())
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(menu().textContent).toContain('预估不可用')
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(menu()).toBeNull()
    await act(async () => trigger().click())
    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
    expect(menu()).toBeNull()
    await act(async () => trigger().click())
    await act(async () => menu().querySelector<HTMLButtonElement>('button')!.click())
    expect(mocks.decomposeImage).toHaveBeenCalledWith(task, 'image-a')
  })

  it('分层进行中禁用提交入口', async () => {
    await act(async () => root.render(<ImageLayerMenu task={task} imageId="image-a" disabled className="" />))
    await act(async () => trigger().click())
    expect([...menu().querySelectorAll('button')].every((button) => button.disabled)).toBe(true)
    expect(mocks.decomposeImage).not.toHaveBeenCalled()
  })
})
