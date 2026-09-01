import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { AgentConversation, Project, ProjectCanvasItem, ProjectCanvasState, TaskOutputError, TaskRecord } from '../types'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { getCanvasConnectionPoint, type CanvasConnection } from '../lib/canvasConnections'
import { clampCanvasScale, ensureProjectCanvas, isCanvasRectVisible, zoomCanvasViewport } from '../lib/projectCanvas'
import { getTaskIds } from '../lib/taskIds'
import { isImageDownloadFailure as isImageDownloadFailureError } from '../lib/imageApiShared'
import { redownloadTaskImage, retryImage, retryTaskInPlace, useStore } from '../store'
import { TooltipButton } from './TooltipButton'
import { AngleIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, HomeIcon, ImageIcon, InfoIcon, LayersIcon, MapIcon, RefreshIcon, ScaleIcon, WarningIcon, ZoomInIcon, ZoomOutIcon } from './icons'
import CanvasReferenceConnections from './CanvasReferenceConnections'
import DetailModal from './DetailModal'
import AgentWorkspace from './AgentWorkspace'

const CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY = 'gpt-image-playground:canvas-zoom-controls-collapsed'
const EMPTY_AGENT_CONVERSATIONS: AgentConversation[] = []

function getCanvasItemHeight(item: ProjectCanvasItem, ratio: number) {
  const crop = item.operator?.crop
  const safeRatio = Math.max(0.01, ratio)
  if (!crop) return item.width / safeRatio
  return item.width * crop.height / (safeRatio * crop.width)
}

