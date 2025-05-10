'use client'

import { useState } from 'react'
import { PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { SidebarMode, useSidebarStore } from '@/stores/sidebar/store'

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
          variant="ghost"
          size="icon"
          className="flex h-8 w-8 p-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 cursor-pointer"
        >
          <PanelRight className="h-[18px] w-[18px] text-muted-foreground" />
          <span className="sr-only text-sm">Sidebar control</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-44 p-0 shadow-md border overflow-hidden rounded-lg bg-background"
        side="top"
        align="start"
        sideOffset={5}
      >
        <div className="border-b py-[10px] px-4">
          <h4 className="text-xs font-[480] text-muted-foreground">Sidebar control</h4>
        </div>
        <div className="px-2 pt-1 pb-2">
          <div className="flex flex-col gap-[1px]">
            <button
              className={cn(
                'w-full text-left py-1.5 px-2 text-xs rounded hover:bg-accent/50 text-muted-foreground font-medium'
              )}
              onClick={() => handleModeChange('expanded')}
            >
              <span className="flex items-center">
                <span
                  className={cn(
                    'h-1 w-1 rounded-full mr-1.5',
                    mode === 'expanded' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                ></span>
                Expanded
              </span>
            </button>
            <button
              className={cn(
                'w-full text-left py-1.5 px-2 text-xs rounded hover:bg-accent/50 text-muted-foreground font-medium'
              )}
              onClick={() => handleModeChange('collapsed')}
            >
              <span className="flex items-center">
                <span
                  className={cn(
                    'h-1 w-1 rounded-full mr-1.5',
                    mode === 'collapsed' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                ></span>
                Collapsed
              </span>
            </button>
            <button
              className={cn(
                'w-full text-left py-1.5 px-2 text-xs rounded hover:bg-accent/50 text-muted-foreground font-medium'
              )}
              onClick={() => handleModeChange('hover')}
            >
              <span className="flex items-center">
                <span
                  className={cn(
                    'h-1 w-1 rounded-full mr-1.5',
                    mode === 'hover' ? 'bg-muted-foreground' : 'bg-transparent'
                  )}
                ></span>
                Expand on hover
              </span>
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
