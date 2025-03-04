import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NodeProps } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function LoopInput({ id }: NodeProps) {
  // Extract the loop ID from the node ID
  const loopId = id.replace('loop-input-', '')

  // Get the max iterations from the store for this loop
  const maxIterations = useWorkflowStore((state) => state.loops[loopId]?.maxIterations ?? 5)
  const minIterations = useWorkflowStore((state) => state.loops[loopId]?.minIterations ?? 0)
  const updateLoopMaxIterations = useWorkflowStore((state) => state.updateLoopMaxIterations)
  const updateLoopMinIterations = useWorkflowStore((state) => state.updateLoopMinIterations)

  // Local state for input values
  const [maxInputValue, setMaxInputValue] = useState(maxIterations.toString())
  const [minInputValue, setMinInputValue] = useState(minIterations.toString())
  const [open, setOpen] = useState(false)

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = parseInt(sanitizedValue)

    // Only update if it's a valid number and <= 50
    if (!isNaN(numValue)) {
      setMaxInputValue(Math.min(50, numValue).toString())
    } else {
      setMaxInputValue(sanitizedValue)
    }
  }

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = parseInt(sanitizedValue)

    // Only update if it's a valid number and <= max
    if (!isNaN(numValue)) {
      setMinInputValue(Math.min(parseInt(maxInputValue) || 50, numValue).toString())
    } else {
      setMinInputValue(sanitizedValue)
    }
  }

  const handleSave = () => {
    const maxValue = parseInt(maxInputValue)
    const minValue = parseInt(minInputValue)

    if (!isNaN(maxValue)) {
      const newMaxValue = Math.min(50, Math.max(minValue, maxValue))
      updateLoopMaxIterations(loopId, newMaxValue)
      // Sync input with store value
      setMaxInputValue(newMaxValue.toString())
    } else {
      // Reset to current store value if invalid
      setMaxInputValue(maxIterations.toString())
    }

    if (!isNaN(minValue)) {
      const newMinValue = Math.min(maxValue, Math.max(0, minValue))
      updateLoopMinIterations(loopId, newMinValue)
      // Sync input with store value
      setMinInputValue(newMinValue.toString())
    } else {
      // Reset to current store value if invalid
      setMinInputValue(minIterations.toString())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
      setOpen(false)
    }
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
          Iterations: {minIterations}-{maxIterations}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Min Iterations</div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={minInputValue}
              onChange={handleMinChange}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
            />
          </div>
          <div className="text-[10px] text-muted-foreground">
            Enter a number between 0 and {maxInputValue}
          </div>

          <div className="mt-3 text-xs font-medium text-muted-foreground">Max Iterations</div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={maxInputValue}
              onChange={handleMaxChange}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
            />
          </div>
          <div className="text-[10px] text-muted-foreground">
            Enter a number between {minInputValue || 1} and 50
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
