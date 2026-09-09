import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TaskRecord } from '../types'
import { estimateModelPricing } from '../auth/oidcResource'
import { decomposeImage, ensureImageThumbnailCached, useStore } from '../store'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { DEFAULT_LAYER_PROMPT, SEEDREAM_LAYER_MODEL } from '../lib/seedreamLayers'
import { LayersIcon } from './icons'

export default function ImageLayerMenu({ task, imageId, disabled, className }: {
  task: TaskRecord
  imageId: string
  disabled: boolean
  className: string
}) {
  const settings = useStore((s) => s.settings)
  const override = useStore((s) => s.oidcApiOverride)
  const showToast = useStore((s) => s.showToast)
  const apiKey = override?.apiKey || getActiveApiProfile(settings).apiKey
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [price, setPrice] = useState('预估中...')
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const id = useId()

  const cancelClose = () => clearTimeout(closeTimer.current)
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }

  useEffect(() => () => clearTimeout(closeTimer.current), [])

  useEffect(() => {
    if (!open) return
    if (!apiKey) { setPrice('请先选择 API Key'); return }
    const controller = new AbortController()
    setPrice('预估中...')
    const timer = setTimeout(() => {
      void ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (controller.signal.aborted) return
        const size = thumbnail?.width && thumbnail.height ? `${thumbnail.width}x${thumbnail.height}` : 'auto'
        return estimateModelPricing(apiKey, SEEDREAM_LAYER_MODEL, {
          prompt: DEFAULT_LAYER_PROMPT,
          size,
          output_format: 'png',
          response_format: 'url',
          watermark: true,
          num_images: 1,
        }, { signal: controller.signal })
      }).then((result) => {
        if (controller.signal.aborted || !result) return
        const raw: unknown = result.unit_price ?? result.estimated_price
        const value = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN
        setPrice(Number.isFinite(value) && value >= 0 ? `≈ $${Number(value.toFixed(6))}/张` : '预估不可用')
      }).catch((err) => {
        if (controller.signal.aborted) return
        console.warn('分层价格预估失败', err)
        setPrice('预估不可用')
      })
    }, 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, apiKey, imageId])

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const anchor = triggerRef.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!anchor || !menu) return
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 8))
      const top = anchor.bottom + menu.offsetHeight + 8 <= window.innerHeight
        ? anchor.bottom + 4
        : Math.max(8, anchor.top - menu.offsetHeight - 4)
      setPosition({ left, top })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (!triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', keydown, true)
    }
  }, [open])

  const submit = async () => {
    if (disabled || submitting) return
    setSubmitting(true)
    try {
      await decomposeImage(task, imageId)
      setOpen(false)
    } catch (err) {
      console.warn('提交图片分层失败', err)
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <button ref={triggerRef} type="button" aria-label="分层" title="分层" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
      className={`${className} shrink-0`}
      onPointerEnter={(event) => { if (event.pointerType !== 'touch') { cancelClose(); setOpen(true) } }}
      onPointerLeave={scheduleClose}
      onClick={() => { cancelClose(); setOpen(true) }}
      onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus()) } }}
    ><LayersIcon className="h-4 w-4" /></button>
    {open && createPortal(
      <div ref={menuRef} id={`${id}-menu`} role="menu" aria-label="分层菜单" data-canvas-toolbar
        className="fixed z-[120] w-52 max-w-[calc(100vw-16px)] rounded-md border border-gray-200 bg-white p-1 text-xs shadow-lg dark:border-white/[0.1] dark:bg-gray-900"
        style={position} onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onPointerDown={(event) => event.stopPropagation()}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
        }}>
        <button type="button" role="menuitem" disabled={disabled || submitting} onClick={() => void submit()} className="flex h-9 w-full items-center gap-2 rounded px-2 text-gray-700 hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-white/[0.08]"><LayersIcon className="h-4 w-4" /><span className="min-w-0 flex-1 text-left">{disabled ? '分层中...' : submitting ? '提交中...' : '自定义分层'}</span><span role="status" className="shrink-0 font-medium tabular-nums text-gray-900 dark:text-white">{price}</span></button>
      </div>, document.body)}
  </>
}
