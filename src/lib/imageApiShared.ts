import type { AppSettings, ImageFailureEndpoint, ImageFailureKind, TaskOutputError, TaskParams } from '../types'
import { blobToDataUrl } from './dataUrl'

export const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export const MAX_MASK_EDIT_FILE_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_INPUT_PAYLOAD_BYTES = 512 * 1024 * 1024

export interface CallApiOptions {
  settings: AppSettings
  /** 当前任务的请求链路 ID */
  requestId?: string
  prompt: string
  params: TaskParams
  /** 输入图片的 data URL 列表 */
  inputImageDataUrls: string[]
  maskDataUrl?: string
  onFalRequestEnqueued?: (request: { requestId: string; endpoint: string }) => void
  onCustomTaskEnqueued?: (task: { taskId: string }) => void
  onImageStatusRequestCreated?: (request: { requestId: string; requestIndex?: number }) => void
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
}

export interface CallApiResult {
  /** base64 data URL 列表 */
  images: string[]
  /** API 返回的实际生效参数 */
  actualParams?: Partial<TaskParams>
  /** 每张图片对应的实际生效参数 */
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  /** 每张图片对应的 API 改写提示词 */
  revisedPrompts?: Array<string | undefined>
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 并发多图请求中失败的单张请求 */
  failedRequests?: TaskOutputError[]
  /** 图片是否已由后端写入在线项目 */
  imagesStoredOnline?: boolean
  /** 后端写入在线项目后的图片 ID */
  imageIds?: string[]
  /** 任务记录已交由项目后台异步保存 */
  taskRecordQueued?: boolean
  /** 上游返回的实际费用（美元） */
  actualCost?: number
}

export type ApiFailure = Error & {
  endpoint?: ImageFailureEndpoint
  kind?: ImageFailureKind
  status?: number
  requestId?: string
  retryCount?: number
}

export interface RetryApiFetchOptions {
  endpoint: ImageFailureEndpoint
  signal?: AbortSignal
  requestId?: string
  maxRetries?: number
  retryableStatuses?: number[]
}

const NETWORK_ERROR_PATTERN = /failed to fetch|fetch failed|load failed|networkerror|network request failed/i

export function isRetryableApiNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return NETWORK_ERROR_PATTERN.test(error.message)
  return error instanceof Error && NETWORK_ERROR_PATTERN.test(error.message)
}

function getRetryAfterDelay(response: Response, retryIndex: number): number {
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) return Math.min(5000, Math.max(0, seconds * 1000))
    const timestamp = Date.parse(retryAfter)
    if (Number.isFinite(timestamp)) return Math.min(5000, Math.max(0, timestamp - Date.now()))
  }
  return Math.min(1000, 50 * (2 ** retryIndex))
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) return
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, delayMs)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/** 网络断开或 429 时复用同一个请求标识，最多自动重试 3 次。 */
export async function retryApiFetch(
  request: () => Promise<Response>,
  options: RetryApiFetchOptions,
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3
  const retryableStatuses = options.retryableStatuses ?? [429]
  let retryCount = 0

  while (true) {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const response = await request()
      if (!retryableStatuses.includes(response.status) || retryCount >= maxRetries) {
        if (retryCount > 0) Object.defineProperty(response, 'retryCount', { configurable: true, value: retryCount })
        return response
      }
      void response.body?.cancel()
      await waitForRetry(getRetryAfterDelay(response, retryCount), options.signal)
      retryCount += 1
    } catch (error) {
      if (options.signal?.aborted || !isRetryableApiNetworkError(error) || retryCount >= maxRetries) {
        if (isRetryableApiNetworkError(error)) {
          const failure = Object.assign(error instanceof Error ? error : new Error(String(error)), {
            endpoint: options.endpoint,
            kind: 'network',
            requestId: options.requestId,
            retryCount,
          }) as ApiFailure
          throw failure
        }
        throw error
      }
      await waitForRetry(Math.min(1000, 50 * (2 ** retryCount)), options.signal)
      retryCount += 1
    }
  }
}

export function getApiResponseRetryCount(response: Response): number | undefined {
  const retryCount = (response as Response & { retryCount?: unknown }).retryCount
  return typeof retryCount === 'number' && Number.isFinite(retryCount) ? retryCount : undefined
}

export function withApiFailureMetadata(
  error: Error,
  metadata: Pick<ApiFailure, 'endpoint' | 'kind' | 'status' | 'requestId' | 'retryCount'>,
): ApiFailure {
  return Object.assign(error, metadata)
}

export function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function isImageDownloadFailure(endpoint: ImageFailureEndpoint | undefined, error?: string | null) {
  return endpoint === 'download' || /图片(?:链接| URL)\s*下载失败/i.test(error ?? '')
}

export function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

