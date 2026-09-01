import { describe, expect, it, vi } from 'vitest'
import { retryApiFetch } from './imageApiShared'

describe('retryApiFetch', () => {
  it('retries Failed to fetch three times and preserves failure metadata', async () => {
    const request = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(retryApiFetch(request, { endpoint: 'generation', requestId: 'image-request-a' })).rejects.toMatchObject({
      message: 'Failed to fetch',
      endpoint: 'generation',
      kind: 'network',
      requestId: 'image-request-a',
      retryCount: 3,
    })
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('retries HTTP 429 three times before returning the response', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))

    const response = await retryApiFetch(request, { endpoint: 'generation' })

    expect(response.status).toBe(200)
    expect(request).toHaveBeenCalledTimes(4)
  })
})
