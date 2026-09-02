// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  retryImage: vi.fn(),
  retryTaskInPlace: vi.fn(),
  redownloadTaskImage: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state.current),
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(async () => null),
  subscribeImageThumbnail: vi.fn(() => () => undefined),
  retryImage: mocks.retryImage,
  retryTaskInPlace: mocks.retryTaskInPlace,
  redownloadTaskImage: mocks.redownloadTaskImage,
}))

vi.mock('../lib/materialApi', () => ({ uploadMaterialImage: vi.fn() }))

import TaskCard from './TaskCard'

function errorTask(error: string, extra: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-error',
    prompt: '测试图片',
    params: { ...DEFAULT_PARAMS, n: 1 },
    inputImageIds: [],
    outputImages: [],
    status: 'error',
    error,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...extra,
  }
}

describe('TaskCard', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.current = {
      toggleTaskSelection: vi.fn(),
      settings: {},
      openFavoritePicker: vi.fn(),
      showToast: vi.fn(),
      streamPreviews: {},
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('在原图片区域显示删除图标和文案', async () => {
    const task: TaskRecord = {
      id: 'task-a',
      prompt: '测试图片',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageIds: [],
      outputImages: [],
      outputImageSlots: [null],
      status: 'done',
      error: null,
      createdAt: 1,
      finishedAt: 2,
      elapsed: 1,
    }

    await act(async () => root.render(
      <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
    ))

    const deleted = host.querySelector('[data-task-image-deleted]')
    expect(deleted?.textContent).toBe('图片已删除')
    expect(deleted?.querySelector('svg')).not.toBeNull()
  })

  it('普通生成失败只从图片菜单创建 Agent 重试分支', async () => {
    const task = errorTask('服务端生成失败', { failureKind: 'network' })
    const onRetry = vi.fn()

    await act(async () => root.render(
      <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} onRetry={onRetry} />,
    ))

    expect(host.querySelector('button[aria-label="重试请求"]')).toBeNull()
    const retryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重试任务"]')
    expect(retryButton).not.toBeNull()
    await act(async () => retryButton?.click())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(mocks.retryTaskInPlace).not.toHaveBeenCalled()
  })

  it('Failed to fetch 在黄色错误区域原地重试', async () => {
    const task = errorTask('Failed to fetch')
    const onRetry = vi.fn()

    await act(async () => root.render(
      <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} onRetry={onRetry} />,
    ))

    expect(host.querySelector('.cursor-pointer')?.className).toContain('!bg-yellow-50')
    const retryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重试请求"]')
    expect(retryButton).not.toBeNull()
    await act(async () => retryButton?.click())
    expect(mocks.retryTaskInPlace).toHaveBeenCalledWith(task)
    expect(onRetry).not.toHaveBeenCalled()

    const menuRetryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重试任务"]')
    await act(async () => menuRetryButton?.click())
    expect(mocks.retryTaskInPlace).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('请求超时在黄色错误区域原地重试', async () => {
    const task = errorTask('请求超时：超过 120 秒仍未完成')

    await act(async () => root.render(
      <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} />,
    ))

    expect(host.textContent).toContain('请求超时，请稍后重试。')
    const retryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重试请求"]')
    await act(async () => retryButton?.click())
    expect(mocks.retryTaskInPlace).toHaveBeenCalledWith(task)
  })

  it('图片下载失败在黄色错误区域原地重新下载', async () => {
    const task = errorTask('图片链接下载失败（网络不可用）。', {
      failureEndpoint: 'download',
      rawImageUrls: ['https://example.com/image.png'],
    })
    const onRetry = vi.fn()

    await act(async () => root.render(
      <TaskCard task={task} onReuse={vi.fn()} onEditOutputs={vi.fn()} onDelete={vi.fn()} onClick={vi.fn()} onRetry={onRetry} />,
    ))

    expect(host.textContent).toContain('图片下载失败')
    const retryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重新下载图片"]')
    expect(retryButton).not.toBeNull()
    await act(async () => retryButton?.click())
    expect(mocks.redownloadTaskImage).toHaveBeenCalledWith(task, undefined)
    expect(mocks.retryTaskInPlace).not.toHaveBeenCalled()

    const menuRetryButton = host.querySelector<HTMLButtonElement>('button[aria-label="重试任务"]')
    expect(menuRetryButton).not.toBeNull()
    await act(async () => menuRetryButton?.click())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(mocks.redownloadTaskImage).toHaveBeenCalledOnce()
  })
})
