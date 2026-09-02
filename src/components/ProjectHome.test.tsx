// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../types'

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('../auth/oidcResource', () => ({
  fetchApiKeys: vi.fn(),
  fetchModels: vi.fn(),
}))

vi.mock('../store', () => {
  const useStore = (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state.current)
  useStore.getState = () => mocks.state.current
  return {
    LOCAL_PROJECT_ID: '__local_project__',
    createInputImageFromFile: vi.fn(),
    deleteImageIfUnreferenced: vi.fn(),
    ensureImageThumbnailCached: vi.fn(async () => null),
    submitTask: vi.fn(),
    useStore,
  }
})

vi.mock('../lib/projectRoute', () => ({
  updateProjectUrl: vi.fn(),
}))

vi.mock('../lib/oidcApiKeySelection', () => ({
  readCachedApiKey: vi.fn(() => ''),
  readCachedModel: vi.fn(() => ''),
  writeCachedApiKey: vi.fn(),
  writeCachedModel: vi.fn(),
}))

vi.mock('./Select', () => ({ default: () => <div /> }))
vi.mock('./HomePromptEditor', () => ({ default: () => <div /> }))
vi.mock('./MaterialPickerModal', () => ({ default: () => null }))

import ProjectHome from './ProjectHome'

describe('ProjectHome', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    const project: Project = {
      id: 'project-a',
      title: '内容时间项目',
      initialPrompt: '',
      storage: 'local',
      createdAt: Date.parse('2026-09-01T08:00:00+08:00'),
      contentUpdatedAt: Date.parse('2026-09-02T09:15:00+08:00'),
      updatedAt: Date.parse('2026-09-04T22:30:00+08:00'),
    }
    mocks.state.current = {
      projects: [project],
      projectsLoaded: true,
      tasks: [],
      createProject: vi.fn(),
      setAppMode: vi.fn(),
      setActiveProjectId: vi.fn(),
      setConfirmDialog: vi.fn(),
      deleteProject: vi.fn(),
      renameProject: vi.fn(),
      setOidcApiOverride: vi.fn(),
      showToast: vi.fn(),
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('项目卡片显示内容修改时间，不显示视口同步时间', async () => {
    await act(async () => root.render(<ProjectHome />))

    const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    const card = Array.from(host.querySelectorAll('article')).find((item) => item.textContent?.includes('内容时间项目'))
    expect(card?.textContent).toContain(formatter.format(Date.parse('2026-09-02T09:15:00+08:00')))
    expect(card?.textContent).not.toContain(formatter.format(Date.parse('2026-09-04T22:30:00+08:00')))
  })
})
