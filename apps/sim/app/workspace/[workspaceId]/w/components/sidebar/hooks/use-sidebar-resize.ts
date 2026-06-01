import { useCallback } from 'react'
import { SIDEBAR_WIDTH } from '@/stores/constants'
import { useSidebarStore } from '@/stores/sidebar/store'

/**
 * Handles sidebar drag-resize with zero React renders during the drag.
 *
 * On mousedown:
 *   - Adds `is-resizing` to the sidebar DOM node immediately (no React render lag,
 *     so the CSS transition is suppressed from the very first frame).
 *   - Registers native mousemove/mouseup listeners.
 *
 * On mousemove:
 *   - Writes the new width directly to the `--sidebar-width` CSS custom property.
 *   - Does NOT touch React/Zustand state, so zero re-renders fire during the drag.
 *
 * On mouseup:
 *   - Persists the final width to Zustand exactly once (triggers one re-render to
 *     save to localStorage and sync dependent components).
 *   - Cleans up the `is-resizing` class and body cursor/select overrides.
 */
export function useSidebarResize() {
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth)

  const handleMouseDown = useCallback(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar-container')
    sidebar?.classList.add('is-resizing')
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (e: MouseEvent) => {
      const clamped = Math.min(
        Math.max(e.clientX, SIDEBAR_WIDTH.MIN),
        window.innerWidth * SIDEBAR_WIDTH.MAX_PERCENTAGE
      )
      document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`)
    }

    const onMouseUp = () => {
      sidebar?.classList.remove('is-resizing')
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
