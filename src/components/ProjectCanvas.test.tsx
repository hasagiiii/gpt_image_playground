// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type Project, type ProjectCanvasState, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from '../lib/apiProfiles'

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  thumbnailSubscribers: new Map<string, (thumbnail: { dataUrl: string; width: number; height: number }) => void>(),
  updateProjectCanvas: vi.fn(),
  updateProjectCanvasViewport: vi.fn(),
  clearProjectImageRedoHistory: vi.fn(),
  undoProjectImageHistory: vi.fn(async () => true),
  redoProjectImageHistory: vi.fn(async () => true),
  openImageFavoritePicker: vi.fn(),
  setDetailImage: vi.fn(),
  setLightboxImageId: vi.fn(),
  setSelectedTaskIds: vi.fn(),
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  decomposeImage: vi.fn(async () => undefined),
}))

vi.mock('../store', () => ({
  ALL_FAVORITES_COLLECTION_ID: '__all_favorites__',
  ALL_PROJECTS_ID: '__all_projects__',
  LOCAL_PROJECT_ID: '__local_project__',
  useStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state.current),
    { getState: () => mocks.state.current },
  ),
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,AA=='),
  ensureImageThumbnailCached: vi.fn(async () => null),
  subscribeImageThumbnail: vi.fn((imageId: string, callback: (thumbnail: { dataUrl: string; width: number; height: number }) => void) => {
    mocks.thumbnailSubscribers.set(imageId, callback)
    return () => mocks.thumbnailSubscribers.delete(imageId)
  }),
  getImageFavoriteCollectionIds: (imageId: string, task: TaskRecord) => {
    const projects = mocks.state.current.projects as Project[]
    return projects.find((project) => project.id === task.projectId)?.canvas?.items[imageId]?.favoriteCollectionIds ?? []
  },
  editOutputImage: vi.fn(),
  decomposeImage: mocks.decomposeImage,
  removeOutputImage: vi.fn(),
  removeMultipleOutputImages: vi.fn(),
  reuseImageConfig: vi.fn(),
  retryImage: vi.fn(),
  taskMatchesFilterStatus: (task: TaskRecord, status: string) => status === 'all' || task.status === status,
  taskMatchesSearchQuery: (task: TaskRecord, query: string) => !query || task.prompt.toLowerCase().includes(query),
}))

vi.mock('../lib/clipboard', () => ({
  copyImageSourceToClipboard: vi.fn(),
  getClipboardFailureMessage: (message: string) => message,
}))

vi.mock('../lib/downloadImages', () => ({
  downloadImageIds: vi.fn(async () => ({ successCount: 1, failCount: 0 })),
  exportImage: vi.fn(async () => undefined),
}))

vi.mock('../lib/materialApi', () => ({
  uploadMaterialImage: vi.fn(),
}))

import ProjectCanvas from './ProjectCanvas'

function createTask(): TaskRecord {
  return {
    id: 'task-a',
    projectId: 'project-a',
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
}

function createProject(): Project {
  return {
    id: 'project-a',
    title: '测试项目',
    initialPrompt: '',
    storage: 'local',
    createdAt: 1,
    updatedAt: 1,
    canvas: {
      version: 1,
      viewport: { x: 32, y: 32, scale: 1 },
      items: {
        'image-a': { x: 0, y: 0, width: 240, z: 0, favoriteCollectionIds: [] },
      },
    },
  }
}

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number, modifiers: { ctrlKey?: boolean; metaKey?: boolean; movementX?: number; movementY?: number; screenX?: number; screenY?: number } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
    ctrlKey: { value: Boolean(modifiers.ctrlKey) },
    metaKey: { value: Boolean(modifiers.metaKey) },
  })
  if (modifiers.movementX !== undefined) Object.defineProperty(event, 'movementX', { value: modifiers.movementX })
  if (modifiers.movementY !== undefined) Object.defineProperty(event, 'movementY', { value: modifiers.movementY })
  if (modifiers.screenX !== undefined) Object.defineProperty(event, 'screenX', { value: modifiers.screenX })
  if (modifiers.screenY !== undefined) Object.defineProperty(event, 'screenY', { value: modifiers.screenY })
  return event
}

