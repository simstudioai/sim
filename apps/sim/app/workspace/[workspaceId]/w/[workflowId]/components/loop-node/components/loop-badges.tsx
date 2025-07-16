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

interface LoopNodeData {
  width?: number
  height?: number
  parentId?: string
  state?: string
  type?: string
  extent?: 'parent'
  loopType?: 'for' | 'forEach'
  count?: number
  collection?: string | any[] | Record<string, any>
  isPreview?: boolean
  executionState?: {
    currentIteration: number
    isExecuting: boolean
    startTime: number | null
    endTime: number | null
  }
}

interface LoopBadgesProps {
  nodeId: string
  data: LoopNodeData
}

export function LoopBadges({ nodeId, data }: LoopBadgesProps) {
  // Check if this is preview mode
  const isPreview = data?.isPreview || false

  // Get loop configuration from the workflow store (single source of truth)
  const { loops } = useWorkflowStore()
  const loopConfig = loops[nodeId]

  // Use loop config as primary source, fallback to data for backward compatibility
  const configIterations = loopConfig?.iterations ?? data?.count ?? 5
  const configLoopType = loopConfig?.loopType ?? data?.loopType ?? 'for'
  const configCollection = loopConfig?.forEachItems ?? data?.collection ?? ''

  // Derive values directly from props - no useState needed for synchronized data
  const loopType = configLoopType
  const iterations = configIterations
  const collectionString =
    typeof configCollection === 'string' ? configCollection : JSON.stringify(configCollection) || ''

  // Use actual values directly for display, temporary state only for active editing
  const [tempInputValue, setTempInputValue] = useState<string | null>(null)
  const inputValue = tempInputValue ?? iterations.toString()
  const editorValue = collectionString
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Get collaborative functions
  const {
    collaborativeUpdateLoopType,
    collaborativeUpdateLoopCount,
    collaborativeUpdateLoopCollection,
  } = useCollaborativeWorkflow()

  // Handle loop type change
  const handleLoopTypeChange = useCallback(
    (newType: 'for' | 'forEach') => {
      if (isPreview) return // Don't allow changes in preview mode

      // Update the collaborative state - this will cause the component to re-render with new derived values
      collaborativeUpdateLoopType(nodeId, newType)
      setTypePopoverOpen(false)
    },
    [nodeId, collaborativeUpdateLoopType, isPreview]
  )

  // Handle iterations input change
  const handleIterationsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isPreview) return // Don't allow changes in preview mode

      const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
      const numValue = Number.parseInt(sanitizedValue)

      if (!Number.isNaN(numValue)) {
        setTempInputValue(Math.min(100, numValue).toString())
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
      const newValue = Math.min(100, Math.max(1, value))
      // Update the collaborative state - this will cause iterations to be derived from props
      collaborativeUpdateLoopCount(nodeId, newValue)
    }
    // Clear temporary input state to show the actual value
    setTempInputValue(null)
    setConfigPopoverOpen(false)
  }, [inputValue, nodeId, collaborativeUpdateLoopCount, isPreview])

  // Handle editor change with tag dropdown support
  const handleEditorChange = useCallback(
    (value: string) => {
      if (isPreview) return // Don't allow changes in preview mode

      // Update collaborative state directly - no local state needed
      collaborativeUpdateLoopCollection(nodeId, value)

      // Get the textarea element from the editor
      const textarea = editorContainerRef.current?.querySelector('textarea')
      if (textarea) {
        textareaRef.current = textarea
        const cursorPos = textarea.selectionStart || 0
        setCursorPosition(cursorPos)

        // Check for tag trigger
        const triggerCheck = checkTagTrigger(value, cursorPos)
        setShowTagDropdown(triggerCheck.show)
      }
    },
    [nodeId, collaborativeUpdateLoopCollection, isPreview]
  )

  // Handle tag selection
  const handleTagSelect = useCallback(
    (newValue: string) => {
      if (isPreview) return // Don't allow changes in preview mode

      // Update collaborative state directly - no local state needed
      collaborativeUpdateLoopCollection(nodeId, newValue)
      setShowTagDropdown(false)

      // Focus back on the editor after a short delay
      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [nodeId, collaborativeUpdateLoopCollection, isPreview]
  )

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-between'>
      {/* Loop Type Badge */}
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
            {loopType === 'for' ? 'For Loop' : 'For Each'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent className='w-48 p-3' align='center' onClick={(e) => e.stopPropagation()}>
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>Loop Type</div>
              <div className='space-y-1'>
                <div
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                    loopType === 'for' ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                  onClick={() => handleLoopTypeChange('for')}
                >
                  <span className='text-sm'>For Loop</span>
                </div>
                <div
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                    loopType === 'forEach' ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                  onClick={() => handleLoopTypeChange('forEach')}
                >
                  <span className='text-sm'>For Each</span>
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
            {loopType === 'for' ? `Iterations: ${iterations}` : 'Items'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent
            className={cn('p-3', loopType !== 'for' ? 'w-72' : 'w-48')}
            align='center'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>
                {loopType === 'for' ? 'Loop Iterations' : 'Collection Items'}
              </div>

              {loopType === 'for' ? (
                // Number input for 'for' loops
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
                // Code editor for 'forEach' loops
                <div ref={editorContainerRef} className='relative'>
                  <div className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'>
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
                    />
                  </div>
                  <div className='mt-2 text-[10px] text-muted-foreground'>
                    Array or object to iterate over. Type "{'<'}" to reference other blocks.
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

              {loopType === 'for' && (
                <div className='text-[10px] text-muted-foreground'>
                  Enter a number between 1 and 100
                </div>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
