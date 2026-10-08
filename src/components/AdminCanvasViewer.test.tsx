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

  it.each([
    { width: 400, height: 200, frameHeight: '100px' },
    { width: 200, height: 400, frameHeight: '400px' },
  ])('他人图片缺少尺寸时按实际 $width × $height 恢复布局，不改变保存的位置和视口', async ({ width, height, frameHeight }) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={project}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'https://cdn.example/other-user.png' } }}
        onBack={vi.fn()}
      />,
    ))
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const frame = node.firstElementChild as HTMLElement
    const image = node.querySelector('img')!
    Object.defineProperties(image, {
      naturalWidth: { value: width },
      naturalHeight: { value: height },
    })

    act(() => image.dispatchEvent(new Event('load')))

    expect(frame.style.height).toBe(frameHeight)
    expect(node.style.left).toBe('120px')
    expect(node.style.top).toBe('-40px')
    expect(node.style.width).toBe('200px')
    expect(host.querySelector<HTMLElement>('.origin-top-left')?.style.transform).toBe('translate(100px, 60px) scale(2)')
  })

  it.each([
    { operator: { crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.25 } }, frameHeight: '50px' },
    { operator: { aspectRatio: 0.5 }, frameHeight: '400px' },
  ])('读取实际尺寸后保留裁剪和分层比例 $frameHeight', async ({ operator, frameHeight }) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer
        project={{ ...project, canvas: { ...project.canvas!, items: { 'image-a': { ...project.canvas!.items['image-a'], rotation: 30, operator } } } }}
        tasks={[task]}
        agentConversations={[]}
        images={{ 'image-a': { dataUrl: 'https://cdn.example/other-user.png' } }}
        onBack={vi.fn()}
      />,
    ))
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const image = node.querySelector('img')!
    Object.defineProperties(image, {
      naturalWidth: { value: 400 },
      naturalHeight: { value: 200 },
    })

    act(() => image.dispatchEvent(new Event('load')))

    expect((node.firstElementChild as HTMLElement).style.height).toBe(frameHeight)
    expect(node.style.transform).toBe('rotate(30deg)')
  })

  it('同一图片标识更换地址后不沿用上一张图片的尺寸', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await act(async () => root.render(
      <AdminCanvasViewer project={project} tasks={[task]} agentConversations={[]} images={{ 'image-a': { dataUrl: 'https://cdn.example/old.png' } }} onBack={vi.fn()} />,
    ))
    const image = host.querySelector<HTMLImageElement>('[data-canvas-node] img')!
    Object.defineProperties(image, {
      naturalWidth: { value: 400 },
      naturalHeight: { value: 200 },
    })
    act(() => image.dispatchEvent(new Event('load')))
    expect((image.parentElement as HTMLElement).style.height).toBe('100px')

    await act(async () => root.render(
      <AdminCanvasViewer project={project} tasks={[task]} agentConversations={[]} images={{ 'image-a': { dataUrl: 'https://cdn.example/new.png', width: 200, height: 400 } }} onBack={vi.fn()} />,
    ))

    expect((host.querySelector('[data-canvas-node]')!.firstElementChild as HTMLElement).style.height).toBe('400px')
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
    const frame = host.querySelector('[data-canvas-node]')!.firstElementChild!
    expect(frame.classList.contains('bg-transparent')).toBe(true)
    expect(frame.classList.contains('bg-white')).toBe(false)
    expect(frame.classList.contains('dark:bg-gray-900')).toBe(false)

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
