// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  selection: { userId: null as string | null, projectId: null as string | null },
  showToast: vi.fn(),
  listAdminUsers: vi.fn(),
  listAdminUserProjects: vi.fn(),
  downloadAdminUserProject: vi.fn(),
  listAdminUserProjectImages: vi.fn(),
  downloadAdminUserProjectImage: vi.fn(),
  readOnlineProjectArchive: vi.fn(),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { is_admin: true } }),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ showToast: mocks.showToast }),
}))

vi.mock('../lib/projectRoute', () => ({
  getAdminUsersSelectionFromUrl: () => mocks.selection,
  updateAdminUsersUrl: vi.fn(),
}))

vi.mock('../lib/admin', () => ({
  createAdminProject: vi.fn(),
  listAdminUsers: mocks.listAdminUsers,
  listAdminUserProjects: mocks.listAdminUserProjects,
  downloadAdminUserProject: mocks.downloadAdminUserProject,
  listAdminUserProjectImages: mocks.listAdminUserProjectImages,
  downloadAdminUserProjectImage: mocks.downloadAdminUserProjectImage,
}))

vi.mock('../lib/onlineProjects', () => ({
  readOnlineProjectArchive: mocks.readOnlineProjectArchive,
}))

vi.mock('./AdminCanvasViewer', () => ({
  default: ({ agentConversations, images }: { agentConversations: Array<{ title: string }>; images: Record<string, unknown> }) => <div data-testid="admin-canvas-viewer"><span data-image-count>{Object.keys(images).length} 张图片</span><span data-agent-title>{agentConversations[0]?.title}</span></div>,
}))

import AdminUsers from './AdminUsers'

async function flushEffects() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('AdminUsers', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selection = { userId: null, projectId: null }
    mocks.listAdminUsers.mockResolvedValue([])
    mocks.listAdminUserProjects.mockResolvedValue([])
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('按最后修改时间降序展示用户，并使用 24 小时制', async () => {
    mocks.listAdminUsers.mockResolvedValue([
      { id: 'older', oidc_provider: 'oidc', name: '早先用户', created_at: '2026-01-01T00:00:00+08:00', updated_at: '2026-01-01T00:00:00+08:00', last_login_at: '2026-09-03T09:00:00+08:00', last_project_updated_at: '2026-09-02T09:00:00+08:00' },
      { id: 'newer', oidc_provider: 'oidc', name: '最新用户', created_at: '2026-01-01T00:00:00+08:00', updated_at: '2026-01-01T00:00:00+08:00', last_login_at: '2026-09-03T10:00:00+08:00', last_project_updated_at: '2026-09-03T23:05:06+08:00' },
      { id: 'empty', oidc_provider: 'oidc', name: '无项目用户', created_at: '2026-01-01T00:00:00+08:00', updated_at: '2026-01-01T00:00:00+08:00' },
    ])

    await act(async () => root.render(<AdminUsers />))
    await flushEffects()

    const names = Array.from(host.querySelectorAll('section button')).map((button) => button.textContent)
    expect(names[0]).toContain('最新用户')
    expect(names[1]).toContain('早先用户')
    expect(names[2]).toContain('无项目用户')
    expect(host.textContent).toContain('23:05:06')
    expect(host.textContent).not.toContain('最后登录')
  })

  it('项目归档就绪后立即进入画布，再加载图片', async () => {
    let resolveArchive: (bytes: Uint8Array) => void = () => undefined
    let resolveImages: (images: unknown[]) => void = () => undefined
    mocks.selection = { userId: 'user-a', projectId: 'project-a' }
    mocks.listAdminUserProjects.mockResolvedValue([{
      id: 'project-a',
      title: '画布 A',
      archive_size: 100,
      archive_sha256: 'sha',
      created_at: '2026-09-01T00:00:00+08:00',
      updated_at: '2026-09-03T12:00:00+08:00',
    }])
    mocks.downloadAdminUserProject.mockReturnValue(new Promise((resolve) => {
      resolveArchive = resolve
    }))
    mocks.listAdminUserProjectImages.mockReturnValue(new Promise((resolve) => {
      resolveImages = resolve
    }))
    mocks.readOnlineProjectArchive.mockReturnValue({
      project: {
        id: 'project-a',
        title: '画布 A',
        initialPrompt: '',
        createdAt: 1,
        updatedAt: 2,
        canvas: { version: 1, viewport: { x: 0, y: 0, scale: 1 }, items: {} },
      },
      tasks: [],
      agentConversations: [{ id: 'target-conversation', title: '对方会话', createdAt: 1, updatedAt: 2, rounds: [], messages: [] }],
      images: [],
    })
    mocks.downloadAdminUserProjectImage.mockResolvedValue({ id: 'image-a', dataUrl: 'data:image/png;base64,AA==' })

    await act(async () => root.render(<AdminUsers />))
    await flushEffects()
    expect(host.querySelector('[data-admin-canvas-loading]')).not.toBeNull()
    expect(host.textContent).not.toContain('用户管理')

    resolveArchive(new Uint8Array([1]))
    await flushEffects()
    expect(host.querySelector('[data-image-count]')?.textContent).toBe('0 张图片')
    expect(host.querySelector('[data-agent-title]')?.textContent).toBe('对方会话')

    resolveImages([{
      project_id: 'project-a',
      image_id: 'image-a',
      mime_type: 'image/png',
      image_size: 1,
      image_sha256: 'image-sha',
      created_at: '2026-09-03T12:00:00+08:00',
      updated_at: '2026-09-03T12:00:00+08:00',
    }])
    await flushEffects()

    expect(host.querySelector('[data-image-count]')?.textContent).toBe('1 张图片')
  })
})
