import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type ImageLayer, type ProjectCanvasState, type TaskRecord } from '../types'
import { layoutImageLayers } from './imageLayerLayout'
import { ensureProjectCanvas, normalizeProjectCanvas } from './projectCanvas'

const layers: ImageLayer[] = [
  { url: 'https://files.test/base.png', size: '2000x2240', z_index: 0 },
  { url: 'https://files.test/sky.png', size: '2000x2146', z_index: 1, name: '蓝天光束背景', bounding_box: { absolute: [0, 0, 2000, 2146], normalized: [0, 0, 1000, 958] } },
  { url: 'https://files.test/left.png', size: '1534x1732', z_index: 2, name: '左侧遗迹残柱与绿植', bounding_box: { absolute: [45, 1453, 728, 2223], normalized: [23, 649, 364, 992] } },
  { url: 'https://files.test/right.png', size: '1587x1921', z_index: 3, bounding_box: { absolute: [1257, 1377, 1956, 2222] } },
  { url: 'https://files.test/altar.png', size: '3205x584', z_index: 4, bounding_box: { absolute: [81, 1902, 1936, 2240] } },
  { url: 'https://files.test/sword.png', size: '898x2247', z_index: 5, bounding_box: { absolute: [627, 113, 1380, 1997] } },
]
const task: TaskRecord = {
  id: 'layers', prompt: '分层', params: DEFAULT_PARAMS, inputImageIds: ['source'],
  outputImages: layers.map((_, index) => `layer-${index}`), imageLayers: layers, layerDecomposition: true,
  status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1,
}

function canvas(): ProjectCanvasState {
  return {
    version: 1, viewport: { x: 32, y: 32, scale: 1 },
    items: Object.fromEntries(task.outputImages.map((id, index) => [id, { x: 100 + index * 300, y: 200, width: 400, z: index + 8 }])),
  }
}

describe('分层图片坐标拼合', () => {
  it('按第一张图缩放 absolute 的左上角、宽和高，不使用 normalized 或图层原始分辨率定位', () => {
    const original = canvas()
    const result = layoutImageLayers(original, [task])
    expect(original.items['layer-2'].x).toBe(700)
    for (const [index, layer] of layers.entries()) {
      const box = index === 0 ? [0, 0, 2000, 2240] : layer.bounding_box!.absolute!
      const item = result.items[`layer-${index}`]
      expect(item.x).toBeCloseTo(100 + box[0] * 0.2)
      expect(item.y).toBeCloseTo(200 + box[1] * 0.2)
      expect(item.width).toBeCloseTo((box[2] - box[0]) * 0.2)
      expect(item.width / item.operator!.aspectRatio!).toBeCloseTo((box[3] - box[1]) * 0.2)
      expect(item.z).toBe(8 + index)
    }
    expect(result.items['layer-2'].operator?.scale).toBeCloseTo(136.6 / 1534)
    expect(result.items['layer-2'].name).toBe('左侧遗迹残柱与绿植')
  })

  it('以被分层的原图位置和宽度作为图层组锚点', () => {
    const original = canvas()
    original.items.source = { x: 1200, y: 640, width: 400, z: 0 }
    original.items['layer-0'].width = 240
    const result = layoutImageLayers(original, [task])

    expect(result.items['layer-0'].x).toBe(1200)
    expect(result.items['layer-0'].y).toBe(640)
    expect(result.items['layer-2'].x).toBeCloseTo(1200 + 45 * 0.2)
    expect(result.items['layer-2'].y).toBeCloseTo(640 + 1453 * 0.2)
    expect(result.items['layer-2'].width).toBeCloseTo((728 - 45) * 0.2)
  })

  it('按 z_index 而不是回包数组顺序叠放', () => {
    const reordered = { ...task, imageLayers: layers.map((layer, index) => ({ ...layer, z_index: index === 1 ? 5 : index === 5 ? 1 : index })) }
    const result = layoutImageLayers(canvas(), [reordered])
    expect(result.items['layer-1'].z).toBe(13)
    expect(result.items['layer-5'].z).toBe(9)
    const restored = ensureProjectCanvas(result, task.outputImages, {}, Object.fromEntries(task.outputImages.map((id, index) => [id, index])))
    expect(restored.items['layer-1'].z).toBe(13)
    expect(restored.items['layer-5'].z).toBe(9)
  })

  it('刷新时保留窄图层的缩放、宽高比及用户后续修改，不再次拼合', () => {
    const original = canvas()
    original.items['layer-0'].width = 100
    const result = layoutImageLayers(original, [task])
    result.items['layer-2'] = { ...result.items['layer-2'], x: -300, rotation: 45 }
    const restored = normalizeProjectCanvas(JSON.parse(JSON.stringify(result)))!
    expect(restored.items['layer-2'].width).toBeCloseTo(34.15)
    expect(restored.items['layer-2'].x).toBe(-300)
    expect(restored.items['layer-2'].rotation).toBe(45)
    expect(layoutImageLayers(restored, [task])).toBe(restored)
  })

  it('缺少基准尺寸或图层元数据时不猜测坐标', () => {
    const original = canvas()
    expect(layoutImageLayers(original, [{ ...task, imageLayers: layers.map((layer) => ({ ...layer, size: undefined })) }])).toBe(original)
    expect(layoutImageLayers(original, [{ ...task, imageLayers: layers.slice(1) }])).toBe(original)
    expect(layoutImageLayers(original, [{ ...task, layerDecomposition: false }])).toBe(original)
  })

  it.each([[10, 10, 5, 5], [0, 0, 0, 20], [1, 2, 3], [0, 0, Infinity, 100]].map((box) => [box]))('无效 absolute %j 不改动对应图层', (box) => {
    const original = canvas()
    const result = layoutImageLayers(original, [{ ...task, imageLayers: layers.map((layer, index) => index === 2 ? { ...layer, bounding_box: { absolute: box } } : layer) }])
    expect(result.items['layer-2']).toBe(original.items['layer-2'])
  })
})
