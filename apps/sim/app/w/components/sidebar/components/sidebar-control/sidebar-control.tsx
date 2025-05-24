'use client'

import { useState } from 'react'
import { PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { type SidebarMode, useSidebarStore } from '@/stores/sidebar/store'

// This component ONLY controls sidebar state, not toolbar state
export function SidebarControl() {
  const { mode, setMode, toggleExpanded, isExpanded } = useSidebarStore()
  const [open, setOpen] = useState(false)

  const handleModeChange = (value: SidebarMode) => {
    // When selecting expanded mode, ensure it's expanded
    if (value === 'expanded' && !isExpanded) {
      toggleExpanded()
    }

    // Set the new mode
    setMode(value)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='flex h-8 w-8 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent/50'
        >
          <PanelRight className='h-[18px] w-[18px] text-muted-foreground' />
          <span className='sr-only text-sm'>Sidebar control</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-44 overflow-hidden rounded-lg border bg-background p-0 shadow-md'
        side='top'
        align='start'
        sideOffset={5}
      >
        <div className='border-b px-4 py-[10px]'>
          <h4 className='font-[480] text-muted-foreground text-xs'>Sidebar control</h4>
        </div>
        <div className='px-2 pt-1 pb-2'>
          <div className='flex flex-col gap-[1px]'>
            <button
              className={cn(
                'w-full rounded px-2 py-1.5 text-left font-medium text-muted-foreground text-xs hover:bg-accent/50'
              )}
              onClick={() => handleModeChange('expanded')}
            >
              <span className='flex items-center'>
                <span
                  className={cn(
                    'mr-1.5 h-1 w-1 rounded-full',
                    mode === 'expanded' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                />
                Expanded
              </span>
            </button>
            <button
              className={cn(
                'w-full rounded px-2 py-1.5 text-left font-medium text-muted-foreground text-xs hover:bg-accent/50'
              )}
              onClick={() => handleModeChange('collapsed')}
            >
              <span className='flex items-center'>
                <span
                  className={cn(
                    'mr-1.5 h-1 w-1 rounded-full',
                    mode === 'collapsed' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                />
                Collapsed
              </span>
            </button>
            <button
              className={cn(
                'w-full rounded px-2 py-1.5 text-left font-medium text-muted-foreground text-xs hover:bg-accent/50'
              )}
              onClick={() => handleModeChange('hover')}
            >
              <span className='flex items-center'>
                <span
                  className={cn(
                    'mr-1.5 h-1 w-1 rounded-full',
                    mode === 'hover' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                />
                Expand on hover
              </span>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
