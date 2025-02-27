import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { NodeProps } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflow/store'

export function LoopInput({ id }: NodeProps) {
  // Extract the loop ID from the node ID
  const loopId = id.replace('loop-input-', '')

  // Get the max iterations from the store for this loop
  const maxIterations = useWorkflowStore((state) => state.loops[loopId]?.maxIterations ?? 5)
  const updateLoopMaxIterations = useWorkflowStore((state) => state.updateLoopMaxIterations)

  // Local state for input value
  const [inputValue, setInputValue] = useState(maxIterations.toString())
  const [open, setOpen] = useState(false)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = parseInt(sanitizedValue)

    // Only update if it's a valid number and <= 50
    if (!isNaN(numValue)) {
      setInputValue(Math.min(50, numValue).toString())
    } else {
      setInputValue(sanitizedValue)
    }
  }

  const handleSave = () => {
    const value = parseInt(inputValue)
    if (!isNaN(value)) {
      const newValue = Math.min(50, value)
      updateLoopMaxIterations(loopId, newValue)
      // Sync input with store value
      setInputValue(newValue.toString())
    } else {
      // Reset to current store value if invalid
      setInputValue(maxIterations.toString())
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
            'bg-background border-border text-foreground font-medium px-2 py-0.5 text-sm',
            'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
            'flex items-center gap-1'
          )}
        >
          Max Iterations: {maxIterations}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </Badge>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-3" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Max Iterations</div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={inputValue}
              onChange={handleChange}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="h-8 text-sm"
            />
          </div>
          <div className="text-[10px] text-muted-foreground">Enter a number between 1 and 50</div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
