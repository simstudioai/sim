import { useCallback } from 'react'
import { LoopTool } from '../../../loop-node/loop-config'

// Custom component for the Loop Tool
export default function LoopToolbarItem() {
  const handleDragStart = (e: React.DragEvent) => {
    // Only send the essential data for the loop node
    const simplifiedData = {
      type: 'loop',
    }
    e.dataTransfer.setData('application/json', JSON.stringify(simplifiedData))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add loop block
  const handleClick = useCallback((e: React.MouseEvent) => {
    // Dispatch a custom event to be caught by the workflow component
    const event = new CustomEvent('add-block-from-toolbar', {
      detail: {
        type: 'loop',
        clientX: e.clientX,
        clientY: e.clientY,
      },
    })
    window.dispatchEvent(event)
  }, [])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className='group flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:bg-accent/50 active:cursor-grabbing'
    >
      <div
        className='relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg'
        style={{ backgroundColor: LoopTool.bgColor }}
      >
        <LoopTool.icon className='h-[22px] w-[22px] text-white transition-transform duration-200 group-hover:scale-110' />
      </div>
      <div className='mb-[-2px] flex flex-col gap-1'>
        <h3 className='font-medium leading-none'>{LoopTool.name}</h3>
        <p className='text-muted-foreground text-sm leading-snug'>{LoopTool.description}</p>
      </div>
    </div>
  )
}
