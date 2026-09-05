import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { createAdminProject, downloadAdminUserProject, downloadAdminUserProjectImage, listAdminUserProjectImages, listAdminUserProjects, listAdminUsers, type AdminUser } from '../lib/admin'
import type { AgentConversation, Project, StoredImage, TaskRecord } from '../types'
import { readOnlineProjectArchive, type OnlineProjectResponse } from '../lib/onlineProjects'
import { getAdminUsersSelectionFromUrl, updateAdminUsersUrl } from '../lib/projectRoute'
import { useStore } from '../store'
import AdminCanvasViewer from './AdminCanvasViewer'
import AdminMaterialLibrary from './AdminMaterialLibrary'
import { ArrowDownIcon, ChevronLeftIcon, CollectionManageIcon, ImageIcon, UsersIcon } from './icons'

type ViewerState = { project: Project; tasks: TaskRecord[]; agentConversations: AgentConversation[]; images: Record<string, StoredImage> }

function AdminCanvasLoading({ title, error, onBack }: { title?: string; error?: string | null; onBack: () => void }) {
  return (
    <div data-admin-canvas-loading className="flex h-[calc(100dvh-2.75rem)] min-h-[320px] flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-gray-900">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="返回用户画布" title="返回用户画布"><ChevronLeftIcon className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{title || '只读画布'}</h1>
          <p className="text-xs text-gray-500">只读查看 · {error ? '加载失败' : '正在加载'}</p>
        </div>
      </div>
      <div className="grid min-h-0 flex-1 w-full xl:grid-cols-[minmax(0,1fr)_420px]">
        <main className="relative flex min-h-0 min-w-0 items-center justify-center border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950">
          {error ? (
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <p className="text-sm text-red-500">{error}</p>
              <button type="button" onClick={onBack} className="text-sm font-medium text-[#3f78c5] hover:underline">返回用户画布</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500"><span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-[#3f78c5]" />正在读取画布...</div>
          )}
        </main>
        <aside className="hidden border-l border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900 xl:block" />
      </div>
    </div>
  )
}

