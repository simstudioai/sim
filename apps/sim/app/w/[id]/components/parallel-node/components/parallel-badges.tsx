import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import Editor from 'react-simple-code-editor'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

interface ParallelNodeData {
  width?: number
  height?: number
  parentId?: string
  state?: string
  type?: string
  extent?: 'parent'
  parallelType?: 'count' | 'collection'
  count?: number
  collection?: string | any[] | Record<string, any>
  executionState?: {
    currentExecution: number
    isExecuting: boolean
    startTime: number | null
    endTime: number | null
  }
}

interface ParallelBadgesProps {
  nodeId: string
  data: ParallelNodeData
}

export function ParallelBadges({ nodeId, data }: ParallelBadgesProps) {
  // State
  const [parallelType, setParallelType] = useState<'count' | 'collection'>(
    data?.parallelType || 'collection'
  )
  const [iterations, setIterations] = useState(data?.count || 5)
  const [inputValue, setInputValue] = useState((data?.count || 5).toString())
  const [editorValue, setEditorValue] = useState('')
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const editorRef = useRef<HTMLDivElement>(null)

  // Get store methods
  const updateParallelCount = useWorkflowStore((state) => state.updateParallelCount)
  const updateParallelCollection = useWorkflowStore((state) => state.updateParallelCollection)

  // Update node data to include parallel type
  const updateNodeData = useCallback(
    (updates: Partial<ParallelNodeData>) => {
      useWorkflowStore.setState((state) => ({
        blocks: {
          ...state.blocks,
          [nodeId]: {
            ...state.blocks[nodeId],
            data: {
              ...state.blocks[nodeId].data,
              ...updates,
            },
          },
        },
      }))
    },
    [nodeId]
  )

  // Initialize state from data when it changes
  useEffect(() => {
    if (data?.parallelType && data.parallelType !== parallelType) {
      setParallelType(data.parallelType)
    }
    if (data?.count && data.count !== iterations) {
      setIterations(data.count)
      setInputValue(data.count.toString())
    }

    if (data?.collection) {
      if (typeof data.collection === 'string') {
        setEditorValue(data.collection)
      } else if (Array.isArray(data.collection) || typeof data.collection === 'object') {
        setEditorValue(JSON.stringify(data.collection))
      }
    }
  }, [data?.parallelType, data?.count, data?.collection, parallelType, iterations])

  // Handle parallel type change
  const handleParallelTypeChange = useCallback(
    (newType: 'count' | 'collection') => {
      setParallelType(newType)
      updateNodeData({ parallelType: newType })

      // Reset values based on type
      if (newType === 'count') {
        updateParallelCollection(nodeId, '')
        updateParallelCount(nodeId, iterations)
      } else {
        updateParallelCount(nodeId, 1)
        updateParallelCollection(nodeId, editorValue || '[]')
      }

      setTypePopoverOpen(false)
    },
    [nodeId, iterations, editorValue, updateNodeData, updateParallelCount, updateParallelCollection]
  )

  // Handle iterations input change
  const handleIterationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = Number.parseInt(sanitizedValue)

    if (!Number.isNaN(numValue)) {
      setInputValue(Math.min(20, numValue).toString())
    } else {
      setInputValue(sanitizedValue)
    }
  }, [])

  // Handle iterations save
  const handleIterationsSave = useCallback(() => {
    const value = Number.parseInt(inputValue)

    if (!Number.isNaN(value)) {
      const newValue = Math.min(20, Math.max(1, value))
      setIterations(newValue)
      updateParallelCount(nodeId, newValue)
      setInputValue(newValue.toString())
    } else {
      setInputValue(iterations.toString())
    }
    setConfigPopoverOpen(false)
  }, [inputValue, iterations, nodeId, updateParallelCount])

  // Handle editor change and check for tag trigger
  const handleEditorChange = useCallback(
    (value: string) => {
      setEditorValue(value)
      updateParallelCollection(nodeId, value)

      // Get the textarea element and cursor position
      const textarea = editorRef.current?.querySelector('textarea')
      if (textarea) {
        const position = textarea.selectionStart || 0
        setCursorPosition(position)

        // Check for tag trigger
        const tagTrigger = checkTagTrigger(value, position)
        setShowTags(tagTrigger.show)
      }
    },
    [nodeId, updateParallelCollection]
  )

  // Handle tag selection
  const handleTagSelect = useCallback(
    (newValue: string) => {
      setEditorValue(newValue)
      updateParallelCollection(nodeId, newValue)
      setShowTags(false)

      // Focus back on the editor after selection
      setTimeout(() => {
        const textarea = editorRef.current?.querySelector('textarea')
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [nodeId, updateParallelCollection]
  )

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowTags(false)
    }
  }, [])

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-between'>
      {/* Parallel Type Badge */}
      <Popover open={typePopoverOpen} onOpenChange={setTypePopoverOpen}>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
          >
            {parallelType === 'count' ? 'Parallel Count' : 'Parallel Each'}
            <ChevronDown className='h-3 w-3 text-muted-foreground' />
          </Badge>
        </PopoverTrigger>
        <PopoverContent className='w-48 p-3' align='center' onClick={(e) => e.stopPropagation()}>
          <div className='space-y-2'>
            <div className='font-medium text-muted-foreground text-xs'>Parallel Type</div>
            <div className='space-y-1'>
              <div
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                  parallelType === 'count' ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onClick={() => handleParallelTypeChange('count')}
              >
                <span className='text-sm'>Parallel Count</span>
              </div>
              <div
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                  parallelType === 'collection' ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onClick={() => handleParallelTypeChange('collection')}
              >
                <span className='text-sm'>Parallel Each</span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Iterations/Collection Badge */}
      <Popover open={configPopoverOpen} onOpenChange={setConfigPopoverOpen}>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
          >
            {parallelType === 'count' ? `Iterations: ${iterations}` : 'Items'}
            <ChevronDown className='h-3 w-3 text-muted-foreground' />
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          className={cn('p-3', parallelType !== 'count' ? 'w-72' : 'w-48')}
          align='center'
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          <div className='space-y-2'>
            <div className='font-medium text-muted-foreground text-xs'>
              {parallelType === 'count' ? 'Parallel Iterations' : 'Parallel Items'}
            </div>

            {parallelType === 'count' ? (
              // Number input for count-based parallel
              <div className='flex items-center gap-2'>
                <Input
                  type='text'
                  value={inputValue}
                  onChange={handleIterationsChange}
                  onBlur={handleIterationsSave}
                  onKeyDown={(e) => e.key === 'Enter' && handleIterationsSave()}
                  className='h-8 text-sm'
                  autoFocus
                />
              </div>
            ) : (
              // Code editor for collection-based parallel
              <div className='relative'>
                <div
                  ref={editorRef}
                  className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'
                >
                  {editorValue === '' && (
                    <div className='pointer-events-none absolute top-[8.5px] left-3 select-none text-muted-foreground/50'>
                      ['item1', 'item2', 'item3']
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
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShowTags(false)
                      }
                    }}
                  />

                  {/* Tag dropdown positioned inside the editor container */}
                  {showTags && (
                    <TagDropdown
                      visible={showTags}
                      onSelect={handleTagSelect}
                      blockId={nodeId}
                      activeSourceBlockId={nodeId}
                      inputValue={editorValue}
                      cursorPosition={cursorPosition}
                      onClose={() => setShowTags(false)}
                    />
                  )}
                </div>
                <div className='mt-2 text-[10px] text-muted-foreground'>
                  Array or object to use for parallel execution. Type "{'<'}" to reference other
                  blocks.
                </div>
              </div>
            )}

            {parallelType === 'count' && (
              <div className='text-[10px] text-muted-foreground'>
                Enter a number between 1 and 20
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
