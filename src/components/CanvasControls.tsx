import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProjectCanvasViewport } from '../types'
import { clampCanvasScale, zoomCanvasViewport } from '../lib/projectCanvas'
import { formatDurationMs } from '../lib/formatDuration'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, ExportIcon, HomeIcon, ImageIcon, InfoIcon, LayersIcon, MapIcon, WarningIcon } from './icons'

const CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY = 'gpt-image-playground:canvas-zoom-controls-collapsed'

export type CanvasControlLayer = {
  id: string
  label: string
  status: 'done' | 'running' | 'error'
  x: number
  y: number
  width: number
  height: number
  z: number
  /** 生成任务创建时间（ms） */
  createdAt?: number
  /** 生成耗时（ms） */
  elapsed?: number | null
  /** 用于取缩略图的 image store id；只读画布没有本地库时改用 thumbnailSrc */
  imageId?: string
  /** 直接可用的预览地址，优先于 imageId */
  thumbnailSrc?: string
}

/** 订阅缩略图，返回取消订阅函数。由父组件注入，避免本组件依赖 store。 */
export type CanvasControlsThumbnailSubscriber = (imageId: string, onChange: (dataUrl: string) => void) => () => void

const LAYER_TIME_FORMAT = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function LayerThumbnail({ layer, subscribeThumbnail }: {
  layer: CanvasControlLayer
  subscribeThumbnail?: CanvasControlsThumbnailSubscriber
}) {
  const [src, setSrc] = useState(layer.thumbnailSrc ?? '')

  useEffect(() => {
    if (layer.thumbnailSrc) {
      setSrc(layer.thumbnailSrc)
      return
    }
    if (!layer.imageId || !subscribeThumbnail) {
      setSrc('')
      return
    }
    let cancelled = false
    const unsubscribe = subscribeThumbnail(layer.imageId, (dataUrl) => {
      if (!cancelled) setSrc(dataUrl)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [layer.imageId, layer.thumbnailSrc, subscribeThumbnail])

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04]">
      {src
        ? <img src={src} alt="" className="h-full w-full object-cover" />
        : layer.status === 'error'
          ? <WarningIcon className="h-4 w-4 text-red-500" />
          : <ImageIcon className="h-4 w-4 text-gray-400 dark:text-gray-500" />}
    </span>
  )
}

export default function CanvasControls({
  viewport,
  containerSize,
  layers,
  selectedLayerId,
  canvasWheelMode,
  agentPanelCollapsed,
  readOnly = false,
  onViewportChange,
  onFocusLayer,
  onRenameLayer,
  subscribeThumbnail,
}: {
  viewport: ProjectCanvasViewport
  containerSize: { width: number; height: number }
  layers: CanvasControlLayer[]
  selectedLayerId: string | null
  canvasWheelMode: 'pan' | 'zoom'
  agentPanelCollapsed: boolean
  readOnly?: boolean
  onViewportChange: (viewport: ProjectCanvasViewport) => void
  onFocusLayer: (id: string) => void
  onRenameLayer?: (id: string, name: string) => boolean
  subscribeThumbnail?: CanvasControlsThumbnailSubscriber
}) {
  const controlsRef = useRef<HTMLDivElement>(null)
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const minimapDragRef = useRef<{ pointerId: number; start: { x: number; y: number }; viewport: ProjectCanvasViewport; width: number; height: number } | null>(null)
  const [zoomPresetOpen, setZoomPresetOpen] = useState(false)
  const [zoomHelpOpen, setZoomHelpOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null)
  const [layerNameDraft, setLayerNameDraft] = useState('')
  const [zoomEditing, setZoomEditing] = useState(false)
  const [zoomInput, setZoomInput] = useState(String(Math.round(viewport.scale * 100)))
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [now, setNow] = useState(() => Date.now())

  const hasRunningLayer = layers.some((layer) => layer.status === 'running')
  useEffect(() => {
    // 仅在面板展开且存在生成中的图层时计时，避免常驻定时器。
    if (collapsed || !layersOpen || !hasRunningLayer) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [collapsed, hasRunningLayer, layersOpen])

  const minimap = useMemo(() => {
    if (layers.length === 0) return null
    const minX = Math.min(...layers.map((layer) => layer.x))
    const minY = Math.min(...layers.map((layer) => layer.y))
    const maxX = Math.max(...layers.map((layer) => layer.x + layer.width))
    const maxY = Math.max(...layers.map((layer) => layer.y + layer.height))
    const padding = Math.max(60, Math.max(maxX - minX, maxY - minY) * 0.08)
    const bounds = {
      minX: minX - padding,
      minY: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    }
    const scale = Math.max(0.01, viewport.scale)
    return {
      bounds,
      viewport: {
        left: (-viewport.x / scale - bounds.minX) / bounds.width * 100,
        top: (-viewport.y / scale - bounds.minY) / bounds.height * 100,
        width: containerSize.width / scale / bounds.width * 100,
        height: containerSize.height / scale / bounds.height * 100,
      },
    }
  }, [containerSize.height, containerSize.width, layers, viewport])

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY, String(collapsed))
    } catch {
      // 本地存储不可用时保持内存状态即可
    }
  }, [collapsed])

  useEffect(() => {
    if (zoomEditing) return
    setZoomInput(String(Math.round(viewport.scale * 100)))
  }, [viewport.scale, zoomEditing])

  useEffect(() => {
    if (!zoomEditing) return
    zoomInputRef.current?.focus()
    zoomInputRef.current?.select()
  }, [zoomEditing])

  useEffect(() => {
    if (!zoomPresetOpen && !zoomHelpOpen && !layersOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && controlsRef.current?.contains(target)) return
      setZoomPresetOpen(false)
      setZoomHelpOpen(false)
      setLayersOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [layersOpen, zoomHelpOpen, zoomPresetOpen])

  const setZoomPercent = (percent: number) => {
    if (!Number.isFinite(percent)) return
    const scale = clampCanvasScale(percent / 100)
    onViewportChange(zoomCanvasViewport(viewport, { x: containerSize.width / 2, y: containerSize.height / 2 }, scale))
    setZoomPresetOpen(false)
    setZoomEditing(false)
  }

  const commitZoomInput = () => {
    const percent = Number(zoomInput)
    if (Number.isFinite(percent) && percent > 0) setZoomPercent(percent)
    else setZoomEditing(false)
  }

  const handleMinimapDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimap) return
    const rect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!rect) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    minimapDragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      viewport,
      width: rect.width,
      height: rect.height,
    }
  }

  const handleMinimapDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = minimapDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !minimap) return
    event.stopPropagation()
    const dx = (event.clientX - drag.start.x) / Math.max(1, drag.width) * minimap.bounds.width
    const dy = (event.clientY - drag.start.y) / Math.max(1, drag.height) * minimap.bounds.height
    onViewportChange({
      ...drag.viewport,
      x: drag.viewport.x - dx * drag.viewport.scale,
      y: drag.viewport.y - dy * drag.viewport.scale,
    })
  }

  const handleMinimapDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (minimapDragRef.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    minimapDragRef.current = null
  }

  return (
    <div
      ref={controlsRef}
      data-canvas-toolbar
      data-canvas-zoom-controls
      className={`pointer-events-auto fixed bottom-2 z-[150] flex items-center rounded-md border border-gray-200 bg-white/95 p-1 text-xs shadow-sm backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95 sm:bottom-3 ${agentPanelCollapsed ? 'right-2 sm:right-3' : 'right-2 sm:right-3 xl:right-[428px]'}`}
      onWheel={(event) => {
        event.stopPropagation()
        event.preventDefault()
      }}
    >
      {!collapsed && layersOpen && (
        <div
          data-canvas-layers-panel
          className="absolute bottom-full right-0 mb-2 w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-md border border-gray-200 bg-white/95 p-2 text-xs shadow-lg backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => {
            event.stopPropagation()
            const scrollable = (event.target as Element).closest<HTMLElement>('[data-canvas-scrollable]')
            if (!scrollable || scrollable.scrollHeight <= scrollable.clientHeight) event.preventDefault()
          }}
        >
          <div className="mb-1.5 font-medium text-gray-800 dark:text-gray-100">图层</div>
          <div data-canvas-scrollable className="max-h-96 overflow-y-auto overscroll-contain">
            {[...layers].sort((a, b) => b.z - a.z).map((layer) => (
              <div key={layer.id} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 transition ${layer.id === selectedLayerId ? 'bg-[#3f78c5]/12 text-[#3f78c5]' : 'text-gray-700 dark:text-gray-200'}`}>
                {editingLayerId === layer.id && !readOnly && onRenameLayer ? (
                  <input
                    autoFocus
                    value={layerNameDraft}
                    maxLength={80}
                    aria-label="图层名称"
                    className="min-w-0 flex-1 border-0 border-b border-[#3f78c5] bg-transparent p-0 text-xs outline-none"
                    onChange={(event) => setLayerNameDraft(event.target.value)}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') {
                        setEditingLayerId(null)
                        setLayerNameDraft('')
                      }
                    }}
                    onBlur={() => {
                      const name = layerNameDraft.trim()
                      if (!name || onRenameLayer(layer.id, name)) setEditingLayerId(null)
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onFocusLayer(layer.id)}
                    onDoubleClick={!readOnly && onRenameLayer ? (event) => {
                      event.stopPropagation()
                      setLayerNameDraft(layer.label)
                      setEditingLayerId(layer.id)
                    } : undefined}
                  >
                    <LayerThumbnail layer={layer} subscribeThumbnail={subscribeThumbnail} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{layer.label}</span>
                      {layer.createdAt != null && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] font-normal tabular-nums text-gray-400 dark:text-gray-500">
                          <span>{LAYER_TIME_FORMAT.format(layer.createdAt)}</span>
                          {/* 生成中的任务没有 elapsed，改用当前时间实时计时，与 TaskCard 一致。 */}
                          {layer.status === 'running'
                            ? <span title="已生成">生成中 {formatDurationMs(now - layer.createdAt)}</span>
                            : layer.elapsed != null && <span title="生成耗时">{formatDurationMs(layer.elapsed)}</span>}
                        </span>
                      )}
                    </span>
                  </button>
                )}
                <span className="shrink-0 tabular-nums text-[10px] text-gray-400">z{Math.round(layer.z)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!collapsed && minimapOpen && minimap && (
        <div className="absolute bottom-full left-0 mb-2 w-60 text-xs shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
          <div className="relative h-36 overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-white/[0.1] dark:bg-gray-800">
            <div
              className="absolute z-20 cursor-move border border-[#3f78c5] bg-[#3f78c5]/10"
              style={{ left: `${Math.max(0, Math.min(100, minimap.viewport.left))}%`, top: `${Math.max(0, Math.min(100, minimap.viewport.top))}%`, width: `${Math.max(2, Math.min(100, minimap.viewport.width))}%`, height: `${Math.max(2, Math.min(100, minimap.viewport.height))}%` }}
              onPointerDown={handleMinimapDragStart}
              onPointerMove={handleMinimapDragMove}
              onPointerUp={handleMinimapDragEnd}
              onPointerCancel={handleMinimapDragEnd}
            />
            {layers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                aria-label={`跳转到${layer.label}`}
                title={layer.label}
                className={`absolute z-30 min-h-1 min-w-1 rounded-sm ${layer.id === selectedLayerId ? 'bg-[#3f78c5] ring-2 ring-[#3f78c5]/40' : layer.status === 'error' ? 'bg-red-500/80' : 'bg-[#3f78c5]/65 hover:bg-[#3f78c5]'}`}
                style={{ left: `${(layer.x - minimap.bounds.minX) / minimap.bounds.width * 100}%`, top: `${(layer.y - minimap.bounds.minY) / minimap.bounds.height * 100}%`, width: `${Math.max(1.5, layer.width / minimap.bounds.width * 100)}%`, height: `${Math.max(1.5, layer.height / minimap.bounds.height * 100)}%` }}
                onClick={() => onFocusLayer(layer.id)}
              />
            ))}
          </div>
        </div>
      )}
      {!collapsed && zoomPresetOpen && !zoomEditing && (
        <div data-canvas-zoom-preset className="absolute bottom-full right-0 mb-2 flex gap-1 rounded-md border border-gray-200 bg-white p-1 text-[11px] shadow-lg dark:border-white/[0.1] dark:bg-gray-900" onPointerDown={(event) => event.stopPropagation()}>
          {[50, 100, 200].map((percent) => <button key={percent} type="button" className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]" onClick={() => setZoomPercent(percent)}>{percent}%</button>)}
        </div>
      )}
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]"
        aria-label={collapsed ? '展开画布工具栏' : '收起画布工具栏'}
        title={collapsed ? '展开画布工具栏' : '收起画布工具栏'}
        aria-expanded={!collapsed}
        onClick={() => {
          setCollapsed((current) => !current)
          setZoomPresetOpen(false)
          setLayersOpen(false)
          setMinimapOpen(false)
          setZoomHelpOpen(false)
          setZoomEditing(false)
        }}
      >
        {collapsed ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
      </button>
      <div data-canvas-controls-content className={`flex items-center transition-[max-width,opacity,transform] duration-200 ease-out ${collapsed ? 'pointer-events-none max-w-0 -translate-x-2 overflow-hidden opacity-0' : 'max-w-[28rem] translate-x-0 overflow-visible opacity-100'}`}>
        <button type="button" className={`flex h-7 w-7 items-center justify-center rounded text-[#3f78c5] transition ${zoomHelpOpen ? 'bg-[#3f78c5]/15' : 'hover:bg-[#3f78c5]/10'}`} aria-label="画布操作说明" title="画布操作说明" onClick={() => { setZoomHelpOpen((open) => !open); setZoomPresetOpen(false); setLayersOpen(false); setMinimapOpen(false) }}><InfoIcon className="h-4 w-4" /></button>
        <button type="button" className={`flex h-7 w-7 items-center justify-center rounded transition ${layersOpen ? 'bg-[#3f78c5]/15 text-[#3f78c5]' : 'hover:bg-gray-100 dark:hover:bg-white/[0.08]'}`} aria-label="图层" title="图层" onClick={() => { setLayersOpen((open) => !open); setMinimapOpen(false); setZoomHelpOpen(false); setZoomPresetOpen(false) }}><LayersIcon className="h-4 w-4" /></button>
        <button type="button" className={`flex h-7 w-7 items-center justify-center rounded transition ${minimapOpen ? 'bg-[#3f78c5]/15 text-[#3f78c5]' : 'hover:bg-gray-100 dark:hover:bg-white/[0.08]'}`} aria-label="小地图" title="小地图" onClick={() => { setMinimapOpen((open) => !open); setLayersOpen(false); setZoomHelpOpen(false); setZoomPresetOpen(false) }}><MapIcon className="h-4 w-4" /></button>
        <button type="button" className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label="回到画布原点" title="回到画布原点" onClick={() => onViewportChange({ ...viewport, x: containerSize.width / 2, y: containerSize.height / 2 })}><HomeIcon className="h-3.5 w-3.5" /></button>
        <button type="button" className="h-7 w-7 rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label="缩小画布" title="缩小画布" onClick={() => setZoomPercent(viewport.scale / 1.2 * 100)}>-</button>
        {zoomEditing ? (
          <input
            ref={zoomInputRef}
            aria-label="输入画布缩放比例"
            type="number"
            min="1"
            max="1000"
            value={zoomInput}
            className="h-7 w-12 rounded border border-[#3f78c5] bg-transparent px-1 text-center tabular-nums text-gray-600 outline-none dark:text-gray-300"
            onChange={(event) => setZoomInput(event.target.value)}
            onBlur={commitZoomInput}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitZoomInput()
              if (event.key === 'Escape') setZoomEditing(false)
            }}
          />
        ) : (
          <button
            type="button"
            aria-label="选择画布缩放比例"
            title="点击选择缩放比例，双击输入"
            className="h-7 w-12 rounded px-1 text-center tabular-nums text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.08]"
            onClick={() => {
              setZoomPresetOpen((open) => !open)
              setLayersOpen(false)
              setMinimapOpen(false)
              setZoomHelpOpen(false)
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setZoomInput(String(Math.round(viewport.scale * 100)))
              setZoomPresetOpen(false)
              setZoomEditing(true)
            }}
          >{Math.round(viewport.scale * 100)}%</button>
        )}
        <button type="button" className="h-7 w-7 rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]" aria-label="放大画布" title="放大画布" onClick={() => setZoomPercent(viewport.scale * 1.2 * 100)}>+</button>
      </div>
      {!collapsed && zoomHelpOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-md border border-gray-200 bg-white p-4 text-xs leading-6 text-gray-600 shadow-lg dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-300" onPointerDown={(event) => event.stopPropagation()}>
          <div className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-100">画布操作说明</div>
          <div>滚轮：{canvasWheelMode === 'zoom' ? '缩放画布' : '移动位置'}</div>
          <div>Ctrl + 滚轮：缩放画布</div>
          <div>双指：缩放画布</div>
          <div>空白拖动：平移画布</div>
          {readOnly ? <>
            <div>点击图片：选中图片并显示信息</div>
            <div>图层 / 小地图：快速跳转图片</div>
          </> : <>
            <div>Ctrl + 拖动：框选图片</div>
            <div>Delete / Backspace：删除选中图片</div>
            <div>Ctrl/Cmd + Z：撤销上一步画布操作</div>
            <div>Ctrl/Cmd + Y：重做上一步画布操作</div>
            <div>最多保留 30 层历史记录</div>
          </>}
          <div>双击缩放比例：输入缩放百分比</div>
          {!readOnly && <div className="mt-2 border-t border-gray-100 pt-2 dark:border-white/[0.08]">
            <div className="mb-1 font-medium text-gray-800 dark:text-gray-100">图片菜单说明</div>
            <div>选中图片后，图片上方会显示图片操作菜单。</div>
            <div className="mt-1 flex items-start gap-2"><DownloadIcon className="mt-1 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" /><span>下载：下载修改前的原图</span></div>
            <div className="flex items-start gap-2"><ExportIcon className="mt-1 h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" /><span>导出：导出裁剪、旋转等操作修改后的图片</span></div>
          </div>}
        </div>
      )}
    </div>
  )
}
