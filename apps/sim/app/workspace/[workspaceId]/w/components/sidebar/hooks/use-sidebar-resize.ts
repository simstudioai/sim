import { useCallback } from 'react'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Handles sidebar drag-resize with zero React renders during the drag.
 *
 * Architecture (confirmed industry best-practice for resize handles):
 *
 * mousedown  → add `is-resizing` class directly to DOM (no React round-trip,
 *              so the CSS width transition is suppressed from the very first frame)
 * mousemove  → write to --sidebar-width CSS custom property inside a
 *              requestAnimationFrame callback (aligns work with the browser
 *              paint cycle; mousemove fires faster than 60fps on modern hardware
 *              so without RAF we'd do redundant writes between paints)
 * mouseup    → cancel any pending RAF, persist final width to Zustand once
 *              (one React re-render to save to localStorage and sync
 *              components that read sidebarWidth from state)
 */
export function useSidebarResize() {
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth)

  const handleMouseDown = useCallback(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar-container')
    sidebar?.classList.add('is-resizing')
    document.documentElement.classList.add('sidebar-resizing')
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    let rafId: number | null = null

    const onMouseMove = (e: MouseEvent) => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const clamped = Math.min(
          Math.max(e.clientX, SIDEBAR_WIDTH.MIN),
          window.innerWidth * SIDEBAR_WIDTH.MAX_PERCENTAGE
        )
        document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
        rafId = null
      })
    }

    const onMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      sidebar?.classList.remove('is-resizing')
      document.documentElement.classList.remove('sidebar-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)

      const raw = document.documentElement.style.getPropertyValue('--sidebar-width')
      const finalWidth = Number.parseFloat(raw)
      if (!Number.isNaN(finalWidth)) setSidebarWidth(finalWidth)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [setSidebarWidth])

  return { handleMouseDown }
}
