import type { Project, StoredImage } from '../types'
import { authFetch } from '../auth/api'
import { blobToDataUrl } from './dataUrl'
import type { MaterialList } from './materialApi'
import type { OnlineProjectImageResponse, OnlineProjectResponse } from './onlineProjects'

export interface AdminUser {
  id: string
  oidc_provider: string
  email?: string
  name?: string
  picture_url?: string
	created_at: string
	updated_at: string
	last_login_at?: string
	last_project_updated_at?: string
}

async function readError(resp: Response, fallback: string) {
  const data = await resp.json().catch(() => null) as { message?: string } | null
  return data?.message || `${fallback}：HTTP ${resp.status}`
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const resp = await authFetch('/api/v1/admin/users', { cache: 'no-store' })
  if (!resp.ok) throw new Error(await readError(resp, '用户列表加载失败'))
  const data = await resp.json() as { users?: unknown }
  return Array.isArray(data.users) ? data.users as AdminUser[] : []
}

export async function listAdminUserProjects(userId: string): Promise<OnlineProjectResponse[]> {
  const resp = await authFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/projects`, { cache: 'no-store' })
  if (!resp.ok) throw new Error(await readError(resp, '用户画布列表加载失败'))
  const data = await resp.json() as { projects?: unknown }
  return Array.isArray(data.projects) ? data.projects as OnlineProjectResponse[] : []
}

export async function listAdminUserMaterials(userId: string, options: { page?: number; pageSize?: number; kind?: string; keyword?: string } = {}): Promise<MaterialList> {
  const query = new URLSearchParams({
    page: String(options.page ?? 1),
    page_size: String(options.pageSize ?? 24),
  })
  if (options.kind) query.set('kind', options.kind)
  if (options.keyword?.trim()) query.set('keyword', options.keyword.trim())
  const resp = await authFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/materials?${query.toString()}`, { cache: 'no-store' })
  if (!resp.ok) throw new Error(await readError(resp, '用户素材列表加载失败'))
  return await resp.json() as MaterialList
}

export async function downloadAdminUserProject(userId: string, projectId: string): Promise<Uint8Array> {
  const resp = await authFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}`, { cache: 'no-store' })
  if (!resp.ok) throw new Error(await readError(resp, '用户画布加载失败'))
  return new Uint8Array(await resp.arrayBuffer())
}

export async function listAdminUserProjectImages(userId: string, projectId: string): Promise<OnlineProjectImageResponse[]> {
  const resp = await authFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}/images`, { cache: 'no-store' })
  if (!resp.ok) throw new Error(await readError(resp, '用户画布图片列表加载失败'))
  const data = await resp.json() as unknown
  return Array.isArray(data) ? data as OnlineProjectImageResponse[] : []
}

export async function downloadAdminUserProjectImage(userId: string, projectId: string, image: OnlineProjectImageResponse): Promise<StoredImage> {
  if (image.image_url) {
    return {
      id: image.image_id,
      dataUrl: image.image_url,
      source: image.source,
      width: image.width,
      height: image.height,
      createdAt: Date.parse(image.created_at) || undefined,
    }
  }

  const resp = await authFetch(`/api/v1/admin/users/${encodeURIComponent(userId)}/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(image.image_id)}`)
  if (!resp.ok) throw new Error(await readError(resp, '用户画布图片加载失败'))
  return {
    id: image.image_id,
    dataUrl: await blobToDataUrl(await resp.blob(), image.mime_type),
    source: image.source,
    width: image.width,
    height: image.height,
    createdAt: Date.parse(image.created_at) || undefined,
  }
}

export function createAdminProject(project: OnlineProjectResponse, canvas?: Project['canvas']): Project {
  const createdAt = Date.parse(project.created_at) || Date.now()
  const updatedAt = Date.parse(project.updated_at) || Date.now()
  return {
    id: project.id,
    title: project.title,
    initialPrompt: '',
    storage: 'online',
    remoteId: project.id,
    remoteArchiveSha256: project.archive_sha256,
    syncPending: false,
    createdAt,
    updatedAt,
    contentUpdatedAt: updatedAt,
    canvas,
  }
}
