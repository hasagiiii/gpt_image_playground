import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getTaskImageUrl } from './taskImageUrl'
import { removeTaskOutputImage } from './singleImageOperations'

const task: TaskRecord = {
  id: 'task-a', prompt: '', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: ['a', 'b'],
  status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1,
}

describe('getTaskImageUrl', () => {
  it('按 ID 读取直链，不受图片排序影响', () => {
    expect(getTaskImageUrl({ ...task, outputImageUrls: { b: 'https://cdn.example/b.png', a: 'https://cdn.example/a.png' } }, 'a')).toBe('https://cdn.example/a.png')
  })

  it('兼容逐项对应的旧图片 URL 列表和分层结果', () => {
    expect(getTaskImageUrl({ ...task, rawImageUrls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] }, 'b')).toBe('https://cdn.example/b.png')
    expect(getTaskImageUrl({ ...task, imageLayers: [{ url: 'https://cdn.example/a.png' }, { url: 'https://cdn.example/b.png' }] }, 'a')).toBe('https://cdn.example/a.png')
  })

  it('不把缺项列表或透明处理前的原图当作最终结果', () => {
    expect(getTaskImageUrl({ ...task, rawImageUrls: ['https://cdn.example/b.png'] }, 'a')).toBeUndefined()
    expect(getTaskImageUrl({ ...task, transparentOutput: true, rawImageUrls: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] }, 'a')).toBeUndefined()
    expect(getTaskImageUrl({ ...task, transparentOutput: true, outputImageUrls: { a: 'https://cdn.example/transparent.png' } }, 'a')).toBe('https://cdn.example/transparent.png')
  })

  it('删除图片时清理对应 URL，保留其他图片地址', () => {
    const next = removeTaskOutputImage({ ...task, outputImageUrls: { a: 'https://cdn.example/a.png', b: 'https://cdn.example/b.png' } }, 'a')!.task
    expect(next.outputImageUrls).toEqual({ b: 'https://cdn.example/b.png' })
    expect(getTaskImageUrl(next, 'a')).toBeUndefined()
    expect(getTaskImageUrl(next, 'b')).toBe('https://cdn.example/b.png')
  })
})
