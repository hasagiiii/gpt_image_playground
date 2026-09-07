import { useState } from 'react'
import type { AppSettings } from '../../types'
import Select from '../Select'
import { formatKeyboardShortcut } from '../../lib/keyboardShortcuts'

interface CanvasSettingsTabProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

export default function CanvasSettingsTab({ draft, commitSettings }: CanvasSettingsTabProps) {
  const [shortcutFocused, setShortcutFocused] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">滚轮滚动</span>
          <div className="w-32 shrink-0">
            <Select
              value={draft.canvasWheelMode}
              onChange={(value) => commitSettings({ ...draft, canvasWheelMode: value === 'zoom' ? 'zoom' : 'pan' })}
              options={[
                { label: '移动位置', value: 'pan' },
                { label: '缩放画布', value: 'zoom' },
              ]}
              ariaLabel="滚轮滚动"
              className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
            />
          </div>
        </div>
        <div data-selectable-text className="text-xs leading-relaxed text-gray-500 dark:text-gray-500">
          设置画布中普通滚轮的操作方式。按住 Ctrl + 滚轮始终缩放画布。
        </div>
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">移动模式快捷键</span>
          <div className="relative">
            <input
              aria-label="移动模式快捷键"
              aria-describedby={shortcutFocused ? 'canvas-shortcut-hint' : undefined}
              value={draft.canvasPanModeShortcut}
              readOnly
              onFocus={() => setShortcutFocused(true)}
              onBlur={() => setShortcutFocused(false)}
              onKeyDown={(event) => {
                const shortcut = formatKeyboardShortcut(event.nativeEvent)
                if (!shortcut) return
                event.preventDefault()
                commitSettings({ ...draft, canvasPanModeShortcut: shortcut })
                setShortcutFocused(false)
                event.currentTarget.blur()
              }}
              onChange={() => undefined}
              className={`h-8 w-14 cursor-pointer rounded-lg border bg-white/50 text-center text-sm uppercase text-gray-700 outline-none transition dark:bg-white/[0.03] dark:text-gray-200 ${shortcutFocused ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400/30 dark:border-blue-400 dark:bg-blue-400/10' : 'border-gray-200/60 dark:border-white/[0.08]'}`}
            />
            {shortcutFocused && (
              <div id="canvas-shortcut-hint" role="status" className="absolute right-0 top-full z-20 mt-2 w-56 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700 shadow-lg dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200">
                现在可以按键配置快捷键
              </div>
            )}
          </div>
        </div>
        <div className="text-xs leading-relaxed text-gray-500 dark:text-gray-500">按下快捷键切换移动模式。</div>
      </div>
    </div>
  )
}
