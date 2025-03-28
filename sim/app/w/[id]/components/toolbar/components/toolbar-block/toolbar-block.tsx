import { useCallback } from 'react'
import type { BlockConfig } from '@/blocks/types'

export type ToolbarBlockProps = {
  config: BlockConfig
}

export function ToolbarBlock({ config }: ToolbarBlockProps) {
  const handleDragStart = (e: React.DragEvent) => {
    // For agent instances, include the full config data
    const isAgentInstance = config.type.startsWith('agent_instance_');
    const payload = isAgentInstance 
      ? { type: config.type, config: config.config }
      : { type: config.type };
      
    e.dataTransfer.setData('application/json', JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'move'
  }

  // Handle click to add block
  const handleClick = useCallback(() => {
    if (config.type === 'connectionBlock') return

    // For agent instances, include config data in the event
    const isAgentInstance = config.type.startsWith('agent_instance_');
    const detail = isAgentInstance 
      ? { type: config.type, config: config.config }
      : { type: config.type };

    // Dispatch a custom event to be caught by the workflow component
    const event = new CustomEvent('add-block-from-toolbar', {
      detail
    })
    window.dispatchEvent(event)
  }, [config.type, config.config])

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={handleClick}
      className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 shadow-sm transition-colors hover:bg-accent/50 cursor-pointer active:cursor-grabbing"
    >
      <div
        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
        style={{ backgroundColor: config.bgColor }}
      >
        <config.icon
          className={`text-white transition-transform duration-200 group-hover:scale-110 ${
            config.type === 'agent' ? 'w-[24px] h-[24px]' : 'w-[22px] h-[22px]'
          }`}
        />
      </div>
      <div className="flex flex-col gap-1 mb-[-2px]">
        <h3 className="font-medium leading-none">{config.name}</h3>
        <p className="text-sm text-muted-foreground leading-snug">{config.description}</p>
      </div>
    </div>
  )
}