export function normalizeBase64Image(value: string, fallbackMime: string): string {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

export function createImageStatusRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `img_${crypto.randomUUID().replace(/-/g, '')}`
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return `img_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
  }

  return `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

export function getDataUrlEncodedByteSize(dataUrl: string): number {
  return dataUrl.length
}

export function getDataUrlDecodedByteSize(dataUrl: string): number {
  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex < 0) return dataUrl.length

  const meta = dataUrl.slice(0, commaIndex)
  const payload = dataUrl.slice(commaIndex + 1)
  if (!/;base64/i.test(meta)) return decodeURIComponent(payload).length

  const normalized = payload.replace(/\s/g, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function assertMaxBytes(label: string, bytes: number, maxBytes: number) {
  if (bytes > maxBytes) {
    throw new Error(`${label}过大：${formatMiB(bytes)}，上限为 ${formatMiB(maxBytes)}`)
  }
}

export function assertImageInputPayloadSize(bytes: number) {
  assertMaxBytes('图像输入有效负载总大小', bytes, MAX_IMAGE_INPUT_PAYLOAD_BYTES)
}

export function assertMaskEditFileSize(label: string, bytes: number) {
  assertMaxBytes(label, bytes, MAX_MASK_EDIT_FILE_BYTES)
}

export const IMAGE_FETCH_CORS_HINT = ' 可点链接按钮复制结果链接，或尝试开启「返回 Base64 图片数据」避免此问题。'
export const STREAMING_UNSUPPORTED_HINT = '提示：当前使用的 API 可能不支持流式传输，请尝试关闭「流式传输」功能。'
export const STREAMING_FORMAT_HINT = '提示：API 返回了无法解析的流式数据格式，请尝试关闭「流式传输」功能。'

export function appendStreamingUnsupportedHint(message: string): string {
  return message ? `${message}\n${STREAMING_UNSUPPORTED_HINT}` : STREAMING_UNSUPPORTED_HINT
}

export function appendStreamingFormatHint(message: string): string {
  return message ? `${message}\n${STREAMING_FORMAT_HINT}` : STREAMING_FORMAT_HINT
}

/** 排除明确与流式无关的状态码后追加提示 */
export function maybeAppendStreamingHint(message: string, status: number, streamImages?: boolean): string {
  if (!streamImages) return message
  if (status === 401 || status === 403 || status === 404 || status === 408 || status === 429 || status >= 500) {
    return message
  }
  return appendStreamingUnsupportedHint(message)
}

async function probeNoCorsReachability(url: string, timeoutMs = 8000): Promise<'opaque' | 'reachable' | 'failed'> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.type === 'opaque' ? 'opaque' : 'reachable'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchImageUrlAsDataUrl(url: string, fallbackMime: string, signal?: AbortSignal): Promise<string> {
  if (isDataUrl(url)) return url

  let response: Response
  try {
    response = await retryApiFetch(
      () => fetch(url, {
        cache: 'no-store',
        signal,
      }),
      { endpoint: 'download', signal },
    )
  } catch (err) {
    if (err instanceof TypeError) {
      const retryCount = typeof (err as ApiFailure).retryCount === 'number' ? (err as ApiFailure).retryCount : undefined
      const probe = await probeNoCorsReachability(url)
      if (probe === 'opaque') {
        throw withApiFailureMetadata(new Error(`图片已生成，但因服务商未允许跨域，图片链接下载失败。${IMAGE_FETCH_CORS_HINT}`), { endpoint: 'download', kind: 'network', retryCount })
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        throw withApiFailureMetadata(new Error(`图片链接下载失败（网络不可用）。${IMAGE_FETCH_CORS_HINT}`), { endpoint: 'download', kind: 'network', retryCount })
      }
      throw withApiFailureMetadata(new Error(`图片链接下载失败（可能因跨域限制、链接过期或网络异常）。${IMAGE_FETCH_CORS_HINT}`), { endpoint: 'download', kind: 'network', retryCount })
    }
    throw err
  }

  if (!response.ok) {
    throw withApiFailureMetadata(new Error(`图片 URL 下载失败：HTTP ${response.status}`), { endpoint: 'download', status: response.status })
  }

  const blob = await response.blob()
  return blobToDataUrl(blob, fallbackMime)
}

export async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMsg = `HTTP ${response.status}`
  const textResponse = response.clone()
  try {
    const errJson = await response.json()
    if (errJson.error?.message) errorMsg = errJson.error.message
    else if (typeof errJson.detail === 'string') errorMsg = errJson.detail
    else if (Array.isArray(errJson.detail)) errorMsg = errJson.detail.map((item: unknown) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
    else if (typeof errJson.error === 'string') errorMsg = errJson.error
    else if (errJson.message) errorMsg = errJson.message
  } catch {
    try {
      errorMsg = await textResponse.text()
    } catch {
      /* ignore */
    }
  }
  return errorMsg
}

export function pickActualParams(source: unknown): Partial<TaskParams> {
  if (!source || typeof source !== 'object') return {}
  const record = source as Record<string, unknown>
  const actualParams: Partial<TaskParams> = {}

  if (typeof record.size === 'string') actualParams.size = record.size
  if (record.quality === 'auto' || record.quality === 'low' || record.quality === 'medium' || record.quality === 'high') {
    actualParams.quality = record.quality
  }
  if (record.output_format === 'png' || record.output_format === 'jpeg' || record.output_format === 'webp') {
    actualParams.output_format = record.output_format
  }
  if (typeof record.output_compression === 'number') actualParams.output_compression = record.output_compression
  if (record.moderation === 'auto' || record.moderation === 'low') actualParams.moderation = record.moderation
  if (typeof record.n === 'number') actualParams.n = record.n

  return actualParams
}

export function mergeActualParams(...sources: Array<Partial<TaskParams> | undefined>): Partial<TaskParams> | undefined {
  const merged = Object.assign({}, ...sources.filter((source) => source && Object.keys(source).length))
  return Object.keys(merged).length ? merged : undefined
}
