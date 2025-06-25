import { useCallback, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import Editor from 'react-simple-code-editor'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { cn } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
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
  isPreview?: boolean
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
  // Check if this is preview mode
  const isPreview = data?.isPreview || false

  // Get parallel configuration from the workflow store (single source of truth)
  const { parallels } = useWorkflowStore()
  const parallelConfig = parallels[nodeId]

  // Use parallel config as primary source, fallback to data for backward compatibility
  const configCount = parallelConfig?.count ?? data?.count ?? 5
  const configDistribution = parallelConfig?.distribution ?? data?.collection ?? ''
  // For parallel type, use the block's parallelType data property as the source of truth
  // Don't infer it from whether distribution exists, as that causes unwanted switching
  const configParallelType = data?.parallelType || 'collection'

  // Derive values directly from props - no useState needed for synchronized data
  const parallelType = configParallelType
  const iterations = configCount
  const distributionString =
    typeof configDistribution === 'string'
      ? configDistribution
      : JSON.stringify(configDistribution) || ''

  // Use actual values directly for display, temporary state only for active editing
  const [tempInputValue, setTempInputValue] = useState<string | null>(null)
  const inputValue = tempInputValue ?? iterations.toString()
  const editorValue = distributionString
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Get collaborative functions
  const {
    collaborativeUpdateParallelCount,
    collaborativeUpdateParallelCollection,
    collaborativeUpdateParallelType,
  } = useCollaborativeWorkflow()

  // Handle parallel type change
  const handleParallelTypeChange = useCallback(
    (newType: 'count' | 'collection') => {
      if (isPreview) return // Don't allow changes in preview mode

      // Use single collaborative function that handles all the state changes atomically
      collaborativeUpdateParallelType(nodeId, newType)

      setTypePopoverOpen(false)
    },
    [nodeId, collaborativeUpdateParallelType, isPreview]
  )

  // Handle iterations input change
  const handleIterationsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isPreview) return // Don't allow changes in preview mode

      const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
      const numValue = Number.parseInt(sanitizedValue)

      if (!Number.isNaN(numValue)) {
        setTempInputValue(Math.min(20, numValue).toString())
      } else {
        setTempInputValue(sanitizedValue)
      }
    },
    [isPreview]
  )

  // Handle iterations save
  const handleIterationsSave = useCallback(() => {
    if (isPreview) return // Don't allow changes in preview mode

    const value = Number.parseInt(inputValue)

    if (!Number.isNaN(value)) {
      const newValue = Math.min(20, Math.max(1, value))
      // Update the collaborative state - this will cause iterations to be derived from props
      collaborativeUpdateParallelCount(nodeId, newValue)
    }
    // Clear temporary input state to show the actual value
    setTempInputValue(null)
    setConfigPopoverOpen(false)
  }, [inputValue, nodeId, collaborativeUpdateParallelCount, isPreview])

  // Handle editor change and check for tag trigger
  const handleEditorChange = useCallback(
    (value: string) => {
      if (isPreview) return // Don't allow changes in preview mode

      // Update collaborative state directly - no local state needed
      collaborativeUpdateParallelCollection(nodeId, value)

      // Get the textarea element and cursor position
      const textarea = editorContainerRef.current?.querySelector('textarea')
      if (textarea) {
        textareaRef.current = textarea
        const position = textarea.selectionStart || 0
        setCursorPosition(position)

        // Check for tag trigger
        const tagTrigger = checkTagTrigger(value, position)
        setShowTagDropdown(tagTrigger.show)
      }
    },
    [nodeId, collaborativeUpdateParallelCollection, isPreview]
  )

  // Handle tag selection
  const handleTagSelect = useCallback(
    (newValue: string) => {
      if (isPreview) return // Don't allow changes in preview mode

      // Update collaborative state directly - no local state needed
      collaborativeUpdateParallelCollection(nodeId, newValue)
      setShowTagDropdown(false)

      // Focus back on the editor after selection
      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [nodeId, collaborativeUpdateParallelCollection, isPreview]
  )

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowTagDropdown(false)
    }
  }, [])

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-between'>
      {/* Parallel Type Badge */}
      <Popover
        open={!isPreview && typePopoverOpen}
        onOpenChange={isPreview ? undefined : setTypePopoverOpen}
      >
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              !isPreview && 'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          >
            {parallelType === 'count' ? 'Parallel Count' : 'Parallel Each'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
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
        )}
      </Popover>

      {/* Iterations/Collection Badge */}
      <Popover
        open={!isPreview && configPopoverOpen}
        onOpenChange={isPreview ? undefined : setConfigPopoverOpen}
      >
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant='outline'
            className={cn(
              'border-border bg-background/80 py-0.5 pr-1.5 pl-2.5 font-medium text-foreground text-sm backdrop-blur-sm',
              !isPreview && 'cursor-pointer transition-colors duration-150 hover:bg-accent/50',
              'flex items-center gap-1'
            )}
            style={{ pointerEvents: isPreview ? 'none' : 'auto' }}
          >
            {parallelType === 'count' ? `Iterations: ${iterations}` : 'Items'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
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
                    ref={editorContainerRef}
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
                          setShowTagDropdown(false)
                        }
                      }}
                    />
                  </div>
                  <div className='mt-2 text-[10px] text-muted-foreground'>
                    Array or object to use for parallel execution. Type "{'<'}" to reference other
                    blocks.
                  </div>
                  {showTagDropdown && (
                    <TagDropdown
                      visible={showTagDropdown}
                      onSelect={handleTagSelect}
                      blockId={nodeId}
                      activeSourceBlockId={null}
                      inputValue={editorValue}
                      cursorPosition={cursorPosition}
                      onClose={() => setShowTagDropdown(false)}
                    />
                  )}
                </div>
              )}

              {parallelType === 'count' && (
                <div className='text-[10px] text-muted-foreground'>
                  Enter a number between 1 and 20
                </div>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
