// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaterialItem } from '../lib/materialApi'

vi.mock('../lib/materialApi', async (original) => ({
  ...await original<typeof import('../lib/materialApi')>(),
  listMaterials: vi.fn(),
  uploadMaterialFile: vi.fn(),
}))
vi.mock('../hooks/useDragSelect', () => ({ useDragSelect: () => ({ selectionBox: null }) }))

import { listMaterials, uploadMaterialFile } from '../lib/materialApi'
import MaterialLibrary from './MaterialLibrary'

const item: MaterialItem = {
  id: 'material-a', account_id: 'account-a', file_name: 'transparent.png',
  url: 'https://files.test/transparent.png', content_type: 'image/png', size_bytes: 100,
  kind: 'image', source: 'upload', created_at: '2026-09-06T00:00:00Z',
}

describe('素材库文件上传', () => {
  let host: HTMLDivElement
  let root: Root

  const selectFiles = async (files: File[]) => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    // 模拟浏览器的动态 FileList：value 清空时，同一个列表也随之清空。
    const values = [...files]
    Object.defineProperty(input, 'files', { configurable: true, get: () => values })
    Object.defineProperty(input, 'value', { configurable: true, get: () => '', set: () => { values.length = 0 } })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(values).toHaveLength(0)
  }

  beforeEach(async () => {
    vi.mocked(listMaterials).mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 24 })
    vi.mocked(uploadMaterialFile).mockReset().mockResolvedValue(item)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => root.render(<MaterialLibrary />))
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it('选取图片后发送上传请求并刷新显示新素材', async () => {
    const file = new File(['png'], 'transparent.png', { type: 'image/png' })
    vi.mocked(listMaterials).mockResolvedValueOnce({ items: [item], total: 1, page: 1, page_size: 24 })
    await selectFiles([file])
    expect(uploadMaterialFile).toHaveBeenCalledWith(file)
    expect(listMaterials).toHaveBeenCalledTimes(2)
    expect(host.querySelector('img')?.getAttribute('src')).toBe(item.url)
    expect(host.textContent).toContain('transparent.png')
  })

  it('支持多文件和再次选择同一张图片', async () => {
    const first = new File(['one'], 'first.png', { type: 'image/png' })
    const second = new File(['two'], 'second.png', { type: 'image/png' })
    await selectFiles([first, second])
    await selectFiles([first])
    expect(vi.mocked(uploadMaterialFile).mock.calls.map(([file]) => file)).toEqual([first, second, first])
  })

  it('取消文件选择不会发送请求或显示错误', async () => {
    await selectFiles([])
    expect(uploadMaterialFile).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('只支持上传图片文件')
  })

  it('上传期间禁用按钮，失败时显示原因并恢复按钮', async () => {
    let reject!: (err: Error) => void
    vi.mocked(uploadMaterialFile).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    await selectFiles([new File(['png'], 'test.png', { type: 'image/png' })])
    const button = [...host.querySelectorAll('button')].find((el) => el.textContent?.includes('上传中...'))!
    expect(button.disabled).toBe(true)
    await act(async () => reject(new Error('上传失败：存储空间不足')))
    expect(button.disabled).toBe(false)
    expect(button.textContent).toContain('上传素材')
    expect(host.textContent).toContain('上传失败：存储空间不足')
  })
})
