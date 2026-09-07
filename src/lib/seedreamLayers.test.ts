import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'

vi.mock('../auth/api', () => ({ authFetch: vi.fn(), createRequestId: () => 'client-id' }))
vi.mock('./backendCompositeImageApi', () => ({ uploadReferenceFile: vi.fn(async (image: string) => ({ url: image })) }))
vi.mock('./imageApiShared', async (original) => ({
  ...await original<typeof import('./imageApiShared')>(),
  fetchImageUrlAsDataUrl: vi.fn(async (url: string) => `data:image/png;base64,${url}`),
}))

import { authFetch } from '../auth/api'
import { fetchImageUrlAsDataUrl } from './imageApiShared'
import { callSeedreamLayers, parseSeedreamLayers, SEEDREAM_LAYER_MODEL } from './seedreamLayers'

const opts = { apiKey: 'selected-key', image: 'https://files.test/source.png', prompt: '拆分图片', params: DEFAULT_PARAMS }
const payload = {
  data: [
    { url: 'https://files.test/background.png', name: '背景', z_index: 0 },
    { url: 'https://files.test/foreground.png', name: '主体', z_index: 1, bounding_box: { absolute: [10, 20, 100, 200], normalized: [0.1, 0.2, 0.5, 0.5] } },
  ],
  usage: { generated_images: 2, input_images: 1, output_tokens: 20 },
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })

describe('Seedream 分层协议', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('提交单图、退避轮询，并在完成后另取最终 payload', async () => {
    vi.mocked(authFetch)
      .mockResolvedValueOnce(json({ request_id: 'request/1' }))
      .mockResolvedValueOnce(json({ status: 'IN_QUEUE', ...payload }))
      .mockResolvedValueOnce(json({ status: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(json({ status: 'COMPLETED' }))
      .mockResolvedValueOnce(json({ status: 'COMPLETED', result: payload }))
    const created = vi.fn()
    const resultPromise = callSeedreamLayers({ ...opts, onRequestCreated: created })
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImageUrlAsDataUrl).not.toHaveBeenCalled()
    expect(authFetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(authFetch).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(4000)
    const result = await resultPromise
    expect(result.imageLayers).toEqual(payload.data)
    expect(result.layerUsage).toEqual(payload.usage)
    expect(created).toHaveBeenCalledWith({ requestId: 'request/1' })
    expect(authFetch).toHaveBeenCalledTimes(5)
    const [url, init] = vi.mocked(authFetch).mock.calls[0]
    expect(url).toBe(`/api/v1/model/${SEEDREAM_LAYER_MODEL}`)
    expect(init?.headers).toMatchObject({ 'X-Upstream-API-Key': opts.apiKey, 'Idempotency-Key': 'client-id' })
    expect(JSON.parse(init?.body as string)).toEqual({
      image: [opts.image], prompt: opts.prompt, layer_decomposition: true,
      output_format: 'png', response_format: 'url', size: 'auto', watermark: true,
    })
    expect(vi.mocked(authFetch).mock.calls[4][0]).toContain('/requests/request%2F1')
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([400, 401, 429])('HTTP %s 不重试并保留响应体', async (status) => {
    vi.mocked(authFetch).mockResolvedValueOnce(new Response('upstream detail', { status }))
    await expect(callSeedreamLayers(opts)).rejects.toThrow(`HTTP ${status}: upstream detail`)
    expect(authFetch).toHaveBeenCalledTimes(1)
  })

  it.each(['FAILED', 'CANCELED', 'UNKNOWN'])('终态或未知状态 %s 不读取产物', async (status) => {
    vi.mocked(authFetch).mockResolvedValueOnce(json({ status, ...payload }))
    await expect(callSeedreamLayers({ ...opts, requestId: 'existing' })).rejects.toThrow(status)
    expect(authFetch).toHaveBeenCalledTimes(1)
    expect(fetchImageUrlAsDataUrl).not.toHaveBeenCalled()
  })

  it.each(['network', 'server'])('%s 错误最多重试三次且保持幂等键', async (kind) => {
    if (kind === 'network') vi.mocked(authFetch).mockRejectedValue(new TypeError('Failed to fetch'))
    else vi.mocked(authFetch).mockImplementation(async () => new Response('overloaded', { status: 503 }))
    const pending = expect(callSeedreamLayers(opts)).rejects.toThrow(kind === 'network' ? 'Failed to fetch' : 'HTTP 503')
    await vi.runAllTimersAsync()
    await pending
    expect(authFetch).toHaveBeenCalledTimes(4)
    for (const [, init] of vi.mocked(authFetch).mock.calls) expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'client-id' })
  })

  it('轮询达到总超时后退出', async () => {
    vi.mocked(authFetch).mockImplementation(async () => json({ status: 'IN_PROGRESS' }))
    const pending = expect(callSeedreamLayers({ ...opts, requestId: 'existing', timeout: 3 })).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(3000)
    await pending
    expect(vi.getTimerCount()).toBe(0)
  })

  it('总超时也中断未返回的网络请求', async () => {
    vi.mocked(authFetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const pending = expect(callSeedreamLayers({ ...opts, requestId: 'existing', timeout: 1 })).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(1000)
    await pending
  })

  it('直连使用可配置地址、模型和 Bearer Key，恢复时不重复提交', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json({ status: 'COMPLETED' })).mockResolvedValueOnce(json(payload))
    vi.stubGlobal('fetch', fetch)
    await callSeedreamLayers({ ...opts, baseUrl: 'https://gateway.test/api/v1/', model: 'custom-model', requestId: 'existing' })
    expect(authFetch).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledWith('https://gateway.test/api/v1/model/custom-model/requests/existing', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer selected-key' }) }))
  })

  it('校验图层并保留边界框，支持常见结果包装', () => {
    for (const input of [payload, { result: payload }, { data: payload }, { data: { result: payload } }]) {
      expect(parseSeedreamLayers(input).layers).toEqual(payload.data)
    }
    expect(() => parseSeedreamLayers({ data: [] })).toThrow('data')
    expect(() => parseSeedreamLayers({ data: [{ url: 'javascript:bad' }] })).toThrow('URL')
  })
})