describe('ProjectCanvas interactions', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.thumbnailSubscribers.clear()
    mocks.state.current = {
      tasks: [createTask()],
      settings: DEFAULT_SETTINGS,
      projects: [createProject()],
      activeProjectId: 'project-a',
      projectsLoaded: true,
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      activeFavoriteCollectionId: null,
      agentPanelCollapsed: false,
      streamPreviewSlots: {},
      projectCanvasCache: {},
      selectedTaskIds: [],
      updateProjectCanvas: mocks.updateProjectCanvas,
      updateProjectCanvasViewport: mocks.updateProjectCanvasViewport,
      clearProjectImageRedoHistory: mocks.clearProjectImageRedoHistory,
      undoProjectImageHistory: mocks.undoProjectImageHistory,
      redoProjectImageHistory: mocks.redoProjectImageHistory,
      setDetailImage: mocks.setDetailImage,
      setLightboxImageId: mocks.setLightboxImageId,
      setSelectedTaskIds: mocks.setSelectedTaskIds,
      openImageFavoritePicker: mocks.openImageFavoritePicker,
      setConfirmDialog: mocks.setConfirmDialog,
      showToast: mocks.showToast,
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(<ProjectCanvas />))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('selects one image, runs its toolbar action, and clears selection on blank space', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!

    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    const favoriteButton = host.querySelector<HTMLButtonElement>('[aria-label="收藏"]')
    expect(favoriteButton).not.toBeNull()
    act(() => favoriteButton!.click())
    expect(mocks.openImageFavoritePicker).toHaveBeenCalledWith(['image-a'])

    act(() => canvas.dispatchEvent(pointerEvent('pointerdown', 2, 700, 500)))
    expect(host.querySelector('[aria-label="收藏"]')).toBeNull()
  })

  it('图片外框不填充底色，保留透明区域和下层图片', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const frame = node.firstElementChild!
    expect(frame.classList.contains('bg-transparent')).toBe(true)
    expect(frame.classList.contains('bg-white')).toBe(false)
    expect(frame.classList.contains('dark:bg-gray-900')).toBe(false)
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    expect(frame.classList.contains('bg-transparent')).toBe(true)
  })

  it('旧分层任务按 absolute 拼合，选择基准图时不遮盖上层', async () => {
    const task = { ...createTask(), outputImages: ['image-a', 'image-b'], layerDecomposition: true, imageLayers: [
      { url: 'https://files.test/a.png', size: '2000x2240', z_index: 0 },
      { url: 'https://files.test/b.png', size: '1534x1732', z_index: 1, bounding_box: { absolute: [45, 1453, 728, 2223] } },
    ] }
    mocks.state.current = { ...mocks.state.current, tasks: [task] }
    await act(async () => root.render(<ProjectCanvas />))
    const base = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const layer = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    expect(parseFloat(layer.style.left)).toBeCloseTo(45 * 240 / 2000)
    expect(parseFloat(layer.style.top)).toBeCloseTo(1453 * 240 / 2000)
    expect(parseFloat(layer.style.width)).toBeCloseTo(683 * 240 / 2000)
    expect(parseFloat((layer.firstElementChild as HTMLElement).style.height)).toBeCloseTo(770 * 240 / 2000)
    act(() => base.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    expect(Number(base.style.zIndex)).toBeLessThan(Number(layer.style.zIndex))
    expect(mocks.updateProjectCanvas).toHaveBeenCalledWith('project-a', expect.objectContaining({ items: expect.objectContaining({ 'image-b': expect.objectContaining({ operator: expect.objectContaining({ aspectRatio: 683 / 770 }) }) }) }))
  })

  it('在裁剪右侧显示分层菜单，展开后可提交当前图片', async () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    const crop = host.querySelector<HTMLButtonElement>('[aria-label="裁剪图片"]')!
    const layer = host.querySelector<HTMLButtonElement>('[aria-label="分层"]')!
    expect(crop.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await act(async () => layer.click())
    expect(mocks.decomposeImage).not.toHaveBeenCalled()
    const auto = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    await act(async () => auto.click())
    expect(mocks.decomposeImage).toHaveBeenCalledWith(createTask(), 'image-a')
  })

  it('uses the left toolbar to toggle pure canvas movement', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const world = node.parentElement!
    const moveButton = host.querySelector<HTMLButtonElement>('[aria-label="移动模式"]')!

    expect(moveButton.getAttribute('aria-pressed')).toBe('false')
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    expect(host.querySelector('[aria-label="收藏"]')).not.toBeNull()

    act(() => moveButton.click())
    expect(moveButton.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-label="收藏"]')).toBeNull()
    expect(world.classList.contains('pointer-events-none')).toBe(true)
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 2, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 2, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 2, 120, 100))
    })

    expect(node.style.left).toBe('0px')
    expect(node.style.top).toBe('0px')
    expect(world.style.transform).toContain('translate(72px, 52px)')
    expect(host.querySelector('[aria-label="收藏"]')).toBeNull()
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('使用配置的快捷键切换移动模式', () => {
    const moveButton = host.querySelector<HTMLButtonElement>('[aria-label="移动模式"]')!
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true })))
    expect(moveButton.getAttribute('aria-pressed')).toBe('true')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true })))
    expect(moveButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('从底向上收起并展开竖直工具栏', () => {
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

  it('shows development origin and image world coordinates', () => {
    expect(host.querySelector('[data-canvas-origin]')).not.toBeNull()
    const position = host.querySelector<HTMLElement>('[data-canvas-debug-position]')
    expect(position?.textContent).toBe('x: 0, y: 0')
  })

  it('does not persist when clicking blank canvas without moving it', () => {
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', 1, 700, 500))
      canvas.dispatchEvent(pointerEvent('pointerup', 1, 700, 500))
    })

    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('does not persist when clicking an image without moving it', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80))
      node.dispatchEvent(pointerEvent('pointerup', 1, 80, 80))
    })

    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('renames an image by double-clicking its name', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    const name = host.querySelector<HTMLElement>('[data-canvas-image-name]')!
    act(() => name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })))

    const input = host.querySelector<HTMLInputElement>('[data-canvas-image-name]')!
    expect(input.value).toBe('图片 1')
  })

  it('resets the viewport to the canvas origin', () => {
    const resetButton = host.querySelector<HTMLButtonElement>('[aria-label="回到画布原点"]')!
    mocks.updateProjectCanvas.mockClear()

    act(() => resetButton.click())

    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('resets only the viewport position without changing zoom', async () => {
    const project = createProject()
    project.canvas!.viewport.scale = 2
    mocks.state.current = { ...mocks.state.current, projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const resetButton = host.querySelector<HTMLButtonElement>('[aria-label="回到画布原点"]')!
    expect(host.querySelector('[aria-label="选择画布缩放比例"]')?.textContent).toBe('200%')

    act(() => resetButton.click())

    expect(host.querySelector('[aria-label="选择画布缩放比例"]')?.textContent).toBe('200%')
  })

  it('raises the selected node until it is deselected and keeps the zoom controls visible', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    expect(node.style.zIndex).toBe('0')
    expect(host.querySelector('[data-canvas-zoom-controls]')).not.toBeNull()

    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))
    expect(node.style.zIndex).toBe('1000')

    act(() => node.dispatchEvent(pointerEvent('pointerup', 1, 80, 80)))
    expect(node.style.zIndex).toBe('1000')

    act(() => canvas.dispatchEvent(pointerEvent('pointerdown', 2, 700, 500)))
    expect(node.style.zIndex).toBe('0')
  })

  it('keeps selection handles screen-sized and outside the image when zoomed', async () => {
    const project = createProject()
    project.canvas!.viewport.scale = 2
    mocks.state.current = { ...mocks.state.current, projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80)))

    const nw = host.querySelector<HTMLButtonElement>('[aria-label="调整图片nw"]')!
    const rotateButtons = host.querySelectorAll<HTMLButtonElement>('[data-canvas-rotation-corner]')
    const rotate = host.querySelector<HTMLButtonElement>('[data-canvas-rotation-corner="ne"]')!
    expect(nw.style.transform).toBe('scale(0.5)')
    expect(nw.style.left).toBe('-5px')
    expect(nw.style.top).toBe('-5px')
    expect(rotate.style.transform).toBe('scale(0.5)')
    expect(rotateButtons).toHaveLength(4)
    expect(rotate.className).toContain('right-[-52px]')
    expect(rotate.className).toContain('top-[-52px]')
  })

  it('centers the first generated image on the world origin', async () => {
    const project = { ...createProject(), id: 'project-b', canvas: undefined }
    const task = { ...createTask(), projectId: 'project-b' }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [task], activeProjectId: 'project-b', projectsLoaded: true }
    mocks.updateProjectCanvas.mockClear()
    await act(async () => root.render(<ProjectCanvas />))

    expect(mocks.updateProjectCanvas).toHaveBeenCalledWith('project-b', expect.objectContaining({
      viewport: { x: 400, y: 300, scale: 1 },
      items: { 'image-a': expect.objectContaining({ x: -120, y: -120, width: 240 }) },
    }))
  })

  it('centers the generating placeholder on the world origin', async () => {
    const project = { ...createProject(), canvas: undefined }
    const task = { ...createTask(), outputImages: [], status: 'running' as const }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [task], activeProjectId: 'project-a', projectsLoaded: true }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    expect(node.style.left).toBe('-512px')
    expect(node.style.top).toBe('-512px')
    expect(node.style.width).toBe('1024px')
  })

  it('shows one generating placeholder when multiple outputs are requested', async () => {
    const project = { ...createProject(), canvas: undefined }
    const task = { ...createTask(), outputImages: [], status: 'running' as const, params: { ...DEFAULT_PARAMS, n: 4 } }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [task], activeProjectId: 'project-a', projectsLoaded: true }
    await act(async () => root.render(<ProjectCanvas />))

    expect(host.querySelectorAll('[data-canvas-node]')).toHaveLength(1)
  })

  it('allows the generating placeholder to move without persisting a canvas patch', async () => {
    const project = { ...createProject(), canvas: undefined }
    const task = { ...createTask(), outputImages: [], status: 'running' as const }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [task], activeProjectId: 'project-a', projectsLoaded: true }
    mocks.updateProjectCanvas.mockClear()
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const initialPosition = { left: node.style.left, top: node.style.top }
    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 7, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 7, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 7, 120, 100))
    })

    expect(Number.parseFloat(node.style.left)).toBeCloseTo(-414.4762, 3)
    expect(Number.parseFloat(node.style.top)).toBeCloseTo(-463.2381, 3)
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))
    expect({ left: node.style.left, top: node.style.top }).toEqual(initialPosition)
    expect(mocks.undoProjectImageHistory).not.toHaveBeenCalled()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(Number.parseFloat(node.style.left)).toBeCloseTo(-414.4762, 3)
    expect(Number.parseFloat(node.style.top)).toBeCloseTo(-463.2381, 3)
  })

  it('分层完成后在占位符位置拼合图层，不覆盖被分层原图', async () => {
    const project = createProject()
    project.canvas!.items['image-a'] = { ...project.canvas!.items['image-a'], width: 659 }
    const sourceTask = createTask()
    const runningTask: TaskRecord = {
      ...createTask(),
      id: 'layer-task',
      inputImageIds: ['image-a'],
      outputImages: [],
      layerDecomposition: true,
      status: 'running',
      finishedAt: null,
      elapsed: null,
    }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [sourceTask, runningTask] }
    await act(async () => root.render(<ProjectCanvas />))

    const placeholder = host.querySelector<HTMLElement>('[data-node-key="layer-task:running:0"]')!
    act(() => {
      placeholder.dispatchEvent(pointerEvent('pointerdown', 17, 400, 300))
      placeholder.dispatchEvent(pointerEvent('pointermove', 17, 520, 380))
      placeholder.dispatchEvent(pointerEvent('pointerup', 17, 520, 380))
    })
    const placeholderX = Number.parseFloat(placeholder.style.left)
    const placeholderY = Number.parseFloat(placeholder.style.top)

    mocks.updateProjectCanvas.mockClear()
    mocks.updateProjectCanvas.mockImplementationOnce((projectId: string, canvas: ProjectCanvasState) => {
      mocks.state.current = {
        ...mocks.state.current,
        projectCanvasCache: { ...(mocks.state.current.projectCanvasCache as Record<string, ProjectCanvasState>), [projectId]: canvas },
      }
    })
    mocks.state.current = {
      ...mocks.state.current,
      tasks: [sourceTask, {
        ...runningTask,
        outputImages: ['layer-a', 'layer-b'],
        imageLayers: [
          { url: 'https://files.test/layer-a.png', size: '2000x2240', z_index: 0 },
          { url: 'https://files.test/layer-b.png', size: '1000x1000', z_index: 1, bounding_box: { absolute: [500, 600, 1500, 1600] } },
        ],
        status: 'done' as const,
        finishedAt: 3,
        elapsed: 2,
      }],
    }
    await act(async () => root.render(<ProjectCanvas />))

    const base = host.querySelector<HTMLElement>('[data-node-key="layer-a"]')!
    const layer = host.querySelector<HTMLElement>('[data-node-key="layer-b"]')!
    expect(Number.parseFloat(base.style.left)).toBeCloseTo(placeholderX)
    expect(Number.parseFloat(base.style.top)).toBeCloseTo(placeholderY)
    expect(Number.parseFloat(base.style.left)).not.toBe(0)
    expect(Number.parseFloat(base.style.width)).toBeCloseTo(659)
    expect(Number.parseFloat(layer.style.left)).toBeCloseTo(placeholderX + 500 * 659 / 2000)
    expect(Number.parseFloat(layer.style.top)).toBeCloseTo(placeholderY + 600 * 659 / 2000)
  })

  it('生成完成后不会先撤销占位符移动', async () => {
    const project = { ...createProject(), canvas: undefined }
    const runningTask = { ...createTask(), outputImages: [], status: 'running' as const, finishedAt: null, elapsed: null }
    mocks.state.current = { ...mocks.state.current, projects: [project], tasks: [runningTask], activeProjectId: 'project-a' }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 11, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 11, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 11, 120, 100))
    })

    mocks.undoProjectImageHistory.mockClear()
    mocks.state.current = {
      ...mocks.state.current,
      tasks: [{ ...runningTask, outputImages: ['image-b'], status: 'done' as const, finishedAt: 3, elapsed: 2 }],
    }
    await act(async () => root.render(<ProjectCanvas />))
    mocks.updateProjectCanvas.mockClear()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect(mocks.undoProjectImageHistory).toHaveBeenCalledWith('project-a')
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('拖拽图片到画布边缘时自动移动画布并保持图片跟随指针', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    })
    const world = node.parentElement!
    const initialTransform = world.style.transform
    let frameCount = 0
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCount += 1
      if (frameCount === 1) callback(16)
      return 1
    })

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 8, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 8, 800, 300))
      node.dispatchEvent(pointerEvent('pointerup', 8, 800, 300))
    })

    expect(requestAnimationFrame).toHaveBeenCalled()
    expect(world.style.transform).not.toBe(initialTransform)
    const initialX = Number(initialTransform.match(/translate\(([-\d.]+)px/)?.[1])
    const nextX = Number(world.style.transform.match(/translate\(([-\d.]+)px/)?.[1])
    expect(nextX).toBeLessThan(initialX)
    requestAnimationFrame.mockRestore()
  })

  it('鼠标离开图片但仍在画布内时不会结束拖拽', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 13, 80, 80))
      node.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, relatedTarget: canvas }))
      node.dispatchEvent(pointerEvent('pointermove', 13, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 13, 120, 100))
    })

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 40, y: 20 }),
      }),
    }))
  })

  it('拖拽离开图片后由画布继续接收移动事件', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 14, 80, 80))
      canvas.dispatchEvent(pointerEvent('pointermove', 14, 120, 100))
      canvas.dispatchEvent(pointerEvent('pointerup', 14, 120, 100))
    })

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 40, y: 20 }),
      }),
    }))
  })

  it('自动移动速度随越过画布边缘的持续时间增加并限制最大速度', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 5000 })
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    })
    const world = node.parentElement!
    const getWorldX = () => Number(world.style.transform.match(/translate\(([-\d.]+)px/)?.[1])
    const initialX = getWorldX()
    const callbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const runFrame = (time: number) => {
      const callback = callbacks.shift()
      expect(callback).toBeDefined()
      act(() => callback?.(time))
    }

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 9, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 9, 800, 300))
    })
    runFrame(16)
    const firstX = getWorldX()

    const frameDeltas: number[] = []
    let previousX = firstX
    for (let index = 0; index < 300; index += 1) {
      runFrame(32 + index * 16)
      const nextX = getWorldX()
      frameDeltas.push(previousX - nextX)
      previousX = nextX
    }

    expect(initialX - firstX).toBeGreaterThan(0)
    expect(frameDeltas[1]).toBeGreaterThan(frameDeltas[0])
    expect(frameDeltas[frameDeltas.length - 1]).toBeCloseTo(frameDeltas[frameDeltas.length - 2], 5)
    act(() => node.dispatchEvent(pointerEvent('pointerup', 9, 800, 300)))
    requestAnimationFrame.mockRestore()
  })

  it('指针停在画布外时仍会持续加速', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    })
    const world = node.parentElement!
    const getWorldX = () => Number(world.style.transform.match(/translate\(([-\d.]+)px/)?.[1])
    const callbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const runFrame = (time: number) => act(() => callbacks.shift()?.(time))

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 12, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 12, 800, 300))
    })
    runFrame(16)
    const firstX = getWorldX()

    runFrame(32)
    const secondX = getWorldX()

    runFrame(48)
    const thirdX = getWorldX()

    expect(firstX - secondX).toBeGreaterThan(0)
    expect(secondX - thirdX).toBeGreaterThan(firstX - secondX)
    act(() => node.dispatchEvent(pointerEvent('pointerup', 12, 800, 300)))
    requestAnimationFrame.mockRestore()
  })

  it('鼠标越过四边相同距离时自动移动速度一致', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 100, top: 50, right: 900, bottom: 650, width: 800, height: 600 }),
    })
    const world = node.parentElement!
    const getViewport = () => {
      const match = world.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)
      return { x: Number(match?.[1]), y: Number(match?.[2]) }
    }
    const callbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const measure = (pointerId: number, clientX: number, clientY: number) => {
      const before = getViewport()
      act(() => {
        node.dispatchEvent(pointerEvent('pointerdown', pointerId, 500, 350))
        node.dispatchEvent(pointerEvent('pointermove', pointerId, clientX, clientY))
        callbacks.shift()?.(16)
        node.dispatchEvent(pointerEvent('pointerup', pointerId, clientX, clientY))
      })
      callbacks.length = 0
      const after = getViewport()
      return { x: after.x - before.x, y: after.y - before.y }
    }

    const left = measure(16, 50, 350)
    const right = measure(17, 950, 350)
    const top = measure(18, 500, 0)
    const bottom = measure(19, 500, 700)

    expect(left.x).toBeGreaterThan(0)
    expect(right.x).toBeLessThan(0)
    expect(top.y).toBeGreaterThan(0)
    expect(bottom.y).toBeLessThan(0)
    expect(Math.abs(left.x)).toBeCloseTo(Math.abs(right.x), 5)
    expect(Math.abs(left.x)).toBeCloseTo(Math.abs(top.y), 5)
    expect(Math.abs(left.x)).toBeCloseTo(Math.abs(bottom.y), 5)
    requestAnimationFrame.mockRestore()
  })

  it('拖拽移出窗口后继续自动移动，释放后停止', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    })
    const callbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame')

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 10, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 10, 800, 300))
    })
    expect(callbacks).toHaveLength(1)

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: -1, clientY: 300, relatedTarget: null }))
      callbacks.shift()?.(16)
    })
    expect(callbacks).toHaveLength(1)

    act(() => node.dispatchEvent(pointerEvent('pointerup', 10, -1, 300)))
    expect(cancelAnimationFrame).toHaveBeenCalled()
    const callback = callbacks.shift()
    act(() => callback?.(32))
    expect(callbacks).toHaveLength(0)

    requestAnimationFrame.mockRestore()
    cancelAnimationFrame.mockRestore()
  })

  it('丢失图片的指针捕获后重新进入画布仍可继续拖拽', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 15, 80, 80))
      node.dispatchEvent(new Event('lostpointercapture', { bubbles: true }))
      canvas.dispatchEvent(pointerEvent('pointermove', 15, 120, 100))
      canvas.dispatchEvent(pointerEvent('pointerup', 15, 120, 100))
    })

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 40, y: 20 }),
      }),
    }))
  })

  it('自动平移期间不单独持久化视口，避免拖拽图片回到旧位置', () => {
    vi.useFakeTimers()
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    Object.defineProperty(canvas, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
    })
    const callbacks: Array<(time: number) => void> = []
    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callbacks.push(callback)
      return callbacks.length
    })

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 11, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 11, 800, 300))
      callbacks.shift()?.(16)
      vi.advanceTimersByTime(350)
    })

    expect(mocks.updateProjectCanvasViewport).not.toHaveBeenCalled()
    act(() => node.dispatchEvent(pointerEvent('pointerup', 11, 800, 300)))
    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      viewport: expect.objectContaining({ x: expect.any(Number) }),
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: expect.any(Number) }),
      }),
    }))

    requestAnimationFrame.mockRestore()
    vi.useRealTimers()
  })

  it('does not write the canvas while restoring project records', async () => {
    const legacyTask = { ...createTask(), projectId: undefined }
    mocks.state.current = {
      ...mocks.state.current,
      activeProjectId: '__local_project__',
      projects: [],
      tasks: [legacyTask],
      projectsLoaded: false,
    }
    mocks.updateProjectCanvas.mockClear()
    await act(async () => root.render(<ProjectCanvas />))
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()

    mocks.state.current = { ...mocks.state.current, projectsLoaded: true }
    await act(async () => root.render(<ProjectCanvas />))
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('moves every image in a Ctrl-selected group by the same offset', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = createProject()
    project.canvas!.items['image-b'] = { x: 300, y: 0, width: 240, z: 1, favoriteCollectionIds: [] }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))
    mocks.updateProjectCanvas.mockClear()

    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => first.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80, { ctrlKey: true })))
    act(() => second.dispatchEvent(pointerEvent('pointerdown', 2, 380, 80, { ctrlKey: true })))
    expect(mocks.setSelectedTaskIds).toHaveBeenCalledWith(['task-a', 'task-b'])
    mocks.state.current.selectedTaskIds = ['task-a', 'task-b']
    mocks.setSelectedTaskIds.mockClear()
    act(() => {
      first.dispatchEvent(pointerEvent('pointerdown', 3, 80, 80))
      first.dispatchEvent(pointerEvent('pointermove', 3, 120, 100))
      first.dispatchEvent(pointerEvent('pointerup', 3, 120, 100))
    })
    expect(mocks.setSelectedTaskIds).not.toHaveBeenCalled()

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 40, y: 20 }),
        'image-b': expect.objectContaining({ x: 340, y: 20 }),
      }),
    }))
    expect(canvas.querySelectorAll('[data-canvas-node]')).toHaveLength(2)
  })

  it('框选图片支持集体缩放和旋转', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = createProject()
    project.canvas!.items['image-b'] = { x: 300, y: 0, width: 240, z: 1, favoriteCollectionIds: [] }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => first.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80, { ctrlKey: true })))
    act(() => second.dispatchEvent(pointerEvent('pointerdown', 2, 380, 80, { ctrlKey: true })))
    mocks.state.current.selectedTaskIds = ['task-a', 'task-b']
    mocks.updateProjectCanvas.mockClear()

    const resizeHandle = host.querySelector<HTMLButtonElement>('[data-canvas-multi-resize="se"]')!
    act(() => {
      resizeHandle.dispatchEvent(pointerEvent('pointerdown', 3, 572, 272))
      resizeHandle.dispatchEvent(pointerEvent('pointermove', 3, 672, 372))
      resizeHandle.dispatchEvent(pointerEvent('pointerup', 3, 672, 372))
    })
    const resizedItems = mocks.updateProjectCanvas.mock.lastCall?.[1].items
    expect(resizedItems['image-a'].width).toBeGreaterThan(240)
    expect(resizedItems['image-b'].width).toBe(resizedItems['image-a'].width)

    const rotateHandle = host.querySelector<HTMLButtonElement>('[data-canvas-multi-rotate]')!
    const multiRotateHandles = host.querySelectorAll<HTMLButtonElement>('[data-canvas-multi-rotate]')
    expect(multiRotateHandles).toHaveLength(4)
    expect([...multiRotateHandles].every((handle) => handle.style.left === '-52px' || handle.style.right === '-52px')).toBe(true)
    expect(host.querySelector<HTMLButtonElement>('[data-canvas-multi-resize="nw"]')?.style.left).toBe('-5px')
    expect(host.querySelector<HTMLButtonElement>('[data-canvas-multi-resize="ne"]')?.style.right).toBe('-5px')
    act(() => {
      rotateHandle.dispatchEvent(pointerEvent('pointerdown', 4, 414, -20))
      rotateHandle.dispatchEvent(pointerEvent('pointermove', 4, 597, 202))
      rotateHandle.dispatchEvent(pointerEvent('pointerup', 4, 597, 202))
    })
    const rotatedItems = mocks.updateProjectCanvas.mock.lastCall?.[1].items
    expect(rotatedItems['image-a'].rotation).toBeCloseTo(90, 0)
    expect(rotatedItems['image-b'].rotation).toBeCloseTo(90, 0)
  })

  it('旧图片首次集体旋转后可以撤销', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = createProject()
    project.canvas!.items['image-b'] = { x: 300, y: 0, width: 240, z: 1, favoriteCollectionIds: [] }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => first.dispatchEvent(pointerEvent('pointerdown', 5, 80, 80, { ctrlKey: true })))
    act(() => second.dispatchEvent(pointerEvent('pointerdown', 6, 380, 80, { ctrlKey: true })))
    mocks.state.current.selectedTaskIds = ['task-a', 'task-b']
    mocks.updateProjectCanvas.mockClear()

    const rotateHandle = host.querySelector<HTMLButtonElement>('[data-canvas-multi-rotate="ne"]')!
    act(() => {
      rotateHandle.dispatchEvent(pointerEvent('pointerdown', 7, 414, -20))
      rotateHandle.dispatchEvent(pointerEvent('pointermove', 7, 597, 202))
      rotateHandle.dispatchEvent(pointerEvent('pointerup', 7, 597, 202))
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 0, y: 0, width: 240 }),
        'image-b': expect.objectContaining({ x: 300, y: 0, width: 240 }),
      }),
    }))
    expect(mocks.updateProjectCanvas.mock.lastCall?.[1].items['image-a'].rotation).toBeUndefined()
    expect(mocks.updateProjectCanvas.mock.lastCall?.[1].items['image-a'].operator).toBeUndefined()
  })

  it('旋转期间补齐旧图片尺寸属性后仍可撤销', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = createProject()
    project.canvas!.items['image-b'] = { x: 300, y: 0, width: 240, z: 1, favoriteCollectionIds: [] }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => first.dispatchEvent(pointerEvent('pointerdown', 8, 80, 80, { ctrlKey: true })))
    act(() => second.dispatchEvent(pointerEvent('pointerdown', 9, 380, 80, { ctrlKey: true })))
    mocks.state.current.selectedTaskIds = ['task-a', 'task-b']
    mocks.updateProjectCanvas.mockClear()

    const rotateHandle = host.querySelector<HTMLButtonElement>('[data-canvas-multi-rotate="ne"]')!
    act(() => {
      rotateHandle.dispatchEvent(pointerEvent('pointerdown', 10, 414, -20))
      rotateHandle.dispatchEvent(pointerEvent('pointermove', 10, 597, 202))
      mocks.thumbnailSubscribers.get('image-a')?.({ dataUrl: 'data:image/png;base64,AA==', width: 1024, height: 1024 })
      mocks.thumbnailSubscribers.get('image-b')?.({ dataUrl: 'data:image/png;base64,AA==', width: 1024, height: 1024 })
      rotateHandle.dispatchEvent(pointerEvent('pointerup', 10, 597, 202))
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 0, y: 0, width: 240 }),
        'image-b': expect.objectContaining({ x: 300, y: 0, width: 240 }),
      }),
    }))
  })

  it('新生成图片第一次旋转后可以撤销', async () => {
    const generatedTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), generatedTask] }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 20, 80, 80)))
    const rotate = node.querySelector<HTMLButtonElement>('[data-canvas-rotation-corner="ne"]')!
    act(() => {
      rotate.dispatchEvent(pointerEvent('pointerdown', 21, 414, -20))
      rotate.dispatchEvent(pointerEvent('pointermove', 21, 597, 202))
      rotate.dispatchEvent(pointerEvent('pointerup', 21, 597, 202))
    })
    mocks.thumbnailSubscribers.get('image-b')?.({ dataUrl: 'data:image/png;base64,AA==', width: 1024, height: 1024 })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    const items = mocks.updateProjectCanvas.mock.lastCall?.[1].items
    expect(items['image-b']).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number) }))
    expect(items['image-b'].rotation).toBeUndefined()
    expect(items['image-b'].operator).toBeUndefined()
  })

  it('生成占位符完成后第一次旋转撤销不会回到占位符', async () => {
    const runningTask = { ...createTask(), outputImages: [], status: 'running' as const, finishedAt: null, elapsed: null }
    const project = { ...createProject(), canvas: undefined }
    mocks.state.current = { ...mocks.state.current, tasks: [runningTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))

    const completedTask = { ...runningTask, outputImages: ['image-b'], status: 'done' as const, finishedAt: 3, elapsed: 2 }
    mocks.state.current = { ...mocks.state.current, tasks: [completedTask] }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 22, 80, 80)))
    const rotate = node.querySelector<HTMLButtonElement>('[data-canvas-rotation-corner="ne"]')!
    act(() => {
      rotate.dispatchEvent(pointerEvent('pointerdown', 23, 414, -20))
      rotate.dispatchEvent(pointerEvent('pointermove', 23, 597, 202))
      rotate.dispatchEvent(pointerEvent('pointerup', 23, 597, 202))
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect(host.querySelector('[data-node-key="image-b"]')).not.toBeNull()
    expect(host.querySelector('[data-node-key="task-a"]')).toBeNull()
  })

  it('历史基线尚未建立时菜单首次旋转也可以撤销', async () => {
    const project = { ...createProject(), canvas: undefined }
    mocks.state.current = { ...mocks.state.current, projects: [project], projectsLoaded: false }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    act(() => node.dispatchEvent(pointerEvent('pointerdown', 24, 80, 80)))
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="向右旋转 90°"]')!.click())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number) }),
      }),
    }))
    expect(mocks.updateProjectCanvas.mock.lastCall?.[1].items['image-a'].rotation).toBeUndefined()
  })

  it('moves one node and pans the viewport with the default wheel action', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    const world = canvas.firstElementChild as HTMLElement

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 1, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 1, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 1, 120, 100))
    })
    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({
        'image-a': expect.objectContaining({ x: 40, y: 20 }),
      }),
    }))
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', 2, 300, 300))
      canvas.dispatchEvent(pointerEvent('pointermove', 2, 330, 320))
      canvas.dispatchEvent(pointerEvent('pointerup', 2, 330, 320))
    })
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()

    act(() => {
      world.dispatchEvent(pointerEvent('pointerdown', 3, 500, 500))
      world.dispatchEvent(pointerEvent('pointermove', 3, 520, 510))
      world.dispatchEvent(pointerEvent('pointerup', 3, 520, 510))
    })
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()

    act(() => canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, deltaY: -120 })))
    expect(world.style.transform).toContain('scale(1)')
    expect(world.style.transform).toContain('translate(82px, 182px)')
    act(() => canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 300, clientY: 300, ctrlKey: true, deltaY: -120 })))
    expect(world.style.transform).not.toContain('scale(1)')
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('undoes and redoes canvas edits with keyboard shortcuts', () => {
    const node = host.querySelector<HTMLElement>('[data-canvas-node]')!
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      node.dispatchEvent(pointerEvent('pointerdown', 30, 80, 80))
      node.dispatchEvent(pointerEvent('pointermove', 30, 120, 100))
      node.dispatchEvent(pointerEvent('pointerup', 30, 120, 100))
    })
    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({ 'image-a': expect.objectContaining({ x: 40, y: 20 }) }),
    }))
    expect(mocks.clearProjectImageRedoHistory).toHaveBeenCalledWith('project-a')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({ 'image-a': expect.objectContaining({ x: 0, y: 0 }) }),
    }))

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(mocks.updateProjectCanvas).toHaveBeenLastCalledWith('project-a', expect.objectContaining({
      items: expect.objectContaining({ 'image-a': expect.objectContaining({ x: 40, y: 20 }) }),
    }))
  })

  it('uses project image history when canvas history is empty', () => {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(mocks.undoProjectImageHistory).toHaveBeenCalledWith('project-a')

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true })))
    expect(mocks.redoProjectImageHistory).toHaveBeenCalledWith('project-a')
  })

  it('does not rearrange automatically laid out images when undo history is empty', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = { ...createProject(), canvas: undefined }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    const before = [...canvas.querySelectorAll<HTMLElement>('[data-canvas-node]')].map((node) => ({ key: node.dataset.nodeKey, left: node.style.left, top: node.style.top }))
    mocks.updateProjectCanvas.mockClear()

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    const after = [...canvas.querySelectorAll<HTMLElement>('[data-canvas-node]')].map((node) => ({ key: node.dataset.nodeKey, left: node.style.left, top: node.style.top }))
    expect(after).toEqual(before)
    expect(mocks.updateProjectCanvas).not.toHaveBeenCalled()
  })

  it('keeps other image positions when undoing a move after automatic layout', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = { ...createProject(), canvas: undefined }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))
    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    const before = { left: second.style.left, top: second.style.top }

    act(() => {
      first.dispatchEvent(pointerEvent('pointerdown', 31, 80, 80))
      first.dispatchEvent(pointerEvent('pointermove', 31, 120, 100))
      first.dispatchEvent(pointerEvent('pointerup', 31, 120, 100))
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect({ left: second.style.left, top: second.style.top }).toEqual(before)
  })

  it('keeps persisted layout when undoing a move after refresh', async () => {
    const secondTask = { ...createTask(), id: 'task-b', outputImages: ['image-b'], createdAt: 2, finishedAt: 3 }
    const project = createProject()
    project.canvas!.items['image-b'] = { x: 360, y: 140, width: 240, z: 1, favoriteCollectionIds: [] }
    mocks.state.current = { ...mocks.state.current, tasks: [createTask(), secondTask], projects: [project] }
    await act(async () => root.render(<ProjectCanvas />))
    const first = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    const second = host.querySelector<HTMLElement>('[data-node-key="image-b"]')!
    const before = { left: second.style.left, top: second.style.top }
    mocks.updateProjectCanvas.mockClear()

    act(() => {
      first.dispatchEvent(pointerEvent('pointerdown', 32, 80, 80))
      first.dispatchEvent(pointerEvent('pointermove', 32, 120, 100))
      first.dispatchEvent(pointerEvent('pointerup', 32, 120, 100))
    })
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })))

    expect({ left: second.style.left, top: second.style.top }).toEqual(before)
  })

  it('keeps wheel events inside the layer panel from zooming the canvas', () => {
    const layerButton = host.querySelector<HTMLButtonElement>('[aria-label="图层"]')!
    act(() => layerButton.click())
    const panel = host.querySelector<HTMLElement>('[data-canvas-layers-panel]')!
    const world = host.querySelector<HTMLElement>('[data-project-canvas]')!.firstElementChild as HTMLElement
    const before = world.style.transform

    act(() => panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 })))

    expect(world.style.transform).toBe(before)
  })

  it('closes the zoom preset menu when clicking the canvas', () => {
    const zoomButton = host.querySelector<HTMLButtonElement>('[aria-label="选择画布缩放比例"]')!
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!

    act(() => zoomButton.click())
    expect(host.querySelector('[data-canvas-zoom-preset]')).not.toBeNull()

    act(() => canvas.dispatchEvent(pointerEvent('pointerdown', 20, 700, 500)))

    expect(host.querySelector('[data-canvas-zoom-preset]')).toBeNull()
  })

  it('prefers the persisted canvas cache over a stale project canvas snapshot', async () => {
    const project = createProject()
    mocks.state.current = {
      ...mocks.state.current,
      projects: [project],
      projectCanvasCache: {
        'project-a': {
          ...project.canvas!,
          items: {
            'image-a': { ...project.canvas!.items['image-a'], x: 420, y: 180, width: 360 },
          },
        },
      },
    }
    await act(async () => root.render(<ProjectCanvas />))

    const node = host.querySelector<HTMLElement>('[data-node-key="image-a"]')!
    expect(node.style.left).toBe('420px')
    expect(node.style.top).toBe('180px')
    expect(node.style.width).toBe('360px')
  })

  it('filters non-favorite images and supports a two-pointer pinch gesture', async () => {
    const canvas = host.querySelector<HTMLElement>('[data-project-canvas]')!
    act(() => {
      canvas.dispatchEvent(pointerEvent('pointerdown', 1, 100, 200))
      canvas.dispatchEvent(pointerEvent('pointerdown', 2, 200, 200))
      canvas.dispatchEvent(pointerEvent('pointermove', 2, 300, 200))
    })
    const world = canvas.firstElementChild as HTMLElement
    expect(world.style.transform).toContain('scale(2)')

    mocks.state.current = { ...mocks.state.current, filterFavorite: true }
    await act(async () => root.render(<ProjectCanvas />))
    expect(host.querySelector('[data-canvas-node]')).toBeNull()
    expect(host.textContent).toContain('没有找到匹配的图片')
  })
})

Object.defineProperties(HTMLElement.prototype, {
  clientWidth: { configurable: true, get: () => 800 },
  clientHeight: { configurable: true, get: () => 600 },
  offsetWidth: { configurable: true, get: () => 400 },
  offsetHeight: { configurable: true, get: () => 42 },
  setPointerCapture: { configurable: true, value: () => undefined },
})

class TestResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }

  disconnect() {}
  unobserve() {}
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
