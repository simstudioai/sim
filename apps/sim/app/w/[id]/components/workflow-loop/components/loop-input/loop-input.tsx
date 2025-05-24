import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

import Editor from 'react-simple-code-editor'
import type { NodeProps } from 'reactflow'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export function LoopInput({ id }: NodeProps) {
  // Extract the loop ID from the node ID
  const loopId = id.replace('loop-input-', '')

  // Get the loop data from the store
  const loop = useWorkflowStore((state) => state.loops[loopId])
  const iterations = loop?.iterations ?? 5
  const loopType = loop?.loopType || 'for'
  const updateLoopIterations = useWorkflowStore((state) => state.updateLoopIterations)
  const updateLoopForEachItems = useWorkflowStore((state) => state.updateLoopForEachItems)

  // Local state for input values
  const [inputValue, setInputValue] = useState(iterations.toString())
  const [editorValue, setEditorValue] = useState('')
  const [open, setOpen] = useState(false)
  const editorRef = useRef<HTMLDivElement | null>(null)

  // Initialize editor value from the store
  useEffect(() => {
    if (loopType === 'forEach' && loop?.forEachItems) {
      // Handle different types of forEachItems
      if (typeof loop.forEachItems === 'string') {
        // Preserve the string exactly as stored
        setEditorValue(loop.forEachItems)
      } else if (Array.isArray(loop.forEachItems) || typeof loop.forEachItems === 'object') {
        // For new objects/arrays from the store, use default formatting
        // This only happens for data loaded from DB that wasn't originally user-formatted
        setEditorValue(JSON.stringify(loop.forEachItems))
      }
    } else if (loopType === 'forEach') {
      setEditorValue('')
    }
  }, [loopType, loop?.forEachItems])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = Number.parseInt(sanitizedValue)

    // Only update if it's a valid number and <= 50
    if (!Number.isNaN(numValue)) {
      setInputValue(Math.min(50, numValue).toString())
    } else {
      setInputValue(sanitizedValue)
    }
  }

  const handleSave = () => {
    const value = Number.parseInt(inputValue)

    if (!Number.isNaN(value)) {
      const newValue = Math.min(50, Math.max(1, value))
      updateLoopIterations(loopId, newValue)
      // Sync input with store value
      setInputValue(newValue.toString())
    } else {
      // Reset to current store value if invalid
      setInputValue(iterations.toString())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
      setOpen(false)
    }
  }

  const handleEditorChange = (value: string) => {
    // Always set the editor value to exactly what the user typed
    setEditorValue(value)

    // Save the items to the store for forEach loops
    if (loopType === 'forEach') {
      // Pass the exact string to preserve formatting
      updateLoopForEachItems(loopId, value)
    }
  }

  // Determine label based on loop type
  const getLabel = () => {
    switch (loopType) {
      case 'for':
        return `Iterations: ${iterations}`
      case 'forEach':
        return 'Items'
      default:
        return `Iterations: ${iterations}`
    }
  }

  const getPlaceholder = () => {
    switch (loopType) {
      case 'forEach':
        return "['item1', 'item2', 'item3']"
      default:
        return ''
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Badge
          variant='outline'
          className={cn(
            'border-border bg-background py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm',
            'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
            'flex items-center gap-1'
          )}
        >
          {getLabel()}
          <ChevronDown className='h-3 w-3 text-muted-foreground' />
        </Badge>
      </PopoverTrigger>
      <PopoverContent
        className={cn('p-3', loopType !== 'for' ? 'w-72' : 'w-48')}
        align='start'
        onClick={(e) => e.stopPropagation()}
      >
        <div className='space-y-2'>
          <div className='flex items-center justify-between'>
            <div className='font-medium text-muted-foreground text-xs'>
              {loopType === 'for' ? 'Loop Iterations' : 'Collection Items'}
            </div>
          </div>

          {loopType === 'for' ? (
            // Number input for 'for' loops
            <div className='flex items-center gap-2'>
              <Input
                type='text'
                value={inputValue}
                onChange={handleChange}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className='h-8 text-sm'
              />
            </div>
          ) : (
            // Code editor for 'forEach' loops
            <div
              className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'
              ref={editorRef}
            >
              {editorValue === '' && (
                <div className='pointer-events-none absolute top-[8.5px] left-3 select-none text-muted-foreground/50'>
                  {getPlaceholder()}
                </div>
              )}
              <Editor
                value={editorValue}
                onValueChange={handleEditorChange}
                highlight={(code) => highlight(code, languages.javascript, 'javascript')}
                padding={0}
                style={{
                  fontFamily: 'monospace',
                  lineHeight: '21px',
                }}
                className='w-full focus:outline-none'
                textareaClassName='focus:outline-none focus:ring-0 bg-transparent resize-none w-full overflow-hidden whitespace-pre-wrap'
              />
            </div>
          )}

          <div className='text-[10px] text-muted-foreground'>
            {loopType === 'for'
              ? 'Enter a number between 1 and 50'
              : 'Array or object to iterate over'}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
