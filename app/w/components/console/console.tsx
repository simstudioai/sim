'use client'

import { useEffect, useMemo, useState } from 'react'
import { PanelLeftClose, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConsoleStore } from '@/stores/console/store'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { ConsoleEntry } from './components/console-entry/console-entry'

export function Console() {
  const [width, setWidth] = useState(336) // 84 * 4 = 336px (default width)
  const [isDragging, setIsDragging] = useState(false)

  const isOpen = useConsoleStore((state) => state.isOpen)
  const toggleConsole = useConsoleStore((state) => state.toggleConsole)
  const entries = useConsoleStore((state) => state.entries)
  const clearConsole = useConsoleStore((state) => state.clearConsole)
  const { activeWorkflowId } = useWorkflowRegistry()

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => entry.workflowId === activeWorkflowId)
  }, [entries, activeWorkflowId])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    e.preventDefault()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const newWidth = window.innerWidth - e.clientX
        setWidth(Math.max(336, Math.min(newWidth, window.innerWidth * 0.8)))
      }
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging])

  if (!isOpen) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleConsole}
            className="fixed right-4 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:text-foreground hover:bg-accent border"
          >
            <Terminal className="h-5 w-5" />
            <span className="sr-only">Open Console</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Open Console</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      className="fixed right-0 top-16 z-10 h-[calc(100vh-4rem)] border-l bg-background"
      style={{ width: `${width}px` }}
    >
      <div
        className="absolute left-[-4px] top-0 bottom-0 w-4 cursor-ew-resize hover:bg-accent/50 z-50"
        onMouseDown={handleMouseDown}
      />

      <div className="flex items-center justify-between h-14 px-4 border-b">
        <h2 className="text-sm font-medium">Console</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => clearConsole(activeWorkflowId)}
          className="text-muted-foreground hover:text-foreground"
        >
          Clear
        </Button>
      </div>

      <ScrollArea className="h-[calc(100%-4rem)]">
        <div className="pb-16">
          {filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground pt-4">
              No console entries
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <ConsoleEntry key={entry.id} entry={entry} consoleWidth={width} />
            ))
          )}
        </div>
      </ScrollArea>

      <div className="absolute left-0 right-0 bottom-0 h-16 bg-background border-t">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleConsole}
              className="absolute left-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
            >
              <PanelLeftClose className="h-5 w-5" />
              <span className="sr-only">Close Console</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Close Console</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