function normalizeCanvasRotation(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function getPlaceholderDimensions(task: TaskRecord) {
  const match = /^([1-9]\d*)x([1-9]\d*)$/i.exec(task.params.size.trim())
  if (!match) return { width: 1024, height: 1024 }
  return { width: Number(match[1]), height: Number(match[2]) }
}

function getCanvasNodeGeometry(item: ProjectCanvasItem, ratio: number, viewport: ProjectCanvasState['viewport']) {
  const frameHeight = getCanvasItemHeight(item, ratio)
  const rotation = ((item.rotation ?? item.operator?.rotation ?? 0) * Math.PI) / 180
  const width = item.width * viewport.scale
  const height = frameHeight * viewport.scale
  const centerX = item.x * viewport.scale + viewport.x + width / 2
  const centerY = item.y * viewport.scale + viewport.y + height / 2

  return {
    frameHeight,
    centerX,
    centerY,
    rotatedWidth: Math.abs(Math.cos(rotation)) * width + Math.abs(Math.sin(rotation)) * height,
    rotatedHeight: Math.abs(Math.sin(rotation)) * width + Math.abs(Math.cos(rotation)) * height,
  }
}

type CanvasNode = {
  id: string
  item: ProjectCanvasItem
  task?: TaskRecord
  image?: { dataUrl: string; width?: number; height?: number; source?: string }
  status: 'done' | 'error'
  error?: string
  failure?: TaskOutputError
  placeholderDimensions?: { width: number; height: number }
  placeholderName?: string
  outputRequestIndex?: number
  ratio: number
}

function getFailureEndpointLabel(endpoint: TaskOutputError['endpoint']) {
  if (endpoint === 'generation') return 'generation'
  if (endpoint === 'edit') return 'edit'
  if (endpoint === 'responses') return 'responses'
  if (endpoint === 'status') return 'status'
  if (endpoint === 'result') return 'result'
  if (endpoint === 'download') return 'download'
  if (endpoint === 'agent') return 'agent'
  return '未知'
}

function CanvasEdgeIndicator({
  node,
  item,
  ratio,
  viewport,
  containerSize,
  onClick,
}: {
  node: CanvasNode
  item: ProjectCanvasItem
  ratio: number
  viewport: ProjectCanvasState['viewport']
  containerSize: { width: number; height: number }
  onClick: () => void
}) {
  const imageHeight = getCanvasItemHeight(item, ratio)
  if (containerSize.width <= 0 || containerSize.height <= 0 || isCanvasRectVisible(item, imageHeight, viewport, containerSize, 0)) return null

  const center = {
    x: viewport.x + (item.x + item.width / 2) * viewport.scale,
    y: viewport.y + (item.y + imageHeight / 2) * viewport.scale,
  }
  const canvasCenter = { x: containerSize.width / 2, y: containerSize.height / 2 }
  const vector = { x: center.x - canvasCenter.x, y: center.y - canvasCenter.y }
  const halfWidth = Math.max(1, canvasCenter.x - 8)
  const halfHeight = Math.max(1, canvasCenter.y - 8)
  const edgeScale = Math.min(
    vector.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(vector.x),
    vector.y === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(vector.y),
  )
  const point = {
    x: canvasCenter.x + vector.x * edgeScale,
    y: canvasCenter.y + vector.y * edgeScale,
  }
  const compact = containerSize.width < 640
  const indicatorWidth = compact ? 42 : 104
  const indicatorHeight = 42
  const left = Math.min(Math.max(4, point.x - indicatorWidth / 2), Math.max(4, containerSize.width - indicatorWidth - 4))
  const top = Math.min(Math.max(4, point.y - indicatorHeight / 2), Math.max(4, containerSize.height - indicatorHeight - 4))
  const label = item.name ?? node.placeholderName ?? node.id
  const isError = node.status === 'error'

  return (
    <button
      type="button"
      aria-label={`跳转到${label}`}
      title={`跳转到${label}`}
      className={`absolute z-[35] flex h-[42px] items-center rounded-md border border-gray-200 bg-white/95 text-left shadow-md backdrop-blur transition hover:border-[#3f78c5] hover:shadow-lg dark:border-white/[0.12] dark:bg-gray-900/95 ${compact ? 'w-[42px] justify-center px-1' : 'w-[104px] gap-2 px-1.5'}`}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border ${isError ? 'border-red-200 bg-red-100 text-red-600 dark:border-red-900/70 dark:bg-red-950/60 dark:text-red-400' : 'border-gray-200 bg-gray-100 dark:border-white/[0.1] dark:bg-gray-800'}`}>
        {node.image?.dataUrl ? <img src={node.image.dataUrl} alt="" draggable={false} className="h-full w-full object-cover" /> : isError ? <WarningIcon className="h-4 w-4" /> : <ImageIcon className="h-4 w-4 text-gray-400 dark:text-gray-500" />}
      </span>
      {!compact && <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">{label}</span>}
    </button>
  )
}

export default function AdminCanvasViewer({ project, tasks, images, agentConversations = EMPTY_AGENT_CONVERSATIONS, onBack }: {
  project: Project
  tasks: TaskRecord[]
  images: Record<string, { dataUrl: string; width?: number; height?: number }>
  agentConversations?: AgentConversation[]
  onBack: () => void
}) {
  const showToast = useStore((state) => state.showToast)
  const canvasWheelMode = useStore((state) => state.settings?.canvasWheelMode ?? 'pan')
  const containerRef = useRef<HTMLDivElement>(null)
  const zoomInputRef = useRef<HTMLInputElement>(null)
  const zoomControlsRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; x: number; y: number; viewport: ProjectCanvasState['viewport'] } | null>(null)
  const minimapDragRef = useRef<{ pointerId: number; start: { x: number; y: number }; viewport: ProjectCanvasState['viewport']; width: number; height: number } | null>(null)
  const [viewport, setViewport] = useState(project.canvas?.viewport ?? { x: 0, y: 0, scale: 1 })
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
  const [infoImageId, setInfoImageId] = useState<string | null>(null)
  const [agentDetailTask, setAgentDetailTask] = useState<TaskRecord | null>(null)
  const [zoomPresetOpen, setZoomPresetOpen] = useState(false)
  const [zoomHelpOpen, setZoomHelpOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [zoomControlsCollapsed, setZoomControlsCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.localStorage.getItem(CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const [zoomEditing, setZoomEditing] = useState(false)
  const [zoomInput, setZoomInput] = useState(String(Math.round((project.canvas?.viewport.scale ?? 1) * 100)))
  const [agentPanelCollapsed, setAgentPanelCollapsed] = useState(false)
  const [editingMode, setEditingMode] = useState(false)
  const [retryingTaskIds, setRetryingTaskIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    try {
      window.localStorage.setItem(CANVAS_ZOOM_CONTROLS_COLLAPSED_STORAGE_KEY, String(zoomControlsCollapsed))
    } catch {
      // 本地存储不可用时保持内存状态即可
    }
  }, [zoomControlsCollapsed])

  useEffect(() => {
    setViewport(project.canvas?.viewport ?? { x: 0, y: 0, scale: 1 })
  }, [project.canvas?.viewport.x, project.canvas?.viewport.y, project.canvas?.viewport.scale])

  useEffect(() => {
    if (zoomEditing) return
    setZoomInput(String(Math.round(viewport.scale * 100)))
  }, [viewport.scale, zoomEditing])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const outputImageIds = useMemo(() => Array.from(new Set(tasks.flatMap((task) => task.outputImages))), [tasks])
  const errorNodeById = useMemo(() => {
    const result = new Map<string, { task: TaskRecord; error?: string; failure?: TaskOutputError; placeholderName: string; dimensions: { width: number; height: number }; requestIndex: number }>()
    for (const task of tasks) {
      const dimensions = getPlaceholderDimensions(task)
      if (task.status === 'error' && task.outputImages.length === 0 && !task.outputErrors?.length) {
        result.set(`${task.id}:error`, { task, error: task.error ?? '生成失败', placeholderName: '占位图1', dimensions, requestIndex: 0 })
      }
      for (const error of task.outputErrors ?? []) {
        result.set(`${task.id}:error:${error.requestIndex}`, { task, error: error.error, failure: error, placeholderName: `占位图${error.requestIndex + 1}`, dimensions, requestIndex: error.requestIndex })
      }
    }
    return result
  }, [tasks])
  const errorNodeIds = useMemo(() => Array.from(errorNodeById.keys()), [errorNodeById])
  const canvas = useMemo(() => {
    const ensured = ensureProjectCanvas(project.canvas, [...outputImageIds, ...errorNodeIds], {}, {}, Object.keys(project.canvas?.items ?? {}))
    const items = Object.fromEntries(Object.entries(ensured.items).map(([id, item]) => {
      const errorNode = errorNodeById.get(id)
      if (!errorNode || project.canvas?.items?.[id]?.name) return [id, item]
      return [id, { ...item, name: errorNode.placeholderName }]
    }))
    return { ...ensured, items }
  }, [errorNodeById, errorNodeIds, outputImageIds, project.canvas])
  const taskByImageId = useMemo(() => {
    const map = new Map<string, TaskRecord>()
    for (const task of tasks) {
      for (const imageId of task.outputImages) map.set(imageId, task)
    }
    return map
  }, [tasks])
  const nodes = useMemo<CanvasNode[]>(() => {
    const liveNodeIds = new Set([...outputImageIds, ...errorNodeIds])
    return Object.entries(canvas.items)
      .filter(([id]) => liveNodeIds.has(id))
      .map(([id, item]) => {
        const errorNode = errorNodeById.get(id)
        const image = images[id]
        const dimensions = image?.width && image?.height ? { width: image.width, height: image.height } : errorNode?.dimensions
        return {
          id,
          item,
          task: taskByImageId.get(id) ?? errorNode?.task,
          image,
          status: errorNode ? 'error' as const : 'done' as const,
          error: errorNode?.error,
          failure: errorNode?.failure,
          placeholderDimensions: errorNode?.dimensions,
          placeholderName: errorNode?.placeholderName,
          outputRequestIndex: errorNode?.requestIndex,
          ratio: dimensions ? dimensions.width / dimensions.height : 1,
        }
      })
      .sort((a, b) => a.item.z - b.item.z || a.id.localeCompare(b.id))
  }, [canvas.items, errorNodeById, errorNodeIds, images, outputImageIds, taskByImageId])
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node] as const)), [nodes])
  const selectedNode = selectedImageId ? nodeById.get(selectedImageId) ?? null : null
  const selectedItem = selectedNode?.item
  const selectedRatio = selectedNode?.ratio ?? 1
  const selectedGeometry = selectedItem ? getCanvasNodeGeometry(selectedItem, selectedRatio, viewport) : null
  const selectedVisible = Boolean(selectedItem && selectedGeometry && isCanvasRectVisible(selectedItem, selectedGeometry.frameHeight, viewport, containerSize, 0))
  const selectedRotation = selectedItem ? normalizeCanvasRotation(selectedItem.rotation ?? selectedItem.operator?.rotation ?? 0) : 0
  const selectedScale = selectedItem?.operator?.scale ?? 1
  const selectedTransformActive = Boolean(selectedItem && (selectedRotation !== 0 || Math.abs(selectedScale - 1) > 0.001))
  const infoNode = infoImageId ? nodeById.get(infoImageId) ?? null : null
  const imageOverrides = useMemo(() => Object.fromEntries(Object.entries(images).map(([id, image]) => [id, image.dataUrl])), [images])

  useEffect(() => {
    if (!selectedImageId || nodeById.has(selectedImageId)) return
    setSelectedImageId(null)
  }, [nodeById, selectedImageId])

  useEffect(() => {
    if (!infoImageId || nodeById.has(infoImageId)) return
    setInfoImageId(null)
  }, [infoImageId, nodeById])

  useEffect(() => {
    if (!infoNode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setInfoImageId(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [infoNode])

  const visibleNodes = useMemo(() => nodes.filter((node) => {
    if (node.id === selectedImageId) return true
    return isCanvasRectVisible(node.item, getCanvasItemHeight(node.item, node.ratio), viewport, containerSize, 0)
  }), [containerSize, nodes, selectedImageId, viewport])

  const canvasConnections = useMemo<CanvasConnection[]>(() => nodes.flatMap((targetNode) => {
    if (!targetNode.task) return []
    const targetHeight = getCanvasItemHeight(targetNode.item, targetNode.ratio)
    const targetCenter = { x: targetNode.item.x + targetNode.item.width / 2, y: targetNode.item.y + targetHeight / 2 }
    return targetNode.task.inputImageIds.flatMap((sourceImageId) => {
      const sourceNode = nodeById.get(sourceImageId)
      if (!sourceNode || sourceNode.id === targetNode.id) return []
      const sourceHeight = getCanvasItemHeight(sourceNode.item, sourceNode.ratio)
      const sourceCenter = { x: sourceNode.item.x + sourceNode.item.width / 2, y: sourceNode.item.y + sourceHeight / 2 }
      const start = getCanvasConnectionPoint(sourceCenter, targetCenter, sourceNode.item.width, sourceHeight)
      const end = getCanvasConnectionPoint(targetCenter, sourceCenter, targetNode.item.width, targetHeight)
      return [{
        id: `${sourceNode.id}:${targetNode.id}`,
        start: { x: viewport.x + start.x * viewport.scale, y: viewport.y + start.y * viewport.scale },
        end: { x: viewport.x + end.x * viewport.scale, y: viewport.y + end.y * viewport.scale },
      }]
    })
  }), [nodeById, nodes, viewport])

  const minimapData = useMemo(() => {
    const entries = nodes.flatMap((node) => {
      const item = node.item
      const height = getCanvasItemHeight(item, node.ratio)
      return [{ node, item, height }]
    })
    if (entries.length === 0) return null
    const minX = Math.min(...entries.map(({ item }) => item.x))
    const minY = Math.min(...entries.map(({ item }) => item.y))
    const maxX = Math.max(...entries.map(({ item }) => item.x + item.width))
    const maxY = Math.max(...entries.map(({ item, height }) => item.y + height))
    const padding = Math.max(60, Math.max(maxX - minX, maxY - minY) * 0.08)
    const bounds = {
      minX: minX - padding,
      minY: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    }
    const viewportScale = Math.max(0.01, viewport.scale)
    const viewportX = -viewport.x / viewportScale
    const viewportY = -viewport.y / viewportScale
    return {
      entries,
      bounds,
      viewport: {
        left: (viewportX - bounds.minX) / bounds.width * 100,
        top: (viewportY - bounds.minY) / bounds.height * 100,
        width: containerSize.width / viewportScale / bounds.width * 100,
        height: containerSize.height / viewportScale / bounds.height * 100,
      },
    }
  }, [containerSize.height, containerSize.width, nodes, viewport])

  const zoom = (scale: number) => {
    const point = { x: containerSize.width / 2, y: containerSize.height / 2 }
    setViewport((current) => zoomCanvasViewport(current, point, scale))
    setZoomPresetOpen(false)
    setZoomEditing(false)
  }

  const focusCanvasImage = (imageId: string) => {
    const node = nodeById.get(imageId)
    if (!node) return
    setSelectedImageId(imageId)
    setInfoImageId(null)
    if (containerSize.width <= 0 || containerSize.height <= 0) return
    const frameHeight = getCanvasItemHeight(node.item, node.ratio)
    const viewportShortEdge = Math.min(containerSize.width, containerSize.height)
    const targetScale = Math.min(3, viewportShortEdge * 0.7 / Math.max(1, Math.max(node.item.width, frameHeight)))
    const scale = clampCanvasScale(targetScale)
    const centerX = node.item.x + node.item.width / 2
    const centerY = node.item.y + frameHeight / 2
    setViewport({
      x: containerSize.width / 2 - centerX * scale,
      y: containerSize.height / 2 - centerY * scale,
      scale,
    })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest('[data-canvas-node], [data-canvas-toolbar], button, input, textarea, select, [contenteditable="true"]')) return
    setSelectedImageId(null)
    setInfoImageId(null)
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handleWheel = (event: WheelEvent) => {
      const target = event.target
      if (target instanceof Element) {
        const toolbar = target.closest('[data-canvas-toolbar]')
        if (toolbar) {
          const scrollable = target.closest<HTMLElement>('[data-canvas-scrollable]')
          if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return
          event.preventDefault()
          return
        }
      }
      event.preventDefault()
      const rect = container.getBoundingClientRect()
      if (canvasWheelMode === 'pan' && !event.ctrlKey) {
        setViewport((current) => ({
          ...current,
          x: current.x - (event.deltaX || 0),
          y: current.y - (event.deltaY || 0),
        }))
        return
      }
      const factor = Math.exp(-event.deltaY * 0.0015)
      setViewport((current) => zoomCanvasViewport(current, { x: event.clientX - rect.left, y: event.clientY - rect.top }, current.scale * factor))
    }
    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [canvasWheelMode])

  const handleMinimapDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!minimapData) return
    const mapRect = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!mapRect) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    minimapDragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      viewport,
      width: mapRect.width,
      height: mapRect.height,
    }
  }

  const handleMinimapDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = minimapDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !minimapData) return
    event.stopPropagation()
    const dx = (event.clientX - drag.start.x) / Math.max(1, drag.width) * minimapData.bounds.width
    const dy = (event.clientY - drag.start.y) / Math.max(1, drag.height) * minimapData.bounds.height
    setViewport({
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

  useEffect(() => {
    if (!zoomEditing) return
    zoomInputRef.current?.focus()
    zoomInputRef.current?.select()
  }, [zoomEditing])

  const setCanvasZoomPercent = (percent: number) => {
    if (!Number.isFinite(percent)) return
    const scale = clampCanvasScale(percent / 100)
    zoom(scale)
    setZoomInput(String(Math.round(scale * 100)))
  }

  const commitCanvasZoomInput = () => {
    const percent = Number(zoomInput)
    if (Number.isFinite(percent) && percent > 0) setCanvasZoomPercent(percent)
    else setZoomEditing(false)
  }

  const handleCopyImageId = async (imageId: string) => {
    try {
      await copyTextToClipboard(imageId)
      showToast('image_id 已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制 image_id 失败', err), 'error')
    }
  }

  const handleCopyFailureError = async (error: string) => {
    try {
      await copyTextToClipboard(error)
      showToast('失败原因已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败原因失败', err), 'error')
    }
  }

  const handleCopyFailureId = async (label: 'request_id' | 'task_id', value: string) => {
    try {
      await copyTextToClipboard(value)
      showToast(`${label} 已复制`, 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage(`复制 ${label} 失败`, err), 'error')
    }
  }

  const toolbarButtonClass = 'flex h-8 w-8 items-center justify-center rounded text-gray-600 transition hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white'

  const selectedToolbarPosition = selectedGeometry && selectedVisible && containerSize.width > 0 && containerSize.height > 0 ? (() => {
    const toolbarWidth = 42
    const toolbarHeight = 42
    const gap = 34
    const above = selectedGeometry.centerY - selectedGeometry.rotatedHeight / 2 - toolbarHeight - gap
    const below = selectedGeometry.centerY + selectedGeometry.rotatedHeight / 2 + gap
    const canPlaceAbove = above >= 8
    const canPlaceBelow = below + toolbarHeight <= containerSize.height - 8
    const preferredTop = canPlaceAbove ? above : canPlaceBelow ? below : Math.max(8, above)
    const maxLeft = Math.max(8, containerSize.width - toolbarWidth - 8)
    return {
      left: Math.round(Math.min(Math.max(selectedGeometry.centerX - toolbarWidth / 2, 8), maxLeft)),
      top: Math.round(Math.min(Math.max(preferredTop, 8), Math.max(8, containerSize.height - toolbarHeight - 8))),
    }
  })() : null

  const transformPanelPosition = selectedGeometry && selectedTransformActive && containerSize.width > 0 && containerSize.height > 0 ? (() => {
    const panelWidth = 128
    const panelHeight = 80
    const gap = 12
    const preferredLeft = selectedGeometry.centerX - selectedGeometry.rotatedWidth / 2 - panelWidth - gap
    const rightLeft = selectedGeometry.centerX + selectedGeometry.rotatedWidth / 2 + gap
    const rawLeft = preferredLeft >= 8 ? preferredLeft : rightLeft
    return {
      left: Math.round(Math.min(Math.max(rawLeft, 8), Math.max(8, containerSize.width - panelWidth - 8))),
      top: Math.round(Math.min(Math.max(selectedGeometry.centerY - selectedGeometry.rotatedHeight / 2, 8), Math.max(8, containerSize.height - panelHeight - 8))),
    }
  })() : null

  const zoomTo = (scale: number) => {
    const point = { x: containerSize.width / 2, y: containerSize.height / 2 }
    setViewport((current) => zoomCanvasViewport(current, point, scale))
    setZoomPresetOpen(false)
    setZoomEditing(false)
  }

  const handleRetryTask = async (task: TaskRecord, requestIndex?: number, downloadOnly = false) => {
    if (retryingTaskIds.has(task.id)) return
    setRetryingTaskIds((current) => new Set(current).add(task.id))
    try {
      const existingTask = useStore.getState().tasks.find((item) => item.id === task.id)
      if (downloadOnly) {
        await redownloadTaskImage(task, requestIndex)
        showToast('图片重新下载成功', 'success')
      } else {
        if (existingTask?.status === 'error' && existingTask.outputImages.length === 0) await retryTaskInPlace(existingTask)
        else await retryImage(task)
        showToast('已提交重试请求', 'success')
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : '重试请求失败', 'error')
    } finally {
      setRetryingTaskIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }

  return (
    <div className="flex h-[calc(100dvh-2.75rem)] min-h-[320px] flex-col bg-white dark:bg-gray-950">
      <div className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-white/[0.08] dark:bg-gray-900">
        <button type="button" onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-white" aria-label="返回用户画布" title="返回用户画布"><ChevronLeftIcon className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{project.title || '未命名画布'}</h1>
          <p className="text-xs text-gray-500">只读查看 · {nodes.length} 个图层</p>
        </div>
      </div>
      <div className={`relative grid min-h-0 flex-1 w-full transition-[grid-template-columns,gap] duration-300 ease-in-out ${agentPanelCollapsed ? 'xl:grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_420px]'}`}>
        <main className="relative min-h-0 min-w-0">
      <div
        ref={containerRef}
        data-project-canvas
        data-no-drag-select
        className="relative h-full min-h-0 w-full overscroll-none overflow-hidden border border-gray-200 bg-gray-100 dark:border-white/[0.08] dark:bg-gray-950"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <div
          data-canvas-toolbar
          className="pointer-events-none absolute right-3 top-3 z-40 flex items-center gap-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <label className="pointer-events-auto inline-flex shrink-0 cursor-pointer items-center gap-2 rounded border border-gray-200 bg-white/90 px-2 py-1 text-xs text-gray-500 shadow-sm backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/90 dark:text-gray-400" title="允许管理员操作失败图片">
            <span>编辑模式</span>
            <input type="checkbox" className="peer sr-only" checked={editingMode} onChange={(event) => setEditingMode(event.target.checked)} />
            <span aria-hidden="true" className="relative h-5 w-9 rounded-full bg-gray-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-emerald-500 peer-checked:after:translate-x-4 dark:bg-gray-700" />
          </label>
          <span className={`rounded border bg-white/90 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur dark:bg-gray-900/90 ${editingMode ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300' : 'border-amber-200 text-amber-700 dark:border-amber-900/60 dark:text-amber-300'}`}>{editingMode ? '可操作' : '只读'}</span>
        </div>
        <CanvasReferenceConnections connections={canvasConnections} markerId="admin-canvas-reference-arrow" />
        <div className="absolute left-0 top-0 z-10 origin-top-left" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}>
          {visibleNodes.map((node) => {
            const ratio = Math.max(0.01, node.ratio)
            const frameHeight = getCanvasItemHeight(node.item, ratio)
            const crop = node.item.operator?.crop
            const flipX = node.item.operator?.flipX === true
            const flipY = node.item.operator?.flipY === true
            const rotation = node.item.rotation ?? node.item.operator?.rotation ?? 0
            const selected = selectedImageId === node.id
            const label = node.item.name ?? node.placeholderName ?? node.id
            const displayDimensions = node.image?.width && node.image?.height
              ? { width: node.image.width, height: node.image.height }
              : node.placeholderDimensions
            const metadataScale = 1 / Math.max(viewport.scale, 0.01)
            const failureEndpoint = node.failure?.endpoint ?? node.task?.failureEndpoint
            const imageDownloadFailure = isImageDownloadFailureError(failureEndpoint, node.error)
            const isNetworkFailure = node.task?.failureKind === 'network'
              || node.failure?.kind === 'network'
              || /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(node.error ?? '')
            const statusText = node.status === 'error'
              ? imageDownloadFailure ? '图片下载失败' : isNetworkFailure ? '网络异常，请稍后重试。' : '生成失败'
              : ''
            const taskIds = node.task ? getTaskIds(node.task) : []
            const failureRetryCount = node.failure?.retryCount ?? node.task?.failureRetryCount

            return (
              <div
                key={node.id}
                data-canvas-node
                data-node-key={node.id}
                className="absolute select-none"
                style={{
                  left: node.item.x,
                  top: node.item.y,
                  width: node.item.width,
                  transform: `rotate(${rotation}deg)`,
                  transformOrigin: 'center center',
                  zIndex: selected ? Math.max(node.item.z, 1000) : node.item.z,
                  touchAction: 'none',
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => {
                  setSelectedImageId(node.id)
                  setInfoImageId(null)
                }}
              >
                <div
                  className={`relative overflow-hidden bg-white shadow-sm dark:bg-gray-900 ${selected ? 'ring-0' : 'ring-1 ring-black/10 dark:ring-white/10'}`}
                  style={{
                    height: frameHeight,
                    ...(selected ? { boxShadow: '0 0 0 2px #3f78c5' } : {}),
                  }}
                >
                  {node.image?.dataUrl ? (
                    <img
                      src={node.image.dataUrl}
                      alt={label}
                      className={crop ? 'absolute max-w-none' : 'block h-auto w-full object-contain'}
                      draggable={false}
                      style={crop
                        ? {
                          width: `${100 / crop.width}%`,
                          height: `${100 / crop.height}%`,
                          left: `${-crop.x / crop.width * 100}%`,
                          top: `${-crop.y / crop.height * 100}%`,
                          ...(flipX || flipY ? { transform: `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})` } : {}),
                        }
                        : flipX || flipY
                          ? { transform: `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})` }
                          : undefined}
                    />
                  ) : (
                    <div className={`relative flex h-full w-full items-center justify-center overflow-hidden text-xs ${node.status === 'error' ? isNetworkFailure || imageDownloadFailure ? 'border border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-700/70 dark:bg-yellow-950/60 dark:text-yellow-300' : 'border border-red-200 bg-red-100 text-red-700 dark:border-red-900/70 dark:bg-red-950/60 dark:text-red-300' : 'bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>
                      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-2">
                        {node.status === 'error'
                          ? <WarningIcon className={`h-32 w-32 ${isNetworkFailure || imageDownloadFailure ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}`} />
                          : <ImageIcon className={`h-[7.5rem] w-[7.5rem] text-[#3f78c5]/70 ${node.status === 'done' ? '' : 'animate-pulse'}`} />}
                        {node.status === 'error'
                          ? (isNetworkFailure || imageDownloadFailure)
                            ? <span className="flex items-center gap-2 text-4xl font-medium">
                              <span>{statusText}</span>
                              {editingMode && node.task && <button type="button" data-canvas-handle disabled={retryingTaskIds.has(node.task.id)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-green-700/60 bg-green-600 text-white shadow-sm shadow-green-500/30 transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-green-500 dark:hover:bg-green-400" aria-label={imageDownloadFailure ? '重新下载图片' : '重试请求'} title={retryingTaskIds.has(node.task.id) ? '正在重试' : imageDownloadFailure ? '重新下载图片' : '重试请求'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleRetryTask(node.task!, node.failure?.requestIndex ?? node.outputRequestIndex, imageDownloadFailure) }}>{imageDownloadFailure ? <DownloadIcon className="h-6 w-6" /> : <RefreshIcon className={`h-6 w-6 ${retryingTaskIds.has(node.task.id) ? 'animate-spin' : ''}`} />}</button>}
                            </span>
                            : <span className="text-4xl font-medium">{statusText}</span>
                          : <span>{node.status === 'done' ? '' : '图片不可用'}</span>}
                        {node.status === 'error' && node.error && (isNetworkFailure || imageDownloadFailure ? (
                          <>
                            {failureEndpoint && <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">失败接口：{getFailureEndpointLabel(failureEndpoint)}</span>}
                            {(node.failure?.requestId || node.task?.requestId || taskIds.length > 0) && (
                              <span className="flex max-w-[92%] flex-col items-center gap-1 text-center font-mono text-sm leading-5 text-yellow-700/90 dark:text-yellow-300/90">
                                {node.failure?.requestId && <span className="flex max-w-full items-center gap-1 break-all"><span>image_request_id: {node.failure.requestId}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-yellow-700 hover:bg-yellow-200/70 dark:text-yellow-300 dark:hover:bg-yellow-900/50" aria-label="复制图片 request_id" title="复制图片 request_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('request_id', node.failure!.requestId!) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>}
                                {node.task?.requestId && <span className="flex max-w-full items-center gap-1 break-all"><span>request_id: {node.task.requestId}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-yellow-700 hover:bg-yellow-200/70 dark:text-yellow-300 dark:hover:bg-yellow-900/50" aria-label="复制 request_id" title="复制 request_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('request_id', node.task!.requestId!) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>}
                                {taskIds.map((id) => <span key={id} className="flex max-w-full items-center gap-1 break-all"><span>task_id: {id}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-yellow-700 hover:bg-yellow-200/70 dark:text-yellow-300 dark:hover:bg-yellow-900/50" aria-label="复制 task_id" title="复制 task_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('task_id', id) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>)}
                              </span>
                            )}
                          </>
                        ) : (
                          <>
                            {failureEndpoint && <span className="text-sm font-medium text-red-700 dark:text-red-300">失败接口：{getFailureEndpointLabel(failureEndpoint)}</span>}
                            {failureRetryCount !== undefined && <span className="text-xs text-red-600/80 dark:text-red-300/80">自动重试：{failureRetryCount} 次</span>}
                            <span className="flex max-w-[92%] items-center gap-1">
                              <span className="max-h-24 min-w-0 flex-1 overflow-hidden break-words text-center text-base leading-6 text-red-700 dark:text-red-300" title={node.error}>{node.error}</span>
                              <button type="button" data-canvas-handle className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-200/70 dark:text-red-300 dark:hover:bg-red-900/50" aria-label="复制错误原因" title="复制错误原因" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureError(node.error!) }}><CopyIcon className="h-4 w-4" /></button>
                              {editingMode && node.task && <button type="button" data-canvas-handle disabled={retryingTaskIds.has(node.task.id)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-red-600 transition hover:bg-red-200/70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-900/50" aria-label="重试生成" title={retryingTaskIds.has(node.task.id) ? '正在重试' : '重试生成'} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleRetryTask(node.task!, node.failure?.requestIndex ?? node.outputRequestIndex) }}><RefreshIcon className={`h-4 w-4 ${retryingTaskIds.has(node.task.id) ? 'animate-spin' : ''}`} /></button>}
                            </span>
                            {(node.failure?.status || failureRetryCount !== undefined || node.failure?.requestId || node.task?.requestId || taskIds.length > 0) && (
                              <span className="flex max-w-[92%] flex-col items-center gap-1 text-center font-mono text-base leading-6 text-red-600/90 dark:text-red-300/90">
                                {node.failure?.status && <span>HTTP status: {node.failure.status}</span>}
                                {node.failure?.requestId && <span className="flex max-w-full items-center gap-1 break-all"><span>image_request_id: {node.failure.requestId}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-200/70 dark:text-red-300 dark:hover:bg-red-900/50" aria-label="复制图片 request_id" title="复制图片 request_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('request_id', node.failure!.requestId!) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>}
                                {node.task?.requestId && <span className="flex max-w-full items-center gap-1 break-all"><span>request_id: {node.task.requestId}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-200/70 dark:text-red-300 dark:hover:bg-red-900/50" aria-label="复制 request_id" title="复制 request_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('request_id', node.task!.requestId!) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>}
                                {taskIds.map((id) => <span key={id} className="flex max-w-full items-center gap-1 break-all"><span>task_id: {id}</span><button type="button" data-canvas-handle className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-red-600 hover:bg-red-200/70 dark:text-red-300 dark:hover:bg-red-900/50" aria-label="复制 task_id" title="复制 task_id" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); void handleCopyFailureId('task_id', id) }}><CopyIcon className="h-3.5 w-3.5" /></button></span>)}
                              </span>
                            )}
                          </>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedVisible && selectedNode?.id === node.id && (
                  <div
                    className="absolute bottom-full left-0 mb-4 flex max-w-44 items-end gap-1 text-[#3f78c5]"
                    data-canvas-image-name-container
                    onPointerDown={(event) => event.stopPropagation()}
                    style={{ transform: `scale(${metadataScale})`, transformOrigin: 'left bottom' }}
                  >
                    <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 cursor-text truncate font-sans text-xs font-medium leading-4">
                      {label}
                    </span>
                    <button
                      type="button"
                      data-canvas-handle
                      aria-label="复制图片 ID"
                      title="复制图片 ID"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#3f78c5] hover:bg-[#3f78c5]/15 hover:text-[#3f78c5]"
                      onClick={() => void handleCopyImageId(node.id)}
                    >
                      <CopyIcon className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {selectedVisible && selectedNode?.id === node.id && displayDimensions && viewport.scale * node.item.width >= 160 && (
                  <span
                    className="absolute bottom-full right-0 mb-4 whitespace-nowrap font-sans text-xs font-medium leading-4 text-[#3f78c5]"
                    style={{ transform: `scale(${metadataScale})`, transformOrigin: 'right bottom' }}
                  >
                    {displayDimensions.width} × {displayDimensions.height}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {nodes.map((node) => (
          <CanvasEdgeIndicator
            key={`edge:${node.id}`}
            node={node}
            item={node.item}
            ratio={node.ratio}
            viewport={viewport}
            containerSize={containerSize}
            onClick={() => focusCanvasImage(node.id)}
          />
        ))}
        {nodes.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">该画布暂无图片</div>}
        {selectedToolbarPosition && selectedNode && (
          <div
            data-canvas-toolbar
            className="absolute z-40 flex max-w-[calc(100%-1rem)] items-center gap-0.5 overflow-x-auto rounded-md border border-gray-200 bg-white/95 p-1 shadow-lg backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95"
            style={{ left: selectedToolbarPosition.left, top: selectedToolbarPosition.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <TooltipButton tooltip="图片信息" onClick={() => setInfoImageId((current) => current === selectedNode.id ? null : selectedNode.id)} className={toolbarButtonClass}>
              <InfoIcon className="h-4 w-4" />
            </TooltipButton>
          </div>
        )}
        {transformPanelPosition && selectedItem && (
          <div
            data-canvas-toolbar
            data-canvas-image-info-panel
            className="absolute z-40 flex h-[80px] w-[128px] flex-col justify-center gap-0.5 rounded-md border border-gray-200 bg-white/95 px-2 py-1.5 shadow-lg backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95"
            style={{ left: transformPanelPosition.left, top: transformPanelPosition.top }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="mb-1.5 font-sans text-xs font-semibold leading-4 text-gray-700 dark:text-gray-200">图片变换</div>
            <div className="flex h-5 items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-sans text-xs font-medium leading-5 tabular-nums text-[#3f78c5]"><AngleIcon className="h-4 w-4" />{Math.round(selectedRotation)}°</span>
            </div>
            <div className="flex h-5 items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-sans text-xs font-medium leading-5 tabular-nums text-[#3f78c5]"><ScaleIcon className="h-4 w-4" />{Math.round(selectedScale * 100)}%</span>
            </div>
          </div>
        )}
        <DetailModal
          taskOverride={agentDetailTask ?? infoNode?.task ?? null}
          imageIdOverride={!agentDetailTask && infoNode?.status === 'done' ? infoNode.id : undefined}
          outputRequestIndexOverride={!agentDetailTask && infoNode?.status === 'error' ? infoNode.outputRequestIndex : undefined}
          imageOverrides={imageOverrides}
          readOnly
          onClose={() => {
            setInfoImageId(null)
            setAgentDetailTask(null)
          }}
        />
        <div
          ref={zoomControlsRef}
          data-canvas-toolbar
          data-canvas-zoom-controls
          className={`pointer-events-auto fixed bottom-2 z-[150] flex items-center rounded-md border border-gray-200 bg-white/95 p-1 text-xs shadow-sm backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95 sm:bottom-3 ${agentPanelCollapsed ? 'right-2 sm:right-3' : 'right-2 sm:right-3 xl:right-[428px]'}`}
          style={{ zIndex: 150 }}
        >
          {!zoomControlsCollapsed && layersOpen && (
            <div
              data-canvas-layers-panel
              className="absolute bottom-full left-0 mb-2 w-56 overflow-hidden rounded-md border border-gray-200 bg-white/95 p-2 text-xs shadow-lg backdrop-blur dark:border-white/[0.1] dark:bg-gray-900/95"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-1.5 font-medium text-gray-800 dark:text-gray-100">图层</div>
              <div data-canvas-scrollable className="max-h-64 overflow-y-auto overscroll-contain">
                {[...nodes].sort((a, b) => b.item.z - a.item.z).map((node) => {
                  const label = node.item.name ?? node.id
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition ${node.id === selectedImageId ? 'bg-[#3f78c5]/12 text-[#3f78c5]' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.08]'}`}
                      onClick={() => {
                        focusCanvasImage(node.id)
                        setLayersOpen(false)
                        setMinimapOpen(false)
                        setZoomHelpOpen(false)
                      }}
                    >
                      {node.image?.dataUrl
                        ? <img src={node.image.dataUrl} alt="" className="h-4 w-4 shrink-0 rounded object-cover" />
                        : <ImageIcon className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />}
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <span className="shrink-0 tabular-nums text-[10px] text-gray-400">z{Math.round(node.item.z)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {!zoomControlsCollapsed && minimapOpen && minimapData && (
            <div className="absolute bottom-full left-0 mb-2 w-60 text-xs shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
              <div className="relative h-36 overflow-hidden rounded border border-gray-200 bg-gray-100 dark:border-white/[0.1] dark:bg-gray-800">
                <div
                  className="absolute z-20 cursor-move border border-[#3f78c5] bg-[#3f78c5]/10"
                  style={{
                    left: `${Math.max(0, Math.min(100, minimapData.viewport.left))}%`,
                    top: `${Math.max(0, Math.min(100, minimapData.viewport.top))}%`,
                    width: `${Math.max(2, Math.min(100, minimapData.viewport.width))}%`,
                    height: `${Math.max(2, Math.min(100, minimapData.viewport.height))}%`,
                  }}
                  onPointerDown={handleMinimapDragStart}
                  onPointerMove={handleMinimapDragMove}
                  onPointerUp={handleMinimapDragEnd}
                  onPointerCancel={handleMinimapDragEnd}
                />
                {minimapData.entries.map(({ node, item, height }) => {
                  const label = item.name ?? node.id
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-label={`跳转到${label}`}
                      title={label}
                      className={`absolute z-30 min-h-1 min-w-1 rounded-sm ${node.id === selectedImageId ? 'bg-[#3f78c5] ring-2 ring-[#3f78c5]/40' : 'bg-[#3f78c5]/65 hover:bg-[#3f78c5]'}`}
                      style={{
                        left: `${(item.x - minimapData.bounds.minX) / minimapData.bounds.width * 100}%`,
                        top: `${(item.y - minimapData.bounds.minY) / minimapData.bounds.height * 100}%`,
                        width: `${Math.max(1.5, item.width / minimapData.bounds.width * 100)}%`,
                        height: `${Math.max(1.5, height / minimapData.bounds.height * 100)}%`,
                      }}
                      onClick={() => focusCanvasImage(node.id)}
                    />
                  )
                })}
              </div>
            </div>
          )}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            aria-label={zoomControlsCollapsed ? '展开画布工具栏' : '收起画布工具栏'}
            title={zoomControlsCollapsed ? '展开画布工具栏' : '收起画布工具栏'}
            aria-expanded={!zoomControlsCollapsed}
            onClick={() => {
              setZoomControlsCollapsed((collapsed) => !collapsed)
              setZoomPresetOpen(false)
              setLayersOpen(false)
              setMinimapOpen(false)
              setZoomHelpOpen(false)
              setZoomEditing(false)
            }}
          >
            {zoomControlsCollapsed ? <ChevronLeftIcon className="h-4 w-4" /> : <ChevronRightIcon className="h-4 w-4" />}
          </button>
          <div className={`flex items-center overflow-hidden transition-[max-width,opacity,transform] duration-200 ease-out ${zoomControlsCollapsed ? 'pointer-events-none max-w-0 -translate-x-2 opacity-0' : 'max-w-[28rem] translate-x-0 opacity-100'}`}>
          <button
            type="button"
            className={`flex h-7 w-7 items-center justify-center rounded text-[#3f78c5] transition ${zoomHelpOpen ? 'bg-[#3f78c5]/15' : 'hover:bg-[#3f78c5]/10'}`}
            aria-label="画布操作说明"
            title="画布操作说明"
            onClick={() => {
              setZoomHelpOpen((open) => !open)
              setLayersOpen(false)
              setMinimapOpen(false)
              setZoomPresetOpen(false)
            }}
          >
            <InfoIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`flex h-7 w-7 items-center justify-center rounded transition ${layersOpen ? 'bg-[#3f78c5]/15 text-[#3f78c5]' : 'hover:bg-gray-100 dark:hover:bg-white/[0.08]'}`}
            aria-label="图层"
            title="图层"
            onClick={() => {
              setLayersOpen((open) => !open)
              setMinimapOpen(false)
              setZoomHelpOpen(false)
              setZoomPresetOpen(false)
            }}
          >
            <LayersIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`flex h-7 w-7 items-center justify-center rounded transition ${minimapOpen ? 'bg-[#3f78c5]/15 text-[#3f78c5]' : 'hover:bg-gray-100 dark:hover:bg-white/[0.08]'}`}
            aria-label="小地图"
            title="小地图"
            onClick={() => {
              setMinimapOpen((open) => !open)
              setLayersOpen(false)
              setZoomHelpOpen(false)
              setZoomPresetOpen(false)
            }}
          >
            <MapIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            aria-label="回到画布原点"
            title="回到画布原点"
            onClick={() => setViewport((current) => ({ ...current, x: containerSize.width / 2, y: containerSize.height / 2 }))}
          >
            <HomeIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="h-7 w-7 rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            aria-label="缩小画布"
            title="缩小画布"
            onClick={() => zoomTo(viewport.scale / 1.2)}
          >
            <ZoomOutIcon className="mx-auto h-3.5 w-3.5" />
          </button>
          <div className="relative">
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
                onBlur={commitCanvasZoomInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCanvasZoomInput()
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
              >
                {Math.round(viewport.scale * 100)}%
              </button>
            )}
            {zoomPresetOpen && !zoomEditing && (
              <div
                data-canvas-zoom-preset
                className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-md border border-gray-200 bg-white p-1 text-[11px] shadow-lg dark:border-white/[0.1] dark:bg-gray-900"
                onPointerDown={(event) => event.stopPropagation()}
              >
                {[50, 100, 200].map((percent) => (
                  <button
                    key={percent}
                    type="button"
                    className="rounded px-2 py-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]"
                    onClick={() => setCanvasZoomPercent(percent)}
                  >
                    {percent}%
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className="h-7 w-7 rounded hover:bg-gray-100 dark:hover:bg-white/[0.08]"
            aria-label="放大画布"
            title="放大画布"
            onClick={() => zoomTo(viewport.scale * 1.2)}
          >
            <ZoomInIcon className="mx-auto h-3.5 w-3.5" />
          </button>
          </div>
          {!zoomControlsCollapsed && zoomHelpOpen && (
            <div
              className="absolute bottom-full right-0 mb-2 w-80 rounded-md border border-gray-200 bg-white p-4 text-xs leading-6 text-gray-600 shadow-lg dark:border-white/[0.1] dark:bg-gray-900 dark:text-gray-300"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="mb-1 text-sm font-medium text-gray-800 dark:text-gray-100">画布操作说明</div>
              <div>滚轮：{canvasWheelMode === 'zoom' ? '缩放画布' : '移动位置'}</div>
              <div>Ctrl + 滚轮：缩放画布</div>
              <div>双指：缩放画布</div>
              <div>空白拖动：平移画布</div>
              <div>点击图片：选中图片并显示信息</div>
              <div>图层 / 小地图：快速跳转图片</div>
              <div>双击缩放比例：输入缩放百分比</div>
            </div>
          )}
        </div>
      </div>
        </main>
        <div data-no-drag-select className={`relative hidden min-w-0 border-gray-200 bg-white transition-[transform,opacity] duration-300 ease-in-out xl:block xl:border-l xl:fixed xl:right-0 xl:top-14 xl:bottom-0 xl:z-30 xl:w-[420px] xl:overflow-hidden dark:border-white/[0.08] dark:bg-gray-950 ${agentPanelCollapsed ? 'pointer-events-none translate-x-full opacity-0' : 'translate-x-0 opacity-100'}`}>
          <AgentWorkspace embedded readOnly tasksOverride={tasks} conversationsOverride={agentConversations} projectIdOverride={project.id} onTaskClick={setAgentDetailTask} onCollapse={() => setAgentPanelCollapsed(true)} />
        </div>
        <button
          type="button"
          onClick={() => setAgentPanelCollapsed(false)}
          className={`fixed right-0 top-16 z-30 hidden rounded-l-lg border border-r-0 border-gray-200 bg-white/90 p-2 text-gray-500 shadow-sm backdrop-blur transition-[transform,opacity,background-color,color] duration-300 ease-in-out hover:bg-gray-100 hover:text-gray-800 dark:border-white/[0.08] dark:bg-gray-900/90 dark:hover:bg-white/[0.08] dark:hover:text-gray-200 xl:flex ${agentPanelCollapsed ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'}`}
          title="展开 Agent"
          aria-label="展开 Agent"
          aria-hidden={!agentPanelCollapsed}
          tabIndex={agentPanelCollapsed ? 0 : -1}
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
