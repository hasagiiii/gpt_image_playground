export function formatKeyboardShortcut(event: KeyboardEvent) {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null
  const parts = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
  ].filter(Boolean)
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key
  return [...parts, key].join('+')
}

export function matchesKeyboardShortcut(event: KeyboardEvent, shortcut: string) {
  const parts = shortcut.split('+').map((part) => part.trim().toLowerCase()).filter(Boolean)
  const key = parts.pop()?.toLowerCase()
  if (!key || event.key.toLowerCase() !== key) return false
  return event.ctrlKey === parts.includes('ctrl') && event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift') && event.metaKey === (parts.includes('meta') || parts.includes('cmd') || parts.includes('command'))
}
