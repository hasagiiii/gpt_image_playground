// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type Project, type TaskRecord } from '../types'

vi.mock('../store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    showToast: vi.fn(),
    settings: { canvasWheelMode: 'pan' },
    tasks: [],
  }),
  redownloadTaskImage: vi.fn(),
  retryImage: vi.fn(),
  retryTaskInPlace: vi.fn(),
}))

vi.mock('./CanvasReferenceConnections', () => ({ default: () => null }))
vi.mock('./CanvasControls', () => ({ default: () => null }))
vi.mock('./DetailModal', () => ({ default: () => null }))
vi.mock('./AgentWorkspace', () => ({ default: () => null }))

import AdminCanvasViewer from './AdminCanvasViewer'

const project: Project = {
  id: 'project-a',
  title: '画布 A',
  initialPrompt: '',
  createdAt: 1,
  updatedAt: 1,
  canvas: {
    version: 1,
    viewport: { x: 100, y: 60, scale: 2 },
    items: {
      'image-a': { name: '图片 A', x: 120, y: -40, width: 200, z: 0 },
    },
  },
}

const task: TaskRecord = {
  id: 'task-a',
  projectId: project.id,
  prompt: '测试图片',
  params: { ...DEFAULT_PARAMS, n: 1 },
  inputImageIds: [],
  outputImages: ['image-a'],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'touch' },
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  return event
}

Object.defineProperties(HTMLElement.prototype, {
  setPointerCapture: { configurable: true, value: () => undefined },
  releasePointerCapture: { configurable: true, value: () => undefined },
})

describe('AdminCanvasViewer coordinates', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }

      disconnect() {}
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-project-canvas') ? 800 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-project-canvas') ? 600 : 0
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

  it('默认隐藏坐标，打开后显示中心、图片左上角和原点坐标', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={project}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'data:image/png;base64,AA==', width: 200, height: 100 } }}
        onBack={vi.fn()}
      />,
    ))

    expect(info).toHaveBeenCalledWith('[只读画布] 初始化视口', {
      projectId: 'project-a',
      source: 'project.canvas.viewport',
      viewport: { x: 100, y: 60, scale: 2 },
    })

    expect(host.querySelector('[data-admin-canvas-origin]')).toBeNull()
    expect(host.querySelector('[data-admin-canvas-node-coordinate]')).toBeNull()
    expect(host.querySelector('[data-admin-canvas-center-coordinate]')).toBeNull()

    act(() => host.querySelector<HTMLInputElement>('[aria-label="显示坐标"]')!.click())

    expect(host.querySelector('[data-admin-canvas-origin]')?.textContent).toContain('0, 0')
    expect(host.querySelector('[data-admin-canvas-node-coordinate="image-a"]')?.textContent).toContain('x: 120, y: -40')
    expect(host.querySelector('[data-admin-canvas-center-coordinate]')?.textContent).toContain('中心 x: 150, y: 120')
  })

  it('支持从图片上开始双指缩放只读画布', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={project}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'data:image/png;base64,AA==', width: 200, height: 100 } }}
        onBack={vi.fn()}
      />,
    ))
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 1, 100, 200))
      node.dispatchEvent(pointerEvent('pointerdown', 2, 200, 200))
      node.dispatchEvent(pointerEvent('pointermove', 2, 300, 200))
    })

    expect(host.querySelector<HTMLElement>('.origin-top-left')?.style.transform).toContain('scale(4)')
  })

  it('开启移动模式后无法选中图片，并可从图片位置拖动画布', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={project}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'data:image/png;base64,AA==', width: 200, height: 100 } }}
        onBack={vi.fn()}
      />,
    ))
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const world = host.querySelector<HTMLElement>('.origin-top-left')!
    const moveButton = host.querySelector<HTMLButtonElement>('[aria-label="移动模式"]')!

    expect(moveButton.getAttribute('aria-pressed')).toBe('false')
    act(() => node.click())
    expect(host.querySelector('[data-canvas-toolbar] [aria-label="图片信息"]')).not.toBeNull()

    act(() => moveButton.click())
    expect(moveButton.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-canvas-toolbar] [aria-label="图片信息"]')).toBeNull()
    expect(world.classList.contains('pointer-events-none')).toBe(true)

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 3, 100, 200))
      node.dispatchEvent(pointerEvent('pointermove', 3, 130, 220))
      node.dispatchEvent(pointerEvent('pointerup', 3, 130, 220))
      node.click()
    })

    expect(world.style.transform).toContain('translate(130px, 80px)')
    expect(host.querySelector('[data-canvas-toolbar] [aria-label="图片信息"]')).toBeNull()
  })

  it('从底向上收起并展开竖直工具栏', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={project}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'data:image/png;base64,AA==', width: 200, height: 100 } }}
        onBack={vi.fn()}
      />,
    ))
    const content = host.querySelector<HTMLElement>('[data-canvas-vertical-toolbar-content]')!
    const collapseButton = host.querySelector<HTMLButtonElement>('[aria-label="收起竖直工具栏"]')!
    const moveButton = host.querySelector<HTMLButtonElement>('[aria-label="移动模式"]')!

    expect(content.nextElementSibling).toBe(collapseButton)
    expect(content.classList.contains('max-h-9')).toBe(true)
    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')

    act(() => collapseButton.click())
    expect(content.classList.contains('max-h-0')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('true')
    expect(moveButton.tabIndex).toBe(-1)

    const expandButton = host.querySelector<HTMLButtonElement>('[aria-label="展开竖直工具栏"]')!
    act(() => expandButton.click())
    expect(content.classList.contains('max-h-9')).toBe(true)
    expect(content.getAttribute('aria-hidden')).toBe('false')
  })
})
