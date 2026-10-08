import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnlineProjectImageResponse } from './onlineProjects'

const authFetch = vi.hoisted(() => vi.fn())

vi.mock('../auth/api', () => ({ authFetch }))

import { downloadAdminUserProject, listAdminUserMaterials, listAdminUserProjectImages, listAdminUserProjects, toAdminUserProjectImage } from './admin'

describe('admin', () => {
  beforeEach(() => {
    authFetch.mockReset()
  })

  it('读取他人画布列表、归档和图片时绕过旧 Service Worker 缓存', async () => {
    const projects = [{ id: 'project-a', title: '最新布局' }]
    const images = [{ image_id: 'image-a', width: 400, height: 200 }]
    authFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ projects })))
      .mockResolvedValueOnce(new Response(new Uint8Array([80, 75, 3, 4])))
      .mockResolvedValueOnce(new Response(JSON.stringify(images)))

    await expect(listAdminUserProjects('user/a')).resolves.toEqual(projects)
    await expect(downloadAdminUserProject('user/a', 'project/a')).resolves.toEqual(new Uint8Array([80, 75, 3, 4]))
    await expect(listAdminUserProjectImages('user/a', 'project/a')).resolves.toEqual(images)

    expect(authFetch).toHaveBeenNthCalledWith(1, expect.stringMatching(/^\/api\/v1\/admin\/users\/user%2Fa\/projects\?_=\d+$/), { cache: 'no-store' })
    expect(authFetch).toHaveBeenNthCalledWith(2, expect.stringMatching(/^\/api\/v1\/admin\/users\/user%2Fa\/projects\/project%2Fa\?_=\d+$/), { cache: 'no-store' })
    expect(authFetch).toHaveBeenNthCalledWith(3, expect.stringMatching(/^\/api\/v1\/admin\/users\/user%2Fa\/projects\/project%2Fa\/images\?_=\d+$/), { cache: 'no-store' })
  })

  it('uses the direct image URL for read-only images', async () => {
    const image: OnlineProjectImageResponse = {
      project_id: 'project-a',
      image_id: 'image-a',
      image_url: 'https://cdn.example/image-a.png',
      mime_type: 'image/png',
      image_size: 1234,
      image_sha256: 'sha256',
      created_at: '2026-08-16T00:00:00Z',
      updated_at: '2026-08-16T00:00:00Z',
      source: 'generated',
      width: 1024,
      height: 768,
    }

    const result = toAdminUserProjectImage(image)

    expect(result).toEqual({
      id: 'image-a',
      dataUrl: 'https://cdn.example/image-a.png',
      remoteUrl: 'https://cdn.example/image-a.png',
      source: 'generated',
      width: 1024,
      height: 768,
      createdAt: Date.parse('2026-08-16T00:00:00Z'),
    })
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('does not create an authenticated endpoint URL when metadata has no direct URL', () => {
    expect(toAdminUserProjectImage({
      project_id: 'project-a',
      image_id: 'reference-a',
      mime_type: 'image/png',
      image_size: 3,
      image_sha256: 'sha256',
      created_at: '2026-08-16T00:00:00Z',
      updated_at: '2026-08-16T00:00:00Z',
    })).toBeUndefined()
  })

  it('lists another user materials through the admin read-only endpoint', async () => {
    const response = { items: [], total: 0, page: 2, page_size: 12 }
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))

    await expect(listAdminUserMaterials('user/a', { page: 2, pageSize: 12, kind: 'image', keyword: ' 参考 ' })).resolves.toEqual(response)

    expect(authFetch).toHaveBeenCalledWith('/api/v1/admin/users/user%2Fa/materials?page=2&page_size=12&kind=image&keyword=%E5%8F%82%E8%80%83', { cache: 'no-store' })
  })
})
