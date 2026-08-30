import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Project, ProjectCanvasState, TaskRecord } from '../types'
import { ensureProjectCanvas, zoomCanvasViewport } from '../lib/projectCanvas'
import { ArrowDownIcon, ChevronLeftIcon, HomeIcon, ZoomInIcon, ZoomOutIcon } from './icons'

export default function AdminCanvasViewer({ project, tasks, images, onBack }: {
  project: Project
  tasks: TaskRecord[]
  images: Record<string, { dataUrl: string; width?: number; height?: number }>
  onBack: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewport: ProjectCanvasState['viewport'] } | null>(null)
  const [viewport, setViewport] = useState(project.canvas?.viewport ?? { x: 0, y: 0, scale: 1 })
  const canvas = useMemo(() => ensureProjectCanvas(project.canvas, tasks.flatMap((task) => task.outputImages)), [project.canvas, tasks])
  const imageIds = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.outputImages))), [tasks])
  const items = useMemo(() => imageIds.map((id) => ({ id, item: canvas.items[id], image: images[id] })).filter((entry) => entry.item), [canvas.items, imageIds, images])

  const zoom = (scale: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    const point = rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 0, y: 0 }
    setViewport(zoomCanvasViewport(viewport, point, scale))
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewport }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setViewport({ ...drag.viewport, x: drag.viewport.x + event.clientX - drag.x, y: drag.viewport.y + event.clientY - drag.y })
  }

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const factor = Math.exp(-event.deltaY * 0.0015)
    setViewport(zoomCanvasViewport(viewport, { x: event.clientX - rect.left, y: event.clientY - rect.top }, viewport.scale * factor))
  }

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col bg-gray-100 dark:bg-gray-950">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-gray-900">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="返回用户画布" title="返回用户画布"><ChevronLeftIcon className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{project.title || '未命名画布'}</h1><p className="text-xs text-gray-500">只读查看 · {items.length} 张图片</p></div>
        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">只读</span>
        <div className="flex items-center gap-1 border-l border-gray-200 pl-3 dark:border-white/[0.08]">
          <button type="button" onClick={() => setViewport({ ...viewport, x: 0, y: 0, scale: 1 })} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="重置视图" title="重置视图"><HomeIcon className="h-4 w-4" /></button>
          <button type="button" onClick={() => zoom(viewport.scale / 1.2)} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="缩小" title="缩小"><ZoomOutIcon className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs tabular-nums text-gray-500">{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoom(viewport.scale * 1.2)} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="放大" title="放大"><ZoomInIcon className="h-4 w-4" /></button>
        </div>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden border-x border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950" style={{ touchAction: 'none' }} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd} onWheel={handleWheel}>
        <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          {items.map(({ id, item, image }) => {
            const ratio = image?.width && image.height ? image.width / image.height : 1
            return <div key={id} className="absolute overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/10 dark:bg-gray-900 dark:ring-white/10" style={{ left: item!.x, top: item!.y, width: item!.width, height: item!.width / ratio, transform: `rotate(${item!.rotation ?? item!.operator?.rotation ?? 0}deg)` }}>
              {image?.dataUrl ? <img src={image.dataUrl} alt={item!.name ?? id} className="block h-full w-full object-contain" draggable={false} /> : <div className="flex h-full items-center justify-center text-xs text-gray-400">图片不可用</div>}
            </div>
          })}
        </div>
        {items.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">该画布暂无图片</div>}
        <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1 rounded-md bg-white/85 px-2 py-1 text-[11px] text-gray-500 shadow-sm backdrop-blur dark:bg-gray-900/85 dark:text-gray-400"><ArrowDownIcon className="h-3 w-3 rotate-90" />拖动画布仅影响当前查看</div>
      </div>
    </div>
  )
}
