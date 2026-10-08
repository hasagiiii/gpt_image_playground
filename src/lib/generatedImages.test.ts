import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../types'
import { getImage, putImage, safeCreateImageThumbnail, storeImageWithSize } from './db'
import { uploadOnlineProjectImage } from './onlineProjects'
import { storeGeneratedImage } from './generatedImages'

vi.mock('./db', () => ({
  getImage: vi.fn(),
  putImage: vi.fn(),
  safeCreateImageThumbnail: vi.fn(),
  storeImageWithSize: vi.fn(),
}))
vi.mock('./onlineProjects', () => ({ uploadOnlineProjectImage: vi.fn() }))

const project: Project = { id: 'local-project', remoteId: 'remote-project', storage: 'online', title: '测试', initialPrompt: '', createdAt: 1, updatedAt: 1 }
const dataUrl = 'data:image/png;base64,AA=='

describe('storeGeneratedImage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(safeCreateImageThumbnail).mockResolvedValue({ width: 1200, height: 800 })
    vi.mocked(storeImageWithSize).mockImplementation(async (_dataUrl, _source, opts) => {
      if (!opts?.preferredId) throw new Error('不允许前端分配图片 ID')
      return { id: opts.preferredId, width: 1200, height: 800 }
    })
  })

  it('caches the generation response ID without uploading or allocating another ID', async () => {
    vi.mocked(getImage).mockResolvedValue({ id: 'backend-id', dataUrl, createdAt: 123 })
    const stored = await storeGeneratedImage(project, 'task-a', dataUrl, { id: 'backend-id', remoteUrl: 'https://cdn.example/a.png' })
    expect(stored.id).toBe('backend-id')
    expect(uploadOnlineProjectImage).not.toHaveBeenCalled()
    expect(storeImageWithSize).toHaveBeenCalledWith(dataUrl, 'generated', expect.objectContaining({ preferredId: 'backend-id' }))
    expect(putImage).toHaveBeenCalledWith(expect.objectContaining({ id: 'backend-id', createdAt: 123, remoteUrl: 'https://cdn.example/a.png' }))
  })

  it('waits for backend registration before caching Composite, layer or processed images', async () => {
    vi.mocked(uploadOnlineProjectImage).mockImplementationOnce(async (_projectId, _taskId, image) => {
      expect(image.id).toBeUndefined()
      expect(storeImageWithSize).not.toHaveBeenCalled()
      return { project_id: 'remote-project', image_id: 'assigned-id', image_url: 'https://cdn.example/new.png', mime_type: 'image/png', image_size: 1, image_sha256: 'hash', created_at: '', updated_at: '' }
    })
    const stored = await storeGeneratedImage(project, 'task-a', dataUrl, { remoteUrl: 'https://cdn.example/new.png' })
    expect(stored.id).toBe('assigned-id')
    expect(uploadOnlineProjectImage).toHaveBeenCalledWith('remote-project', 'task-a', {
      dataUrl, remoteUrl: 'https://cdn.example/new.png', source: 'generated', width: 1200, height: 800,
    })
    expect(storeImageWithSize).toHaveBeenCalledWith(dataUrl, 'generated', expect.objectContaining({ preferredId: 'assigned-id' }))
  })

  it('does not create a local output when backend registration fails', async () => {
    vi.mocked(uploadOnlineProjectImage).mockRejectedValueOnce(new Error('保存失败'))
    await expect(storeGeneratedImage(project, 'task-a', dataUrl)).rejects.toThrow('保存失败')
    expect(storeImageWithSize).not.toHaveBeenCalled()
    expect(putImage).not.toHaveBeenCalled()
  })

  it.each(['', ' ', 'invalid/id'])('rejects an invalid supplied ID instead of allocating one: %j', async (id) => {
    await expect(storeGeneratedImage(project, 'task-a', dataUrl, { id })).rejects.toThrow('后端没有返回有效的图片 ID')
    expect(storeImageWithSize).not.toHaveBeenCalled()
    expect(uploadOnlineProjectImage).not.toHaveBeenCalled()
  })
})
