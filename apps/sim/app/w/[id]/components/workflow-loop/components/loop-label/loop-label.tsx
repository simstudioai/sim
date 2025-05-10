import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NodeProps } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function LoopLabel({ id, data }: NodeProps) {
  // Extract the loop ID from the node ID
  const loopId = id.replace('loop-label-', '')

  // Get the loop type from the store
  const loop = useWorkflowStore((state) => state.loops[loopId])
  const updateLoopType = useWorkflowStore((state) => state.updateLoopType)

  // Local state for popover
  const [open, setOpen] = useState(false)

  // Default to 'for' if not set
  const loopType = loop?.loopType || 'for'

  // Get label based on loop type
  const getLoopLabel = () => {
    switch (loopType) {
      case 'for':
        return 'For loop'
      case 'forEach':
        return 'For each'
      default:
        return 'Loop'
    }
  }

  const handleLoopTypeChange = (type: 'for' | 'forEach') => {
    updateLoopType(loopId, type)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Badge
          variant="outline"
          className={cn(
            'bg-background border-border text-foreground font-medium pr-1.5 pl-2.5 py-0.5 text-sm',
            'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
            'flex items-center gap-1'
          )}
        >
          {getLoopLabel()}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="text-sm">
          <div
            className={cn(
              'px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors duration-150 flex items-center',
              loopType === 'for' && 'bg-accent'
            )}
            onClick={() => handleLoopTypeChange('for')}
          >
            <span>For loop</span>
          </div>
          <div
            className={cn(
              'px-2 py-1.5 rounded-md cursor-pointer hover:bg-accent/50 transition-colors duration-150 flex items-center',
              loopType === 'forEach' && 'bg-accent'
            )}
            onClick={() => handleLoopTypeChange('forEach')}
          >
            <span>For each</span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
