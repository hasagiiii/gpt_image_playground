import { beforeEach, describe, expect, it, vi } from 'vitest'

const authFetch = vi.hoisted(() => vi.fn())

vi.mock('../auth/api', () => ({ authFetch }))

import { fetchActiveAnnouncement } from './announcements'

describe('fetchActiveAnnouncement', () => {
  beforeEach(() => {
    authFetch.mockReset()
  })

  it('复用并发请求，避免 StrictMode 重复加载公告', async () => {
    authFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'announcement-1' }), { status: 200 }))

    const [first, second] = await Promise.all([
      fetchActiveAnnouncement(),
      fetchActiveAnnouncement(),
    ])

    expect(first).toEqual(second)
    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(authFetch).toHaveBeenCalledWith('/api/v1/announcements/active', { cache: 'no-store' })
  })
})
