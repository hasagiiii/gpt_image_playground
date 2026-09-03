/** 把毫秒数格式化为 mm:ss，用于展示任务耗时。 */
export function formatDurationMs(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
