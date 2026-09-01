export type CanvasConnectionPoint = { x: number; y: number }

export type CanvasConnection = {
  id: string
  start: CanvasConnectionPoint
  end: CanvasConnectionPoint
}

export function getCanvasConnectionPoint(center: CanvasConnectionPoint, other: CanvasConnectionPoint, width: number, height: number) {
  const dx = other.x - center.x
  const dy = other.y - center.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    const side = dx >= 0 ? 1 : -1
    return { x: center.x + side * width / 2, y: center.y }
  }
  const side = dy >= 0 ? 1 : -1
  return { x: center.x, y: center.y + side * height / 2 }
}

export function getCanvasConnectionPath(start: CanvasConnectionPoint, end: CanvasConnectionPoint) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dy) < 0.5 || Math.abs(dx) < 0.5) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const offset = Math.max(28, Math.min(120, (horizontal ? Math.abs(dx) : Math.abs(dy)) * 0.45))
  const control = horizontal
    ? { x: Math.sign(dx || 1) * offset, y: (Math.sign(dy) || 1) * Math.max(18, offset * Math.tan(Math.PI / 6)) }
    : { x: (Math.sign(dx) || 1) * Math.max(18, offset * Math.tan(Math.PI / 6)), y: Math.sign(dy || 1) * offset }
  return `M ${start.x} ${start.y} C ${start.x + control.x} ${start.y + control.y}, ${end.x - control.x} ${end.y - control.y}, ${end.x} ${end.y}`
}
