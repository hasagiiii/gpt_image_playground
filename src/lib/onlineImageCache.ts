import { getImage, putImage } from './db'
import { downloadOnlineProjectImage, listOnlineProjectImages } from './onlineProjects'

const pendingLists = new Map<string, ReturnType<typeof listOnlineProjectImages>>()

/** 同一画布的多个缓存缺失共享一次列表请求，展示只恢复 URL，不下载图片字节。 */
export async function restoreOnlineImage(projectId: string, imageId: string) {
  let pending = pendingLists.get(projectId)
  if (!pending) {
    pending = listOnlineProjectImages(projectId).finally(() => pendingLists.delete(projectId))
    pendingLists.set(projectId, pending)
  }
  const remote = (await pending).find((image) => image.image_id === imageId)
  if (!remote?.image_url) return undefined
  const image = await downloadOnlineProjectImage(projectId, remote)
  if (!image) return undefined
  try {
    // 请求期间可能已有生成结果写入本地，保留其图片内容和附加信息。
    const existing = await getImage(imageId)
    await putImage({ ...image, ...existing, dataUrl: existing?.dataUrl || image.dataUrl, remoteUrl: image.remoteUrl })
  } catch (err) {
    console.warn('图片 URL 缓存写入失败，继续使用远程图片展示', err)
  }
  return image
}
