// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CanvasControls, { type CanvasControlLayer } from './CanvasControls'

const layers: CanvasControlLayer[] = [{
  id: 'image-a',
  label: '图片 1',
  status: 'done',
  x: 0,
  y: 0,
  width: 512,
  height: 512,
  z: 1,
  createdAt: Date.parse('2026-09-03T10:20:00+08:00'),
  elapsed: 95_000,
  thumbnailSrc: 'data:image/png;base64,AAECAw==',
}]

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  return event
}

Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => undefined })

describe('CanvasControls', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  const renderControls = async (onRenameLayer?: (id: string, name: string) => boolean, readOnly = false) => {
    await act(async () => root.render(
      <CanvasControls
        viewport={{ x: 0, y: 0, scale: 1 }}
        containerSize={{ width: 1000, height: 700 }}
        layers={layers}
        selectedLayerId={null}
        canvasWheelMode="pan"
        agentPanelCollapsed
        readOnly={readOnly}
        onViewportChange={vi.fn()}
        onFocusLayer={vi.fn()}
        onRenameLayer={onRenameLayer}
      />,
    ))
  }

  it('在不被折叠容器裁剪的位置显示快速缩放比例', async () => {
    await renderControls()

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="选择画布缩放比例"]')!.click())

    const preset = host.querySelector<HTMLElement>('[data-canvas-zoom-preset]')!
    const content = host.querySelector<HTMLElement>('[data-canvas-controls-content]')!
    expect(Array.from(preset.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['50%', '100%', '200%'])
    expect(content.contains(preset)).toBe(false)
    expect(content.className).toContain('overflow-visible')
  })

  it('正常画布可以从图层改名', async () => {
    await renderControls(vi.fn(() => true))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!.click())

    const layer = host.querySelector<HTMLButtonElement>('[data-canvas-layers-panel] button')!
    act(() => layer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))

    expect(host.querySelector('[aria-label="图层名称"]')).not.toBeNull()
  })

  it('只读画布不能从图层改名', async () => {
    await renderControls(vi.fn(() => true), true)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!.click())

    const layer = host.querySelector<HTMLButtonElement>('[data-canvas-layers-panel] button')!
    act(() => layer.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))

    expect(host.querySelector('[aria-label="图层名称"]')).toBeNull()
  })

  it('图层列表展示缩略图、创建时间与耗时', async () => {
    await renderControls()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!.click())

    const panel = host.querySelector<HTMLElement>('[data-canvas-layers-panel]')!
    expect(panel.querySelector('img')?.getAttribute('src')).toBe(layers[0].thumbnailSrc)
    expect(panel.textContent).toContain('01:35')
    expect(panel.textContent).toMatch(/09\/03|09-03/)
  })

  it('图层列表按创建时间从晚到早排序', async () => {
    const older = { ...layers[0], id: 'image-older', label: '较早图片', z: 99 }
    const newer = { ...layers[0], id: 'image-newer', label: '较晚图片', z: 1, createdAt: layers[0].createdAt! + 1000 }
    await act(async () => root.render(
      <CanvasControls
        viewport={{ x: 0, y: 0, scale: 1 }}
        containerSize={{ width: 1000, height: 700 }}
        layers={[older, newer]}
        selectedLayerId={null}
        canvasWheelMode="pan"
        agentPanelCollapsed
        onViewportChange={vi.fn()}
        onFocusLayer={vi.fn()}
      />,
    ))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!.click())

    const buttons = host.querySelectorAll<HTMLButtonElement>('[data-canvas-layers-panel] button')
    expect(buttons[0].textContent).toContain('较晚图片')
    expect(buttons[1].textContent).toContain('较早图片')
  })

  it('点击阻止事件冒泡的画布图片时关闭图层面板', async () => {
    await renderControls()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!.click())
    expect(host.querySelector('[data-canvas-layers-panel]')).not.toBeNull()

    const image = document.createElement('button')
    image.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.body.appendChild(image)
    act(() => image.dispatchEvent(new Event('pointerdown', { bubbles: true })))

    expect(host.querySelector('[data-canvas-layers-panel]')).toBeNull()
    image.remove()
  })

  it('点击小地图外部时关闭小地图，点击内部时保持打开', async () => {
    await renderControls()
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="小地图"]')!.click())
    const minimap = host.querySelector<HTMLElement>('[data-canvas-minimap]')!

    act(() => minimap.dispatchEvent(new Event('pointerdown', { bubbles: true })))
    expect(host.querySelector('[data-canvas-minimap]')).not.toBeNull()

    const outside = document.createElement('button')
    outside.addEventListener('pointerdown', (event) => event.stopPropagation())
    document.body.appendChild(outside)
    act(() => outside.dispatchEvent(new Event('pointerdown', { bubbles: true })))

    expect(host.querySelector('[data-canvas-minimap]')).toBeNull()
    outside.remove()
  })

  it('点击小地图图片块会跳转，并保留键盘点击支持', async () => {
    const onFocusLayer = vi.fn()
    const onViewportChange = vi.fn()
    await act(async () => root.render(
      <CanvasControls
        viewport={{ x: 0, y: 0, scale: 1 }}
        containerSize={{ width: 1000, height: 700 }}
        layers={layers}
        selectedLayerId={null}
        canvasWheelMode="pan"
        agentPanelCollapsed
        onViewportChange={onViewportChange}
        onFocusLayer={onFocusLayer}
      />,
    ))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="小地图"]')!.click())
    const minimap = host.querySelector<HTMLElement>('[data-canvas-minimap]')!
    const image = host.querySelector<HTMLButtonElement>('[aria-label="跳转到图片 1"]')!
    const capture = vi.spyOn(image, 'setPointerCapture')
    const mapCapture = vi.spyOn(minimap, 'setPointerCapture')

    act(() => {
      image.dispatchEvent(pointerEvent('pointerdown', 1, 100, 72))
      image.dispatchEvent(pointerEvent('pointerup', 1, 100, 72))
      image.click()
    })

    // jsdom 不模拟指针捕获，单独检查捕获对象以覆盖点击被重定向的回归。
    expect(capture).toHaveBeenCalledWith(1)
    expect(mapCapture).not.toHaveBeenCalled()
    expect(onFocusLayer).toHaveBeenCalledExactlyOnceWith('image-a')
    expect(onViewportChange).not.toHaveBeenCalled()
    act(() => image.click())
    expect(onFocusLayer).toHaveBeenCalledTimes(2)
  })

  it('可以从小地图图片块开始拖动画布视口，结束时不会触发跳转', async () => {
    const onViewportChange = vi.fn()
    const onFocusLayer = vi.fn()
    await act(async () => root.render(
      <CanvasControls
        viewport={{ x: 0, y: 0, scale: 1 }}
        containerSize={{ width: 1000, height: 700 }}
        layers={layers}
        selectedLayerId={null}
        canvasWheelMode="pan"
        agentPanelCollapsed
        onViewportChange={onViewportChange}
        onFocusLayer={onFocusLayer}
      />,
    ))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="小地图"]')!.click())
    const minimap = host.querySelector<HTMLElement>('[data-canvas-minimap]')!
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 144 } as DOMRect)
    const image = host.querySelector<HTMLButtonElement>('[aria-label="跳转到图片 1"]')!

    act(() => {
      image.dispatchEvent(pointerEvent('pointerdown', 1, 100, 72))
      image.dispatchEvent(pointerEvent('pointermove', 1, 124, 72))
      image.dispatchEvent(pointerEvent('pointerup', 1, 124, 72))
      image.click()
    })

    expect(onViewportChange).toHaveBeenCalled()
    expect(onViewportChange.mock.lastCall?.[0].x).toBeCloseTo(-63.2)
    expect(onViewportChange.mock.lastCall?.[0].y).toBe(0)
    expect(onFocusLayer).not.toHaveBeenCalled()
  })

  it('点击小地图空白位置会将对应坐标移动到画面中心', async () => {
    const onViewportChange = vi.fn()
    await act(async () => root.render(
      <CanvasControls
        viewport={{ x: 0, y: 0, scale: 1 }}
        containerSize={{ width: 1000, height: 700 }}
        layers={layers}
        selectedLayerId={null}
        canvasWheelMode="pan"
        agentPanelCollapsed
        onViewportChange={onViewportChange}
        onFocusLayer={vi.fn()}
      />,
    ))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="小地图"]')!.click())
    const minimap = host.querySelector<HTMLElement>('[data-canvas-minimap]')!
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 240, height: 144 } as DOMRect)

    act(() => {
      minimap.dispatchEvent(pointerEvent('pointerdown', 2, 180, 72))
      minimap.dispatchEvent(pointerEvent('pointerup', 2, 180, 72))
    })

    expect(onViewportChange).toHaveBeenCalledWith(expect.objectContaining({ x: 86, y: 94, scale: 1 }))
  })
})
