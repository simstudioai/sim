import { useCallback, useEffect, useState } from 'react'
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


interface LoopNodeData {
  width?: number;
  height?: number;
  parentId?: string;
  state?: string;
  type?: string;
  extent?: 'parent';
  loopType?: 'for' | 'forEach';
  count?: number;
  collection?: string | any[] | Record<string, any>;
  executionState?: {
    currentIteration: number;
    isExecuting: boolean;
    startTime: number | null;
    endTime: number | null;
  };
}

interface LoopBadgesProps {
  nodeId: string
  data: LoopNodeData
}

export function LoopBadges({ nodeId, data }: LoopBadgesProps) {
  // State
  const [loopType, setLoopType] = useState(data?.loopType || 'for')
  const [iterations, setIterations] = useState(data?.count || 5)
  const [inputValue, setInputValue] = useState((data?.count || 5).toString())
  const [editorValue, setEditorValue] = useState('')
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)

  // Get store methods
  const updateLoopType = useWorkflowStore(state => state.updateLoopType)
  const updateLoopCount = useWorkflowStore(state => state.updateLoopCount)
  const updateLoopCollection = useWorkflowStore(state => state.updateLoopCollection)

  // Initialize editor value from data when it changes
  useEffect(() => {
    if (data?.loopType && data.loopType !== loopType) {
      setLoopType(data.loopType)
    }
    if (data?.count && data.count !== iterations) {
      setIterations(data.count)
      setInputValue(data.count.toString())
    }

    if (loopType === 'forEach' && data?.collection) {
      if (typeof data.collection === 'string') {
        setEditorValue(data.collection)
      } else if (Array.isArray(data.collection) || typeof data.collection === 'object') {
        setEditorValue(JSON.stringify(data.collection))
      }
    } else if (loopType === 'forEach' && !data?.collection) {
      // Initialize with empty string if collection doesn't exist
      const defaultValue = ''
      setEditorValue(defaultValue)
      updateLoopCollection(nodeId, defaultValue)
    }
  }, [data?.loopType, data?.count, data?.collection, loopType, iterations, nodeId, updateLoopCollection])

  // Handle loop type change
  const handleLoopTypeChange = useCallback((newType: 'for' | 'forEach') => {
    setLoopType(newType)
    updateLoopType(nodeId, newType)
    setTypePopoverOpen(false)
  }, [nodeId, updateLoopType])

  // Handle iterations input change
  const handleIterationsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
    const numValue = parseInt(sanitizedValue)

    if (!isNaN(numValue)) {
      setInputValue(Math.min(100, numValue).toString())
    } else {
      setInputValue(sanitizedValue)
    }
  }, [])

  // Handle iterations save
  const handleIterationsSave = useCallback(() => {
    const value = parseInt(inputValue)

    if (!isNaN(value)) {
      const newValue = Math.min(100, Math.max(1, value))
      setIterations(newValue)
      updateLoopCount(nodeId, newValue)
      setInputValue(newValue.toString())
    } else {
      setInputValue(iterations.toString())
    }
    setConfigPopoverOpen(false)
  }, [inputValue, iterations, nodeId, updateLoopCount])

  // Handle editor change
  const handleEditorChange = useCallback((value: string) => {
    setEditorValue(value)
    updateLoopCollection(nodeId, value)
  }, [nodeId, updateLoopCollection])

  return (
    <div className="absolute -top-9 left-0 right-0 flex justify-between z-10">
      {/* Loop Type Badge */}
      <Popover open={typePopoverOpen} onOpenChange={setTypePopoverOpen}>
        <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Badge
            variant="outline"
            className={cn(
              'bg-background/80 backdrop-blur-sm border-border text-foreground font-medium pr-1.5 pl-2.5 py-0.5 text-sm',
              'hover:bg-accent/50 transition-colors duration-150 cursor-pointer',
              'flex items-center gap-1'
            )}
          >
            {loopType === 'for' ? 'For Loop' : 'For Each'}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="p-3 w-48" align="center" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Loop Type</div>
            <div className="space-y-1">
              <div
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer',
                  loopType === 'for' ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onClick={() => handleLoopTypeChange('for')}
              >
                <span className="text-sm">For Loop</span>
              </div>
              <div
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer',
                  loopType === 'forEach' ? 'bg-accent' : 'hover:bg-accent/50'
                )}
                onClick={() => handleLoopTypeChange('forEach')}
              >
                <span className="text-sm">For Each</span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Iterations/Collection Badge */}
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
            {loopType === 'for' ? `Iterations: ${iterations}` : 'Items'}
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </Badge>
        </PopoverTrigger>
        <PopoverContent
          className={cn('p-3', loopType !== 'for' ? 'w-72' : 'w-48')}
          align="center"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              {loopType === 'for' ? 'Loop Iterations' : 'Collection Items'}
            </div>

            {loopType === 'for' ? (
              // Number input for 'for' loops
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={inputValue}
                  onChange={handleIterationsChange}
                  onBlur={handleIterationsSave}
                  onKeyDown={(e) => e.key === 'Enter' && handleIterationsSave()}
                  className="h-8 text-sm"
                  autoFocus
                />
              </div>
            ) : (
              // Code editor for 'forEach' loops
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
            )}

            <div className="text-[10px] text-muted-foreground">
              {loopType === 'for'
                ? 'Enter a number between 1 and 100'
                : 'Array or object to iterate over'}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}