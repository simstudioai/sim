import { memo } from 'react'
import { Handle, NodeProps, Position } from 'reactflow'
import { AgentIcon, ApiIcon, ConnectIcon } from '@/components/icons'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const icons = {
  api: ApiIcon,
  agent: AgentIcon,
  router: ConnectIcon,
}

export const HeroBlock = memo(({ data }: NodeProps) => {
  const Icon = icons[data.type as keyof typeof icons]

  return (
    <Card
      className={cn(
        'shadow-md select-none group relative cursor-default',
        'w-[200px]', // Default width
        'sm:w-[200px]', // Small screens and up
        'xs:w-[120px]' // Extra small screens
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          '!w-3 !h-3',
          '!bg-white !rounded-full !border !border-gray-200',
          'group-hover:!border-blue-500',
          '!cursor-crosshair',
          'transition-[border-color] duration-150',
          '!left-[-6px]'
        )}
      />
      <div className="flex items-center gap-3 p-3 workflow-drag-handle cursor-grab active:cursor-grabbing">
        <div
          className="flex items-center justify-center w-7 h-7 rounded"
          style={{ backgroundColor: data.color }}
        >
          <Icon className="w-5 h-5 text-white" />
        </div>
        <span className="font-medium text-md">{data.name}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          '!w-3 !h-3',
          '!bg-white !rounded-full !border !border-gray-200',
          'group-hover:!border-blue-500',
          '!cursor-crosshair',
          'transition-[border-color] duration-150',
          '!right-[-6px]'
        )}
      />
    </Card>
  )
})

HeroBlock.displayName = 'HeroBlock'
