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
})
