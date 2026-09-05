// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type AgentConversation, type TaskRecord } from '../types'

const mocks = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  setActiveConversationId: vi.fn(),
  regenerateAgentAssistantMessage: vi.fn(),
}))

vi.mock('../store', () => {
  const useStore = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state.current),
    { getState: () => mocks.state.current },
  )
  return {
    ALL_PROJECTS_ID: '__all_projects__',
    LOCAL_PROJECT_ID: '__local_project__',
    useStore,
    getActiveAgentRounds: (conversation: AgentConversation) => conversation.rounds,
    getAgentSiblingRounds: () => [],
    getAgentBranchLeafId: () => null,
    getCachedImage: () => '',
    ensureImageCached: vi.fn(),
    regenerateAgentAssistantMessage: mocks.regenerateAgentAssistantMessage,
  }
})

vi.mock('./HistoryModal', () => ({ default: () => null }))
vi.mock('./TaskCard', () => ({
  default: ({ onRetry }: { onRetry?: () => Promise<void> | void }) => (
    <button type="button" data-task-retry onClick={() => void onRetry?.()}>重试任务</button>
  ),
}))
vi.mock('./ProjectApiControls', () => ({ ProjectApiKeySelect: () => null }))
vi.mock('./MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <>{content}</> }))

import AgentWorkspace from './AgentWorkspace'

function conversation(id: string, title: string, updatedAt: number): AgentConversation {
  return { id, title, createdAt: updatedAt, updatedAt, rounds: [], messages: [] }
}

describe('AgentWorkspace read-only data', () => {
  let root: Root
  let host: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    mocks.state.current = {
      agentConversations: [conversation('own-conversation', '自己的会话', 3)],
      agentConversationsLoaded: true,
      activeProjectId: 'own-project',
      activeAgentConversationId: 'own-conversation',
      createAgentConversation: vi.fn(),
      setActiveAgentConversationId: mocks.setActiveConversationId,
      renameAgentConversation: vi.fn(),
      deleteAgentConversation: vi.fn(),
      agentSidebarCollapsed: true,
      setAgentSidebarCollapsed: vi.fn(),
      agentMobileHeaderVisible: true,
      setAgentMobileHeaderVisible: vi.fn(),
      appMode: 'agent',
      tasks: [],
      setConfirmDialog: vi.fn(),
      setDetailTaskId: vi.fn(),
      setPrompt: vi.fn(),
      setAgentInputPrompt: vi.fn(),
      setInputImages: vi.fn(),
      setMaskDraft: vi.fn(),
      clearMaskDraft: vi.fn(),
      setAppMode: vi.fn(),
      settings: { agentScrollToBottomAfterSubmit: false },
      agentEditingRoundId: null,
      agentEditingConversationId: null,
      setAgentEditingConversationId: vi.fn(),
      setAgentEditingRoundId: vi.fn(),
      setActiveAgentRoundId: vi.fn(),
      showToast: vi.fn(),
      openFavoritePicker: vi.fn(),
      agentGeneratingTitleIds: {},
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('显示被查看用户的会话，不使用管理员自己的会话', async () => {
    await act(async () => root.render(
      <AgentWorkspace
        embedded
        readOnly
        readOnlyData={{
          conversations: [conversation('target-conversation', '对方的会话', 2)],
          tasks: [],
          images: {},
        }}
      />,
    ))

    expect(host.textContent).toContain('对方的会话')
    expect(host.textContent).not.toContain('自己的会话')
    expect(mocks.setActiveConversationId).not.toHaveBeenCalled()
  })

  it('图片菜单重试当前 Agent 轮次以创建新分支', async () => {
    const task: TaskRecord = {
      id: 'failed-task',
      prompt: '生成测试图片',
      params: { ...DEFAULT_PARAMS, n: 1 },
      inputImageIds: [],
      outputImages: [],
      status: 'error',
      error: '服务端生成失败',
      createdAt: 2,
      finishedAt: 3,
      elapsed: 1,
      projectId: 'own-project',
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
    }
    const target: AgentConversation = {
      id: 'conversation-a',
      title: '测试会话',
      projectId: 'own-project',
      createdAt: 1,
      updatedAt: 3,
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 0,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '生成测试图片',
        inputImageIds: [],
        outputTaskIds: [task.id],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 3,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '生成测试图片', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '图片生成失败。', roundId: 'round-a', outputTaskIds: [task.id], createdAt: 3 },
      ],
    }
    mocks.state.current = {
      ...mocks.state.current,
      agentConversations: [target],
      activeAgentConversationId: target.id,
      tasks: [task],
    }

    await act(async () => root.render(<AgentWorkspace embedded />))

    const retryButton = host.querySelector<HTMLButtonElement>('[data-task-retry]')
    expect(retryButton).not.toBeNull()
    await act(async () => retryButton?.click())
    expect(mocks.regenerateAgentAssistantMessage).toHaveBeenCalledWith('conversation-a', 'round-a')
  })

  it('嵌入画布时不把滚轮事件传出 Agent 区域', async () => {
    const onWheel = vi.fn()

    await act(async () => root.render(
      <div onWheel={onWheel}>
        <AgentWorkspace embedded readOnly readOnlyData={{ conversations: [], tasks: [], images: {} }} />
      </div>,
    ))

    const workspace = host.querySelector<HTMLElement>('[data-agent-workspace]')
    const scrollContainer = host.querySelector<HTMLElement>('[data-agent-scroll-container]')
    expect(workspace?.className).toContain('overscroll-contain')
    expect(scrollContainer?.className).toContain('overscroll-contain')
    expect(scrollContainer?.className).toContain('var(--agent-input-bar-clearance,12rem)')
    expect(host.querySelector('[aria-label="滚动到底部"]')?.className).toContain('var(--agent-input-bar-clearance,12rem)')
    await act(async () => scrollContainer?.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })))
    expect(onWheel).not.toHaveBeenCalled()
  })
})
