import type { AppSettings } from '../../types'
import Select from '../Select'

interface CanvasSettingsTabProps {
  draft: AppSettings
  commitSettings: (nextDraft: AppSettings) => void
}

export default function CanvasSettingsTab({ draft, commitSettings }: CanvasSettingsTabProps) {
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
    </div>
  )
}
