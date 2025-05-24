import { ParallelTool } from "../../../parallel-node/parallel-config"
import { useCallback } from 'react'

// Custom component for the Parallel Tool
export default function ParallelToolbarItem () {
    const handleDragStart = (e: React.DragEvent) => {
      // Only send the essential data for the parallel node
      const simplifiedData = {
        type: 'parallel'
      }
      e.dataTransfer.setData('application/json', JSON.stringify(simplifiedData))
      e.dataTransfer.effectAllowed = 'move'
    }

    // Handle click to add parallel block
    const handleClick = useCallback((e: React.MouseEvent) => {
      // Dispatch a custom event to be caught by the workflow component
      const event = new CustomEvent('add-block-from-toolbar', {
        detail: {
          type: 'parallel',
          clientX: e.clientX,
          clientY: e.clientY
        },
      })
      window.dispatchEvent(event)
    }, [])

    return (
      <div
        draggable
        onDragStart={handleDragStart}
        onClick={handleClick}
        className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:bg-accent/50 cursor-pointer active:cursor-grabbing"
      >
        <div
          className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
          style={{ backgroundColor: ParallelTool.bgColor }}
        >
          <ParallelTool.icon className="text-white transition-transform duration-200 group-hover:scale-110 w-[22px] h-[22px]" />
        </div>
        <div className="flex flex-col gap-1 mb-[-2px]">
          <h3 className="font-medium leading-none">{ParallelTool.name}</h3>
          <p className="text-sm text-muted-foreground leading-snug">{ParallelTool.description}</p>
        </div>
      </div>
    )
  }
