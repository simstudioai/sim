'use client'

import { useRef } from 'react'
import { usePanelResize } from './hooks/use-panel-resize'

/**
 * Panel component with resizable width that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Width is controlled by CSS variable (--panel-width)
 * 2. Blocking script in layout.tsx can set CSS variable before React hydrates
 * 3. Store updates CSS variable when width changes
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * @returns Panel on the right side of the workflow
 */
export function Panel() {
  const panelRef = useRef<HTMLElement>(null)

  // Panel resize hook
  const { handleMouseDown } = usePanelResize()

  return (
    <>
      <aside
        ref={panelRef}
        className='panel-container fixed inset-y-0 right-0 z-10 overflow-hidden dark:bg-[#1E1E1E]'
        aria-label='Workflow panel'
      >
        <div className='flex h-full flex-col border-l pt-[14px] dark:border-[#2C2C2C]'>
          <></>
        </div>
      </aside>

      {/* Resize Handle */}
      <div
        className='fixed top-0 right-[calc(var(--panel-width)-4px)] bottom-0 z-20 w-[8px] cursor-ew-resize'
        onMouseDown={handleMouseDown}
        role='separator'
        aria-orientation='vertical'
        aria-label='Resize panel'
      />
    </>
  )
}
