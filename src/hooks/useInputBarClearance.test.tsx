// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInputBarClearance } from './useInputBarClearance'

function InputBar({ mode }: { mode: 'agent' | 'params' }) {
  const ref = useRef<HTMLDivElement>(null)
  useInputBarClearance(ref, mode)
  return <div data-input-bar data-input-mode={mode}><div ref={ref} /></div>
}

describe('useInputBarClearance', () => {
  let host: HTMLDivElement
  let root: Root
  let heights: { agent: number; params: number }
  let observers: Map<Element, () => void>

  beforeEach(() => {
    heights = { agent: 280, params: 120 }
    observers = new Map()
    vi.stubGlobal('innerHeight', 800)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', class {
      private el?: Element
      constructor(private callback: () => void) {}
      observe(el: Element) {
        this.el = el
        observers.set(el, this.callback)
      }
      disconnect() {
        if (this.el) observers.delete(this.el)
      }
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = heights[this.dataset.inputMode as keyof typeof heights] ?? 0
      return { top: height > 0 ? window.innerHeight - height - 12 : 0, height } as DOMRect
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('参数栏收起或卸载不会覆盖 Agent 的底部留白', () => {
    act(() => root.render(<><InputBar key="agent" mode="agent" /><InputBar key="params" mode="params" /></>))
    const style = document.documentElement.style
    expect(style.getPropertyValue('--agent-input-bar-clearance')).toBe('292px')
    expect(style.getPropertyValue('--input-bar-clearance')).toBe('132px')

    heights.params = 38
    act(() => observers.get(host.querySelector('[data-input-mode="params"]')!)!())
    expect(style.getPropertyValue('--input-bar-clearance')).toBe('50px')
    expect(style.getPropertyValue('--agent-input-bar-clearance')).toBe('292px')

    act(() => root.render(<><InputBar key="agent" mode="agent" /></>))
    expect(style.getPropertyValue('--input-bar-clearance')).toBe('')
    expect(style.getPropertyValue('--agent-input-bar-clearance')).toBe('292px')
  })

  it('聊天输入框变高时更新留白，响应窗口尺寸变化', () => {
    act(() => root.render(<InputBar mode="agent" />))
    heights.agent = 420
    act(() => observers.get(host.querySelector('[data-input-bar]')!)!())
    expect(document.documentElement.style.getPropertyValue('--agent-input-bar-clearance')).toBe('432px')

    heights.agent = 200
    act(() => window.dispatchEvent(new Event('resize')))
    expect(document.documentElement.style.getPropertyValue('--agent-input-bar-clearance')).toBe('212px')
  })

  it('隐藏输入框不保留整个屏幕的空白，切换模式时清理旧变量', () => {
    heights.agent = 0
    act(() => root.render(<InputBar mode="agent" />))
    expect(document.documentElement.style.getPropertyValue('--agent-input-bar-clearance')).toBe('0px')
    act(() => root.render(<InputBar mode="params" />))
    expect(document.documentElement.style.getPropertyValue('--agent-input-bar-clearance')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--input-bar-clearance')).toBe('132px')
  })
})
