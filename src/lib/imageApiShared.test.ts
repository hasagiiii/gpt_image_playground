import { describe, expect, it, vi } from 'vitest'
import { getApiErrorMessage, isModerationBlockedPayload, retryApiFetch } from './imageApiShared'

describe('moderation errors', () => {
  it('recognizes nested moderation_blocked error payloads', () => {
    expect(isModerationBlockedPayload({ error: { code: 'moderation_blocked' } })).toBe(true)
    expect(isModerationBlockedPayload({ error: { code: 'other_error' } })).toBe(false)
  })

  it('returns a Chinese prompt adjustment message', async () => {
    const response = new Response(JSON.stringify({
      error: {
        code: 'moderation_blocked',
        message: 'Your request was rejected by the safety system.',
      },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } })

    await expect(getApiErrorMessage(response)).resolves.toBe('提示词含有敏感内容，请调整输入提示重新生成。')
  })
})

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