function formatDate(value?: string, emptyLabel = '从未登录') {
  if (!value) return emptyLabel
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export default function AdminUsers() {
  const { user } = useAuth()
  const showToast = useStore((state) => state.showToast)
  const [initialSelection] = useState(getAdminUsersSelectionFromUrl)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialSelection.userId)
  const [projects, setProjects] = useState<OnlineProjectResponse[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialSelection.projectId)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectsLoading, setProjectsLoading] = useState(Boolean(initialSelection.userId))
  const [viewerLoading, setViewerLoading] = useState(Boolean(initialSelection.projectId))
  const [viewerError, setViewerError] = useState<string | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [contentView, setContentView] = useState<'projects' | 'materials'>('projects')
  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId), [selectedUserId, users])

  useEffect(() => {
    if (!user?.is_admin) return
    setLoading(true)
    void listAdminUsers()
      .then((nextUsers) => setUsers([...nextUsers].sort((a, b) => (Date.parse(b.last_project_updated_at ?? '') || 0) - (Date.parse(a.last_project_updated_at ?? '') || 0))))
      .catch((error) => showToast(error instanceof Error ? error.message : '用户列表加载失败', 'error'))
      .finally(() => setLoading(false))
  }, [showToast, user?.is_admin])

  useEffect(() => {
    const syncSelectionFromUrl = () => {
      const selection = getAdminUsersSelectionFromUrl()
      setSelectedUserId(selection.userId)
      setSelectedProjectId(selection.projectId)
      setContentView('projects')
      setViewerError(null)
      setViewerLoading(Boolean(selection.projectId))
    }

    window.addEventListener('popstate', syncSelectionFromUrl)
    return () => window.removeEventListener('popstate', syncSelectionFromUrl)
  }, [])

  useEffect(() => {
    if (!selectedUserId) {
      setProjects([])
      setProjectsLoading(false)
      return
    }

    let cancelled = false
    setProjects([])
    setProjectsError(null)
    setProjectsLoading(true)
    void listAdminUserProjects(selectedUserId)
      .then((nextProjects) => {
        if (cancelled) return
        setProjects([...nextProjects].sort((a, b) => (Date.parse(b.content_updated_at ?? b.updated_at) || 0) - (Date.parse(a.content_updated_at ?? a.updated_at) || 0)))
      })
      .catch((error) => {
        if (cancelled) return
        setProjects([])
        const message = error instanceof Error ? error.message : '用户画布列表加载失败'
        setProjectsError(message)
        showToast(message, 'error')
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedUserId, showToast])

  useEffect(() => {
    if (!selectedUserId || !selectedProjectId) {
      setViewer(null)
      setViewerLoading(false)
      return
    }

    const project = projects.find((item) => item.id === selectedProjectId)
    if (!project) {
      setViewer(null)
      if (projectsLoading) return
      setViewerLoading(false)
      // 列表加载失败时同样查不到项目，此时不能报“找不到”，否则会把网络错误说成项目不存在。
      setViewerError(projectsError ? `用户画布列表加载失败：${projectsError}` : '找不到该用户画布')
      return
    }

    let cancelled = false
    setViewer(null)
    setViewerLoading(true)
    setViewerError(null)
    console.info('[只读画布] 在线数据请求', {
      userId: selectedUserId,
      projectId: project.id,
      title: project.title,
      archiveSha256: project.archive_sha256,
    })
    const remoteImagesPromise = listAdminUserProjectImages(selectedUserId, project.id).catch((error) => {
      if (!cancelled) showToast(error instanceof Error ? error.message : '用户画布图片列表加载失败', 'error')
      return []
    })
    void downloadAdminUserProject(selectedUserId, project.id)
      .then(async (archiveBytes) => {
        const parsed = readOnlineProjectArchive(archiveBytes)
        const loadedProject = parsed.project ? { ...parsed.project, id: project.id, title: project.title, storage: 'online' as const, remoteId: project.id } : createAdminProject(project)
        const images = Object.fromEntries(parsed.images.map((image) => [image.id, image]))
        console.info('[只读画布] 在线数据响应', {
          userId: selectedUserId,
          projectId: project.id,
          archiveBytes: archiveBytes.byteLength,
        })
        if (cancelled) return
        setViewer({ project: loadedProject, tasks: parsed.tasks, agentConversations: parsed.agentConversations, images })
        setViewerLoading(false)

        const remoteImages = await remoteImagesPromise
        console.info('[只读画布] 图片列表响应', {
          userId: selectedUserId,
          projectId: project.id,
          remoteImageCount: remoteImages.length,
          remoteImageIds: remoteImages.map((image) => image.image_id),
        })
        await Promise.all(remoteImages.map(async (remoteImage) => {
          if (images[remoteImage.image_id]) return
          try {
            const image = await downloadAdminUserProjectImage(selectedUserId, project.id, remoteImage)
            if (cancelled) return
            images[remoteImage.image_id] = image
            setViewer((current) => current ? { ...current, images: { ...current.images, [image.id]: image } } : current)
          } catch (error) {
            console.warn(`管理员读取项目图片 ${remoteImage.image_id} 失败`, error)
          }
        }))
        console.info('[只读画布] 加载数据', {
          userId: selectedUserId,
          projectId: project.id,
          project: loadedProject,
          taskCount: parsed.tasks.length,
          taskIds: parsed.tasks.map((task) => task.id),
          canvasItemCount: Object.keys(loadedProject.canvas?.items ?? {}).length,
          canvasItemIds: Object.keys(loadedProject.canvas?.items ?? {}),
          imageCount: Object.keys(images).length,
          imageIds: Object.keys(images),
        })
      })
      .catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : '用户画布加载失败'
        setViewer(null)
        setViewerError(message)
        showToast(message, 'error')
      })
      .finally(() => {
        if (!cancelled) setViewerLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projects, projectsError, projectsLoading, selectedProjectId, selectedUserId, showToast])

  if (!user?.is_admin) return <div className="p-6 text-sm text-gray-500">无权访问</div>

  const selectUser = (nextUser: AdminUser) => {
    updateAdminUsersUrl(nextUser.id, null)
    setSelectedUserId(nextUser.id)
    setSelectedProjectId(null)
    setViewer(null)
    setViewerError(null)
    setViewerLoading(false)
    setContentView('projects')
  }

  const selectProject = (project: OnlineProjectResponse) => {
    if (!selectedUserId) return
    updateAdminUsersUrl(selectedUserId, project.id)
    setSelectedProjectId(project.id)
    setViewer(null)
    setViewerError(null)
    setViewerLoading(true)
  }

  const showAllUsers = () => {
    updateAdminUsersUrl(null, null)
    setSelectedUserId(null)
    setSelectedProjectId(null)
    setProjects([])
    setViewer(null)
    setViewerError(null)
    setViewerLoading(false)
    setContentView('projects')
  }

  const showUserProjects = () => {
    if (!selectedUserId) return
    updateAdminUsersUrl(selectedUserId, null)
    setSelectedProjectId(null)
    setViewer(null)
    setViewerError(null)
    setViewerLoading(false)
  }

  if (viewer) return <AdminCanvasViewer project={viewer.project} tasks={viewer.tasks} agentConversations={viewer.agentConversations} images={viewer.images} onBack={showUserProjects} />
  if (selectedProjectId) return <AdminCanvasLoading title={projects.find((project) => project.id === selectedProjectId)?.title} error={viewerError} onBack={showUserProjects} />

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 p-4 sm:p-6 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center gap-2"><UsersIcon className="h-5 w-5 text-gray-600 dark:text-gray-300" /><h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">用户管理</h1></div>
        {!selectedUserId ? (
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
            <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-white/[0.08]">共 {users.length} 位用户</div>
            {loading ? <div className="p-6 text-sm text-gray-500">加载中...</div> : users.length === 0 ? <div className="p-6 text-sm text-gray-500">暂无用户</div> : <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{users.map((item) => <button key={item.id} type="button" onClick={() => selectUser(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.04]">
              {item.picture_url ? <img src={item.picture_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500 dark:bg-white/[0.08]">{(item.name || item.email || '?').slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.name || '未命名用户'}</span><span className="block truncate text-xs text-gray-500">{item.email || item.oidc_provider}</span><span className="block truncate text-[11px] text-gray-400 sm:hidden">最后修改 {formatDate(item.last_project_updated_at, '暂无项目')}</span></span>
              <span className="hidden shrink-0 text-xs text-gray-400 sm:block">最后修改 {formatDate(item.last_project_updated_at, '暂无项目')}</span><ArrowDownIcon className="h-4 w-4 -rotate-90 text-gray-400" />
            </button>)}</div>}
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900">
              <button type="button" onClick={showAllUsers} className="mb-4 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"><ChevronLeftIcon className="h-4 w-4" />全部用户</button>
              <div className="flex items-center gap-3">{selectedUser?.picture_url ? <img src={selectedUser.picture_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500 dark:bg-white/[0.08]">{(selectedUser?.name || selectedUser?.email || '?').slice(0, 1).toUpperCase()}</span>}<div className="min-w-0"><div className="truncate text-sm font-medium text-gray-900 dark:text-white">{selectedUser?.name || '用户'}</div><div className="truncate text-xs text-gray-500">{selectedUser?.email || selectedUserId}</div></div></div>
              {selectedUser && <dl className="mt-5 space-y-2 text-xs"><div className="flex justify-between gap-2"><dt className="text-gray-400">登录来源</dt><dd className="truncate text-gray-600 dark:text-gray-300">{selectedUser.oidc_provider}</dd></div><div className="flex justify-between gap-2"><dt className="text-gray-400">注册时间</dt><dd className="text-right text-gray-600 dark:text-gray-300">{formatDate(selectedUser.created_at)}</dd></div></dl>}
            </section>
            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
              <div className="flex items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-white/[0.08]" role="tablist" aria-label="用户内容">
                <button type="button" role="tab" aria-selected={contentView === 'projects'} onClick={() => setContentView('projects')} className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition ${contentView === 'projects' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'}`}><ImageIcon className="h-4 w-4" />画布</button>
                <button type="button" role="tab" aria-selected={contentView === 'materials'} onClick={() => setContentView('materials')} className={`flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition ${contentView === 'materials' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'}`}><CollectionManageIcon className="h-4 w-4" />素材</button>
              </div>
              {contentView === 'materials' ? <AdminMaterialLibrary key={selectedUserId} userId={selectedUserId} /> : <>
                <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-white/[0.08]">用户画布 · {projects.length} 个项目</div>
                {projectsLoading ? <div className="p-6 text-sm text-gray-500">加载中...</div> : projects.length === 0 ? <div className="p-6 text-sm text-gray-500">该用户暂无在线画布</div> : <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{projects.map((project) => <button key={project.id} type="button" onClick={() => selectProject(project)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.04]"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{project.title || '未命名画布'}</span><span className="block truncate text-xs text-gray-500">更新于 {formatDate(project.content_updated_at ?? project.updated_at)}</span></span><span className="flex shrink-0 flex-col items-end text-xs text-gray-400"><span>{project.image_count ?? 0} 个作品</span><span>{(project.archive_size / 1024 / 1024).toFixed(1)} MB</span></span><ArrowDownIcon className="h-4 w-4 -rotate-90 text-gray-400" /></button>)}</div>}
                {viewerLoading && <div className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-white/[0.06]">正在读取画布...</div>}
                {selectedProjectId && viewerLoading === false && !viewer && <div className="hidden" />}
              </>}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
