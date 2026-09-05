import { useLayoutEffect, type RefObject } from 'react'

export function useInputBarClearance(cardRef: RefObject<HTMLElement | null>, mode: 'agent' | 'params') {
  useLayoutEffect(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    // 两个输入框可同时存在，不能相互覆盖或清除对方的底部留白。
    const property = mode === 'agent' ? '--agent-input-bar-clearance' : '--input-bar-clearance'
    const update = () => {
      const rect = bar.getBoundingClientRect()
      const clearance = rect.height > 0 ? Math.max(0, window.innerHeight - rect.top) : 0
      document.documentElement.style.setProperty(property, `${Math.ceil(clearance)}px`)
    }
    update()
    const frame = window.requestAnimationFrame(update)
    const observer = new ResizeObserver(update)
    observer.observe(bar)

    const visualViewport = window.visualViewport
    window.addEventListener('resize', update)
    visualViewport?.addEventListener('resize', update)
    visualViewport?.addEventListener('scroll', update)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      visualViewport?.removeEventListener('resize', update)
      visualViewport?.removeEventListener('scroll', update)
      document.documentElement.style.removeProperty(property)
    }
  }, [cardRef, mode])
}
