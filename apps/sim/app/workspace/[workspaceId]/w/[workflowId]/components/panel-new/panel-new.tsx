'use client'

import { useRef } from 'react'
import { Button } from '@/components/emcn'
import { BubbleChatPreview, MoreHorizontal, Play, Rocket } from '@/components/emcn/icons'
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
          {/* Header */}
          <div className='flex flex-shrink-0 items-center justify-between px-[8px]'>
            <div className='flex gap-[4px]'>
              <Button className='h-[32px] w-[32px]'>
                <MoreHorizontal />
              </Button>
              <Button className='h-[32px] w-[32px]'>
                <BubbleChatPreview />
              </Button>
            </div>
            <div className='flex gap-[4px]'>
              <Button className='h-[32px] gap-[8px] px-[10px]'>
                <Rocket className='h-[13px] w-[13px]' />
                Deploy
              </Button>
              <Button className='h-[32px] gap-[8px] px-[10px]' variant='primary'>
                <Play className='h-[11px] w-[11px]' />
                Run
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className='flex flex-shrink-0 items-center gap-[4px] px-[8px] pt-[14px]'>
            <Button className='h-[30px] gap-[8px] px-[10px]' variant='ghost'>
              Design
            </Button>
            <Button className='h-[30px] gap-[8px] px-[10px]' variant='active'>
              Copilot
            </Button>
            <Button className='h-[30px] gap-[8px] px-[10px]' variant='ghost'>
              Variables
            </Button>
          </div>
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
