import type { TaskRecord } from '../types'

export function getTaskImageUrl(task: TaskRecord, imageId: string) {
  const index = task.outputImages.indexOf(imageId)
  if (index < 0) return undefined
  const saved = task.outputImageUrls?.[imageId]
  if (typeof saved === 'string' && /^https?:\/\//i.test(saved)) return saved
  // 透明处理后的结果不能回退到处理前的原图；旧多图列表只有逐项对应时才能使用。
  if (task.transparentOutput) return undefined
  const url = task.imageLayers?.length === task.outputImages.length
    ? task.imageLayers[index]?.url
    : task.rawImageUrls?.length === task.outputImages.length && !task.outputErrors?.length
      ? task.rawImageUrls[index]
      : undefined
  return typeof url === 'string' && /^https?:\/\//i.test(url) ? url : undefined
}
