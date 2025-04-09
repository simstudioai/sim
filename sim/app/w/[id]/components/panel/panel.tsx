'use client'

import { useEffect, useState } from 'react'
import { PanelRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { usePanelStore } from '../../../../../stores/panel/store'
import { Console } from './components/console/console'
import { Variables } from './components/variables/variables'

export function Panel() {
  const [width, setWidth] = useState(336) // 84 * 4 = 336px (default width)
  const [isDragging, setIsDragging] = useState(false)

  const isOpen = usePanelStore((state) => state.isOpen)
  const togglePanel = usePanelStore((state) => state.togglePanel)
  const activeTab = usePanelStore((state) => state.activeTab)
  const setActiveTab = usePanelStore((state) => state.setActiveTab)

  const clearConsole = useConsoleStore((state) => state.clearConsole)
  const { activeWorkflowId } = useWorkflowRegistry()

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
            onClick={togglePanel}
            className="fixed right-4 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:text-foreground hover:bg-accent border"
          >
            <PanelRight className="h-5 w-5" />
            <span className="sr-only">Open Panel</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Open Panel</TooltipContent>
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
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              activeTab === 'console'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            Console
          </button>
          <button
            onClick={() => setActiveTab('variables')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              activeTab === 'variables'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            Variables
          </button>
        </div>

        {activeTab === 'console' && (
          <button
            onClick={() => clearConsole(activeWorkflowId)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              true ? 'text-muted-foreground hover:text-foreground hover:bg-accent/50' : ''
            }`}
          >
            Clear
          </button>
        )}
      </div>

      <div className="h-[calc(100%-4rem)]">
        {activeTab === 'console' ? (
          <Console panelWidth={width} />
        ) : (
          <Variables panelWidth={width} />
        )}
      </div>

      <div className="absolute left-0 right-0 bottom-0 h-16 bg-background border-t">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={togglePanel}
              className="absolute left-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
            >
              <PanelRight className="h-5 w-5 transform rotate-180" />
              <span className="sr-only">Close Panel</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Close Panel</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
