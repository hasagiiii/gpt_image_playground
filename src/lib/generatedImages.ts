import type { Project } from '../types'
import { getImage, putImage, safeCreateImageThumbnail, storeImageWithSize } from './db'
import { uploadOnlineProjectImage } from './onlineProjects'

/** 生图、分层、透明处理及流式图片都先取得后端 ID，再写入本地缓存。 */
export async function storeGeneratedImage(project: Project | undefined, taskId: string, dataUrl: string, opts: { id?: string; remoteUrl?: string } = {}) {
  if (project?.storage !== 'online') throw new Error('生成图片必须保存到在线项目')
  const thumbnail = await safeCreateImageThumbnail(dataUrl)
  const image = opts.id !== undefined
    ? { image_id: opts.id, image_url: opts.remoteUrl }
    : await uploadOnlineProjectImage(project.remoteId ?? project.id, taskId, {
        dataUrl,
        remoteUrl: opts.remoteUrl,
        source: 'generated',
        width: thumbnail.width,
        height: thumbnail.height,
      })
  if (typeof image.image_id !== 'string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(image.image_id)) {
    throw new Error('后端没有返回有效的图片 ID')
  }
  const stored = await storeImageWithSize(dataUrl, 'generated', { preferredId: image.image_id, thumbnail })
  if (image.image_url) {
    await putImage({ ...await getImage(stored.id), ...stored, dataUrl, remoteUrl: image.image_url, source: 'generated' })
  }
  return { ...stored, remoteUrl: image.image_url }
}
