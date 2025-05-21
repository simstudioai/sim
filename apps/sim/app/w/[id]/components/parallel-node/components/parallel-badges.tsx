import { useCallback, useEffect, useState, useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import Editor from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

interface ParallelNodeData {
  width?: number;
  height?: number;
  parentId?: string;
  state?: string;
  type?: string;
  extent?: 'parent';
  collection?: string | any[] | Record<string, any>;
  executionState?: {
    currentExecution: number;
    isExecuting: boolean;
    startTime: number | null;
    endTime: number | null;
  };
}

interface ParallelBadgesProps {
  nodeId: string
  data: ParallelNodeData
}

export function ParallelBadges({ nodeId, data }: ParallelBadgesProps) {
  // State
  const [editorValue, setEditorValue] = useState('')
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  // Use a ref to track if we've initialized the collection
  const initializedRef = useRef(false)

  // Get store methods
  const updateParallelCollection = useWorkflowStore(state => state.updateParallelCollection)

  // Initialize editor value from data when it changes
  useEffect(() => {
    if (data?.collection) {
      if (typeof data.collection === 'string') {
        setEditorValue(data.collection)
      } else if (Array.isArray(data.collection) || typeof data.collection === 'object') {
        setEditorValue(JSON.stringify(data.collection))
      }
      // Mark as initialized since we have data
      initializedRef.current = true
    } else if (!initializedRef.current) {
      // Only initialize if we haven't done so already
      const defaultValue = ''
      setEditorValue(defaultValue)
      // Initialize the collection in the store
      updateParallelCollection(nodeId, defaultValue)
      // Mark as initialized to prevent future calls
      initializedRef.current = true
    }
  }, [data?.collection, nodeId, updateParallelCollection])

  // Handle editor change
  const handleEditorChange = useCallback((value: string) => {
    setEditorValue(value)
    // Update the store using the dedicated function
    updateParallelCollection(nodeId, value)
  }, [nodeId, updateParallelCollection])

  return (
    <div className="absolute -top-9 left-0 right-0 flex justify-end z-10">
      {/* Items Configuration Badge */}
      <Popover open={configPopoverOpen} onOpenChange={setConfigPopoverOpen}>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant="outline"
            className={cn(
              'bg-background/80 backdrop-blur-sm border-border text-foreground font-medium pr-1.5 pl-2.5 py-0.5 text-sm',
              'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
              'flex items-center gap-1'
            )}
          >
            Items
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          className="p-3 w-72"
          align="center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Parallel Items
            </div>

            {/* Code editor for items */}
            <div className="relative min-h-[80px] rounded-md bg-background font-mono text-sm px-3 pt-2 pb-3 border border-input">
              {editorValue === '' && (
                <div className="absolute top-[8.5px] left-3 text-muted-foreground/50 pointer-events-none select-none">
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
                className="focus:outline-none w-full"
                textareaClassName="focus:outline-none focus:ring-0 bg-transparent resize-none w-full overflow-hidden whitespace-pre-wrap"
              />
            </div>

            <div className="text-[10px] text-muted-foreground">
              Array or object to use for parallel execution
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}