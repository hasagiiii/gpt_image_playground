import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { createAdminProject, downloadAdminUserProject, downloadAdminUserProjectImage, listAdminUserProjectImages, listAdminUserProjects, listAdminUsers, type AdminUser } from '../lib/admin'
import type { Project, StoredImage, TaskRecord } from '../types'
import { readOnlineProjectArchive, type OnlineProjectResponse } from '../lib/onlineProjects'
import { useStore } from '../store'
import AdminCanvasViewer from './AdminCanvasViewer'
import { ArrowDownIcon, ChevronLeftIcon, UsersIcon } from './icons'

type ViewerState = { project: Project; tasks: TaskRecord[]; images: Record<string, StoredImage> }

function formatDate(value?: string) {
  if (!value) return '从未登录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function AdminUsers() {
  const { user } = useAuth()
  const showToast = useStore((state) => state.showToast)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [projects, setProjects] = useState<OnlineProjectResponse[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [loading, setLoading] = useState(true)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [viewerLoading, setViewerLoading] = useState(false)
  const selectedUser = useMemo(() => users.find((item) => item.id === selectedUserId), [selectedUserId, users])

  useEffect(() => {
    if (!user?.is_admin) return
    setLoading(true)
    void listAdminUsers().then(setUsers).catch((error) => showToast(error instanceof Error ? error.message : '用户列表加载失败', 'error')).finally(() => setLoading(false))
  }, [showToast, user?.is_admin])

  if (!user?.is_admin) return <div className="p-6 text-sm text-gray-500">无权访问</div>

  const selectUser = async (nextUser: AdminUser) => {
    setSelectedUserId(nextUser.id)
    setSelectedProjectId(null)
    setViewer(null)
    setProjectsLoading(true)
    try {
      setProjects(await listAdminUserProjects(nextUser.id))
    } catch (error) {
      setProjects([])
      showToast(error instanceof Error ? error.message : '用户画布列表加载失败', 'error')
    } finally {
      setProjectsLoading(false)
    }
  }

  const selectProject = async (project: OnlineProjectResponse) => {
    if (!selectedUserId) return
    setSelectedProjectId(project.id)
    setViewerLoading(true)
    try {
      const [archiveBytes, remoteImages] = await Promise.all([
        downloadAdminUserProject(selectedUserId, project.id),
        listAdminUserProjectImages(selectedUserId, project.id),
      ])
      const parsed = readOnlineProjectArchive(archiveBytes)
      const loadedProject = parsed.project ? { ...parsed.project, id: project.id, title: project.title, storage: 'online' as const, remoteId: project.id } : createAdminProject(project)
      const images = Object.fromEntries(parsed.images.map((image) => [image.id, image]))
      await Promise.all(remoteImages.map(async (remoteImage) => {
        if (images[remoteImage.image_id]) return
        try {
          images[remoteImage.image_id] = await downloadAdminUserProjectImage(selectedUserId, project.id, remoteImage)
        } catch (error) {
          console.warn(`管理员读取项目图片 ${remoteImage.image_id} 失败`, error)
        }
      }))
      setViewer({ project: loadedProject, tasks: parsed.tasks, images })
    } catch (error) {
      setViewer(null)
      showToast(error instanceof Error ? error.message : '用户画布加载失败', 'error')
    } finally {
      setViewerLoading(false)
    }
  }

  if (viewer) return <AdminCanvasViewer project={viewer.project} tasks={viewer.tasks} images={viewer.images} onBack={() => setViewer(null)} />

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gray-50 p-4 sm:p-6 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex items-center gap-2"><UsersIcon className="h-5 w-5 text-gray-600 dark:text-gray-300" /><h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">用户管理</h1></div>
        {!selectedUser ? (
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
            <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-white/[0.08]">共 {users.length} 位用户</div>
            {loading ? <div className="p-6 text-sm text-gray-500">加载中...</div> : users.length === 0 ? <div className="p-6 text-sm text-gray-500">暂无用户</div> : <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{users.map((item) => <button key={item.id} type="button" onClick={() => void selectUser(item)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.04]">
              {item.picture_url ? <img src={item.picture_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500 dark:bg-white/[0.08]">{(item.name || item.email || '?').slice(0, 1).toUpperCase()}</span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{item.name || '未命名用户'}</span><span className="block truncate text-xs text-gray-500">{item.email || item.oidc_provider}</span></span>
              <span className="hidden text-xs text-gray-400 sm:block">最后登录 {formatDate(item.last_login_at)}</span><ArrowDownIcon className="h-4 w-4 -rotate-90 text-gray-400" />
            </button>)}</div>}
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900">
              <button type="button" onClick={() => { setSelectedUserId(null); setProjects([]); setSelectedProjectId(null) }} className="mb-4 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:hover:text-white"><ChevronLeftIcon className="h-4 w-4" />全部用户</button>
              <div className="flex items-center gap-3">{selectedUser.picture_url ? <img src={selectedUser.picture_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-500 dark:bg-white/[0.08]">{(selectedUser.name || selectedUser.email || '?').slice(0, 1).toUpperCase()}</span>}<div className="min-w-0"><div className="truncate text-sm font-medium text-gray-900 dark:text-white">{selectedUser.name || '未命名用户'}</div><div className="truncate text-xs text-gray-500">{selectedUser.email || '未提供邮箱'}</div></div></div>
              <dl className="mt-5 space-y-2 text-xs"><div className="flex justify-between gap-2"><dt className="text-gray-400">登录来源</dt><dd className="truncate text-gray-600 dark:text-gray-300">{selectedUser.oidc_provider}</dd></div><div className="flex justify-between gap-2"><dt className="text-gray-400">注册时间</dt><dd className="text-right text-gray-600 dark:text-gray-300">{formatDate(selectedUser.created_at)}</dd></div></dl>
            </section>
            <section className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
              <div className="border-b border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-white/[0.08]">用户画布 · {projects.length} 个项目</div>
              {projectsLoading ? <div className="p-6 text-sm text-gray-500">加载中...</div> : projects.length === 0 ? <div className="p-6 text-sm text-gray-500">该用户暂无在线画布</div> : <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">{projects.map((project) => <button key={project.id} type="button" onClick={() => void selectProject(project)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gray-50 dark:hover:bg-white/[0.04]"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{project.title || '未命名画布'}</span><span className="block truncate text-xs text-gray-500">更新于 {formatDate(project.updated_at)}</span></span><span className="text-xs text-gray-400">{(project.archive_size / 1024 / 1024).toFixed(1)} MB</span><ArrowDownIcon className="h-4 w-4 -rotate-90 text-gray-400" /></button>)}</div>}
              {viewerLoading && <div className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500 dark:border-white/[0.06]">正在读取画布...</div>}
              {selectedProjectId && viewerLoading === false && !viewer && <div className="hidden" />}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
