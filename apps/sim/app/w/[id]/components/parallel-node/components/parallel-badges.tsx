import { useCallback, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import Editor from 'react-simple-code-editor'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
  const [editorValue, setEditorValue] = useState('')
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)

  // Get store methods
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

  // Initialize editor value from data when it changes
  useEffect(() => {
    if (data?.collection) {
      if (typeof data.collection === 'string') {
        setEditorValue(data.collection)
      } else if (Array.isArray(data.collection) || typeof data.collection === 'object') {
        setEditorValue(JSON.stringify(data.collection))
      }
    }
  }, [data?.collection])

  // Handle editor change
  const handleEditorChange = useCallback(
    (value: string) => {
      setEditorValue(value)
      updateNodeData({ collection: value })
    },
    [updateNodeData]
  )

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-end'>
      {/* Items Configuration Badge */}
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
            Items
            <ChevronDown className='h-3 w-3 text-muted-foreground' />
          </Badge>
        </PopoverTrigger>
        <PopoverContent className='w-72 p-3' align='center' onClick={(e) => e.stopPropagation()}>
          <div className='space-y-2'>
            <div className='font-medium text-muted-foreground text-xs'>Parallel Items</div>

            {/* Code editor for items */}
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

            <div className='text-[10px] text-muted-foreground'>
              Array or object to use for parallel execution
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
