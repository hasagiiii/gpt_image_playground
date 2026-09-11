import type { ProjectCanvasState, TaskRecord } from '../types'

/** 第一张图提供基准尺寸，absolute 为 [left, top, right, bottom]。 */
export function layoutImageLayers(canvas: ProjectCanvasState, tasks: TaskRecord[], anchors: Record<string, { x: number; y: number }> = {}): ProjectCanvasState {
  let items = canvas.items
  for (const task of tasks) {
    const layers = task.imageLayers
    if (!task.layerDecomposition || !layers?.length || task.outputImages.length !== layers.length) continue
    const base = items[task.outputImages[0]]
    const source = items[task.inputImageIds[0]] ?? base
    const position = anchors[task.id] ?? base
    // 已拼合的图层继续使用用户保存的坐标，不能在刷新时覆盖拖动、裁剪等编辑。
    if (!base || !source || !position || (base.operator?.aspectRatio && !anchors[task.id])) continue
    const size = /^([1-9]\d*)x([1-9]\d*)$/i.exec(layers[0].size ?? task.actualParamsByImage?.[task.outputImages[0]]?.size ?? '')
    if (!size) continue
    const width = Number(size[1])
    const height = Number(size[2])
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue
    const scale = source.width / width
    const order = layers.map((layer, index) => ({ index, z: layer.z_index ?? index })).sort((a, b) => a.z - b.z || a.index - b.index)
    const baseZ = Math.min(...task.outputImages.map((id) => items[id]?.z ?? base.z))
    const next = { ...items }
    for (const [rank, entry] of order.entries()) {
      const index = entry.index
      const imageId = task.outputImages[index]
      const item = items[imageId]
      if (!item) continue
      const layer = layers[index]
      const box = index === 0 ? [0, 0, width, height] : layer.bounding_box?.absolute
      if (!box || box.length !== 4 || !box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) continue
      const layerWidth = box[2] - box[0]
      const layerHeight = box[3] - box[1]
      const originalWidth = Number(/^([1-9]\d*)x[1-9]\d*$/i.exec(layer.size ?? task.actualParamsByImage?.[imageId]?.size ?? '')?.[1])
      next[imageId] = {
        ...item,
        name: layer.name || item.name,
        x: position.x + box[0] * scale,
        y: position.y + box[1] * scale,
        width: layerWidth * scale,
        z: baseZ + rank,
        rotation: 0,
        operator: {
          aspectRatio: layerWidth / layerHeight,
          ...(Number.isFinite(originalWidth) && originalWidth > 0 ? { originalWidth, scale: layerWidth * scale / originalWidth } : {}),
        },
      }
    }
    items = next
  }
  return items === canvas.items ? canvas : { ...canvas, items }
}
