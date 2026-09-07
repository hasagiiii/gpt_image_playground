import type { ImageFailureEndpoint, ImageLayer, TaskParams } from '../types'
import { authFetch, createRequestId } from '../auth/api'
import { uploadReferenceFile } from './backendCompositeImageApi'
import { fetchImageUrlAsDataUrl, getApiResponseRetryCount, MIME_MAP, retryApiFetch, withApiFailureMetadata, type ApiFailure, type CallApiResult } from './imageApiShared'

export const SEEDREAM_LAYER_MODEL = 'doubao-seedream-5-0-pro-260628'
export const DEFAULT_LAYER_PROMPT = '将参考图片拆分为独立的背景和前景图层，保持各元素的原始外观。'

interface SeedreamOptions {
  apiKey: string
  model?: string
  baseUrl?: string
  timeout?: number
  params: TaskParams
  prompt?: string
  image?: string
  watermark?: boolean
  size?: string
  requestId?: string
  clientRequestId?: string
  idempotencyKey?: string
  signal?: AbortSignal
  onRequestCreated?: (request: { requestId: string }) => void | Promise<void>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function parseSeedreamLayers(payload: unknown) {
  const root = record(payload)
  const result = record(root.result ?? record(root.data).result ?? (Array.isArray(root.data) ? root : root.data) ?? root)
  if (!Array.isArray(result.data) || result.data.length === 0) throw new Error('Seedream 未返回图层 data')
  const layers = result.data.map((value, index): ImageLayer => {
    const item = record(value)
    if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url.trim())) throw new Error(`Seedream 第 ${index + 1} 个图层缺少有效 URL`)
    const box = record(item.bounding_box)
    const absolute = Array.isArray(box.absolute) && box.absolute.every((n) => typeof n === 'number' && Number.isFinite(n)) ? box.absolute as number[] : undefined
    const normalized = Array.isArray(box.normalized) && box.normalized.every((n) => typeof n === 'number' && Number.isFinite(n)) ? box.normalized as number[] : undefined
    return {
      url: item.url.trim(),
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      ...(typeof item.output_format === 'string' ? { output_format: item.output_format } : {}),
      ...(typeof item.size === 'string' ? { size: item.size } : {}),
      ...(typeof item.z_index === 'number' && Number.isFinite(item.z_index) ? { z_index: item.z_index } : {}),
      ...(absolute || normalized ? { bounding_box: { absolute, normalized } } : {}),
    }
  })
  const usage = Object.fromEntries(Object.entries(record(result.usage)).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
  return { layers, usage }
}

/** baseUrl 留空时走已有 Go 代理；直连时传网关根地址或 /api/v1 地址。 */
export async function callSeedreamLayers(options: SeedreamOptions): Promise<CallApiResult> {
  if (!options.apiKey.trim()) throw new Error('请先选择 API Key')
  if (!options.requestId && (!options.image || !options.prompt?.trim())) throw new Error('分层需要一张参考图片和提示词')
  const model = options.model ?? SEEDREAM_LAYER_MODEL
  if (!model.trim() || model.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('无效的 Seedream 模型 ID')
  const timeout = options.timeout ?? 600
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('分层超时必须为正数')
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timer = setTimeout(() => controller.abort(new Error('Seedream 分层任务超时')), timeout * 1000)
  const signal = controller.signal
  let phase: ImageFailureEndpoint = options.requestId ? 'status' : 'edit'
  const clientRequestId = options.clientRequestId ?? createRequestId()
  const base = options.baseUrl?.replace(/\/+$/, '')
  const path = `${base ? `${base.replace(/\/api\/v1$/, '')}/api/v1` : '/api/v1'}/model/${model.split('/').map(encodeURIComponent).join('/')}`
  const request = async (url: string, body?: Record<string, unknown>) => {
    const endpoint = body ? 'edit' : 'status'
    const response = await retryApiFetch(() => (base ? fetch : authFetch)(url, {
      method: body ? 'POST' : 'GET',
      signal,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(base ? { Authorization: `Bearer ${options.apiKey}` } : { 'X-Upstream-API-Key': options.apiKey }),
        'X-Request-ID': clientRequestId,
        ...(body ? { 'Idempotency-Key': options.idempotencyKey ?? clientRequestId } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }), { endpoint, signal, requestId: clientRequestId, maxRetries: 3, retryableStatuses: Array.from({ length: 100 }, (_, index) => 500 + index) })
    const text = await response.text()
    if (!response.ok) throw withApiFailureMetadata(new Error(`Seedream HTTP ${response.status}: ${text}`), { endpoint, status: response.status, requestId: clientRequestId, retryCount: getApiResponseRetryCount(response) })
    try {
      return record(JSON.parse(text))
    } catch {
      throw new Error('Seedream 返回了无效的 JSON')
    }
  }
  try {
    let requestId = options.requestId
    if (!requestId) {
      const image = base ? options.image! : (await uploadReferenceFile(options.image!, 'layer-reference', clientRequestId, signal)).url
      const submitted = await request(path, {
        image: [image],
        prompt: options.prompt,
        layer_decomposition: true,
        output_format: options.params.output_format,
        response_format: 'url',
        size: options.size ?? 'auto',
        watermark: options.watermark ?? true,
      })
      requestId = typeof submitted.request_id === 'string' ? submitted.request_id.trim() : ''
      if (!requestId) throw new Error('Seedream 未返回 request_id')
      await options.onRequestCreated?.({ requestId })
    }
    const resultPath = `${path}/requests/${encodeURIComponent(requestId)}`
    phase = 'status'
    let interval = 2000
    while (true) {
      const status = await request(resultPath)
      const state = status.status ?? record(status.data).status
      if (state === 'FAILED' || state === 'CANCELED') throw withApiFailureMetadata(new Error(`Seedream ${state}: ${JSON.stringify(status)}`), { endpoint: 'result' })
      if (state === 'COMPLETED') break
      if (state !== 'IN_QUEUE' && state !== 'IN_PROGRESS') throw new Error(`Seedream 返回未知状态：${String(state)}`)
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(wait); reject(signal.reason) }
        const wait = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, interval)
        if (signal.aborted) cancel()
        else signal.addEventListener('abort', cancel, { once: true })
      })
      interval = Math.min(interval * 2, 15000)
    }
    phase = 'result'
    const payload = await request(resultPath)
    const finalStatus = payload.status ?? record(payload.data).status
    if (finalStatus !== undefined && finalStatus !== 'COMPLETED') throw new Error(`Seedream 最终结果未完成：${String(finalStatus)}`)
    const { layers, usage } = parseSeedreamLayers(payload)
    const urls = layers.map((layer) => layer.url)
    phase = 'download'
    try {
      const images = await Promise.all(layers.map((layer) => fetchImageUrlAsDataUrl(layer.url, MIME_MAP[layer.output_format ?? options.params.output_format] ?? 'image/png', signal)))
      return { images, rawImageUrls: urls, imageLayers: layers, layerUsage: usage, actualParams: { ...options.params, n: images.length } }
    } catch (err) {
      if (err instanceof Error) Object.assign(err, { rawImageUrls: urls, imageLayers: layers, layerUsage: usage })
      throw err
    }
  } catch (err) {
    console.warn('Seedream 分层失败', err)
    const error = signal.aborted ? signal.reason : err
    const failure: ApiFailure = error instanceof Error ? error : new Error(String(error))
    throw withApiFailureMetadata(failure, { endpoint: failure.endpoint ?? phase })
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}
