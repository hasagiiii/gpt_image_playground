import { useEffect, useState } from 'react'
import { listAdminUserMaterials } from '../lib/admin'
import { getMaterialKey, type MaterialItem } from '../lib/materialApi'
import { ExportIcon, ImageIcon, SearchIcon } from './icons'

const MATERIAL_KIND_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'audio', label: '音频' },
  { value: 'video', label: '视频' },
] as const

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '未知大小'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN')
}

function getMaterialKind(item: MaterialItem) {
  if (item.content_type.toLowerCase().startsWith('video/') || item.kind === 'video') return 'video'
  if (item.content_type.toLowerCase().startsWith('audio/') || item.kind === 'audio') return 'audio'
  return 'image'
}

export default function AdminMaterialLibrary({ userId }: { userId: string }) {
  const [items, setItems] = useState<MaterialItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pageSize = 24
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    void listAdminUserMaterials(userId, { page, pageSize, kind, keyword: query })
      .then((result) => {
        if (cancelled) return
        setItems(Array.isArray(result.items) ? result.items : [])
        setTotal(Number.isFinite(result.total) ? result.total : 0)
      })
      .catch((err) => {
        if (cancelled) return
        setItems([])
        setTotal(0)
        setError(err instanceof Error ? err.message : '用户素材列表加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, page, query, userId])

  return (
    <div data-admin-material-library>
      <div className="border-b border-gray-200 px-4 py-3 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex min-w-52 flex-1 items-center gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(keyword.trim()) }}>
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材文件名" className="h-9 w-full rounded border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#3f78c5] dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-white" />
            </div>
            <button type="submit" className="h-9 shrink-0 rounded border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.06]">搜索</button>
          </form>
          <span className="shrink-0 rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 dark:border-white/[0.1] dark:text-gray-400">只读 · {total} 个素材</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1" aria-label="用户素材类型筛选">
          {MATERIAL_KIND_OPTIONS.map((option) => (
            <button key={option.value || 'all'} type="button" aria-pressed={kind === option.value} onClick={() => { setPage(1); setKind(option.value) }} className={`rounded px-3 py-1 text-xs font-medium transition ${kind === option.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white'}`}>{option.label}</button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="m-4 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">{error}</div>
      ) : loading ? (
        <div className="p-10 text-center text-sm text-gray-500">加载素材中...</div>
      ) : items.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-500">该用户暂无素材</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => {
            const materialKind = getMaterialKind(item)
            const kindLabel = materialKind === 'video' ? '视频' : materialKind === 'audio' ? '音频' : '图片'
            return (
              <article key={getMaterialKey(item, index)} className="overflow-hidden rounded border border-gray-200 bg-white dark:border-white/[0.1] dark:bg-white/[0.03]">
                <div className="aspect-square bg-gray-100 dark:bg-white/[0.04]">
                  {materialKind === 'video' ? (
                    <video src={item.url} controls preload="metadata" className="h-full w-full object-contain" />
                  ) : materialKind === 'audio' ? (
                    <div className="flex h-full items-center px-3"><audio src={item.url} controls preload="metadata" className="w-full" /></div>
                  ) : item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.file_name}`} className="block h-full w-full"><img src={item.url} alt={item.file_name} loading="lazy" className="h-full w-full object-cover" /></a>
                  ) : (
                    <div className="flex h-full items-center justify-center"><ImageIcon className="h-8 w-8 text-gray-300" /></div>
                  )}
                </div>
                <div className="flex items-start gap-2 p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-gray-800 dark:text-gray-200" title={item.file_name}>{item.file_name || '未命名素材'}</p>
                    <p className="mt-1 truncate text-[11px] text-gray-400">{kindLabel} · {formatBytes(item.size_bytes)}{formatDate(item.created_at) ? ` · ${formatDate(item.created_at)}` : ''}</p>
                  </div>
                  {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`在新窗口查看${item.file_name}`} title="在新窗口查看" className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.08] dark:hover:text-white"><ExportIcon className="h-3.5 w-3.5" /></a>}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 border-t border-gray-100 px-4 py-3 text-sm dark:border-white/[0.06]">
          <button type="button" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded border border-gray-200 px-3 py-1.5 text-gray-600 disabled:opacity-40 dark:border-white/[0.1] dark:text-gray-300">上一页</button>
          <span className="tabular-nums text-gray-400">{page} / {totalPages}</span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="rounded border border-gray-200 px-3 py-1.5 text-gray-600 disabled:opacity-40 dark:border-white/[0.1] dark:text-gray-300">下一页</button>
        </div>
      )}
    </div>
  )
}
