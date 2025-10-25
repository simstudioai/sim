'use client'

import { useRef } from 'react'
import { BubbleChatPreview, Button, MoreHorizontal, Play, Rocket } from '@/components/emcn'
import { usePanelStore } from '@/stores/panel-new/store'
import type { PanelTab } from '@/stores/panel-new/types'
import { Copilot, Design } from './components'
import { usePanelResize } from './hooks/use-panel-resize'

/**
 * Panel component with resizable width and tab navigation that persists across page refreshes.
 *
 * Uses a CSS-based approach to prevent hydration mismatches:
 * 1. Width is controlled by CSS variable (--panel-width)
 * 2. Blocking script in layout.tsx can set CSS variable before React hydrates
 * 3. Store updates CSS variable when width changes
 *
 * This ensures server and client render identical HTML, preventing hydration errors.
 *
 * Note: All tabs are kept mounted but hidden to preserve component state during tab switches.
 * This prevents unnecessary remounting which would trigger data reloads and reset state.
 *
 * @returns Panel on the right side of the workflow
 */
export function Panel() {
  const panelRef = useRef<HTMLElement>(null)
  const { activeTab, setActiveTab, panelWidth } = usePanelStore()
  const copilotRef = useRef<{
    createNewChat: () => void
    setInputValueAndFocus: (value: string) => void
  }>(null)

  // Panel resize hook
  const { handleMouseDown } = usePanelResize()

  /**
   * Handles tab click events
   */
  const handleTabClick = (tab: PanelTab) => {
    setActiveTab(tab)
  }

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
              <Button className='h-[32px] gap-[8px] px-[10px]' variant='active'>
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
            <Button
              className='px-[8px] py-[5px] text-[12.5px] hover:bg-[#353535] hover:text-[#E6E6E6] dark:hover:bg-[#353535] dark:hover:text-[#E6E6E6]'
              variant={activeTab === 'copilot' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('copilot')}
            >
              Copilot
            </Button>
            <Button
              className='px-[8px] py-[5px] text-[12.5px] hover:bg-[#353535] hover:text-[#E6E6E6] dark:hover:bg-[#353535] dark:hover:text-[#E6E6E6]'
              variant={activeTab === 'design' ? 'active' : 'ghost'}
              onClick={() => handleTabClick('design')}
            >
              Design
            </Button>
          </div>

          {/* Tab Content - Keep all tabs mounted but hidden to preserve state */}
          <div className='flex-1 overflow-hidden pt-[12px]'>
            <div className={activeTab === 'copilot' ? 'h-full' : 'hidden'}>
              <Copilot ref={copilotRef} panelWidth={panelWidth} />
            </div>
            <div className={activeTab === 'design' ? 'h-full' : 'hidden'}>
              <Design />
            </div>
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
