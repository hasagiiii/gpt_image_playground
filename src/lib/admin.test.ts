import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { OnlineProjectImageResponse } from './onlineProjects'

const authFetch = vi.hoisted(() => vi.fn())

vi.mock('../auth/api', () => ({ authFetch }))

import { downloadAdminUserProjectImage, listAdminUserMaterials } from './admin'

describe('admin', () => {
  beforeEach(() => {
    authFetch.mockReset()
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

    const result = await downloadAdminUserProjectImage('user-a', 'project-a', image)

    expect(result).toEqual({
      id: 'image-a',
      dataUrl: 'https://cdn.example/image-a.png',
      source: 'generated',
      width: 1024,
      height: 768,
      createdAt: Date.parse('2026-08-16T00:00:00Z'),
    })
    expect(authFetch).not.toHaveBeenCalled()
  })

  it('lists another user materials through the admin read-only endpoint', async () => {
    const response = { items: [], total: 0, page: 2, page_size: 12 }
    authFetch.mockResolvedValueOnce(new Response(JSON.stringify(response), { status: 200 }))

    await expect(listAdminUserMaterials('user/a', { page: 2, pageSize: 12, kind: 'image', keyword: ' 参考 ' })).resolves.toEqual(response)

    expect(authFetch).toHaveBeenCalledWith('/api/v1/admin/users/user%2Fa/materials?page=2&page_size=12&kind=image&keyword=%E5%8F%82%E8%80%83', { cache: 'no-store' })
  })
})
