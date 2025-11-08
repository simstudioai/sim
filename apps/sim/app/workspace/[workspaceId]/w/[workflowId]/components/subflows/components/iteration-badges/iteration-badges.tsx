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

import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/references'
import type { LoopType, ParallelType } from '@/lib/workflows/types'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { normalizeBlockName } from '@/stores/workflows/utils'

type IterationType = 'loop' | 'parallel'

interface IterationNodeData {
  width?: number
  height?: number
  parentId?: string
  state?: string
  type?: string
  extent?: 'parent'
  loopType?: LoopType
  parallelType?: ParallelType
  // Common
  count?: number
  collection?: string | any[] | Record<string, any>
  isPreview?: boolean
  executionState?: {
    currentIteration?: number
    currentExecution?: number
    isExecuting: boolean
    startTime: number | null
    endTime: number | null
  }
}

interface IterationBadgesProps {
  nodeId: string
  data: IterationNodeData
  iterationType: IterationType
}

const CONFIG = {
  loop: {
    typeLabels: {
      for: 'For Loop',
      forEach: 'For Each',
      while: 'While Loop',
      doWhile: 'Do While Loop',
    },
    typeKey: 'loopType' as const,
    storeKey: 'loops' as const,
    maxIterations: 100,
    configKeys: {
      iterations: 'iterations' as const,
      items: 'forEachItems' as const,
      condition: 'whileCondition' as const,
    } as any,
  },
  parallel: {
    typeLabels: { count: 'Parallel Count', collection: 'Parallel Each' },
    typeKey: 'parallelType' as const,
    storeKey: 'parallels' as const,
    maxIterations: 20,
    configKeys: {
      iterations: 'count' as const,
      items: 'distribution' as const,
    },
  },
} as const

export function IterationBadges({ nodeId, data, iterationType }: IterationBadgesProps) {
  const config = CONFIG[iterationType]
  const isPreview = data?.isPreview || false

  // Get configuration from the workflow store
  const store = useWorkflowStore()
  const nodeConfig = store[config.storeKey][nodeId]

  // Determine current type and values
  const currentType = (data?.[config.typeKey] ||
    (iterationType === 'loop' ? 'for' : 'count')) as any

  // Determine if we're in count mode, collection mode, or condition mode
  const isCountMode =
    (iterationType === 'loop' && currentType === 'for') ||
    (iterationType === 'parallel' && currentType === 'count')
  const isConditionMode =
    iterationType === 'loop' && (currentType === 'while' || currentType === 'doWhile')

  const configIterations = (nodeConfig as any)?.[config.configKeys.iterations] ?? data?.count ?? 5
  const configCollection = (nodeConfig as any)?.[config.configKeys.items] ?? data?.collection ?? ''

  // Get condition based on loop type - same pattern as forEachItems
  const conditionKey =
    currentType === 'while'
      ? 'whileCondition'
      : currentType === 'doWhile'
        ? 'doWhileCondition'
        : null
  const configCondition =
    iterationType === 'loop' && conditionKey
      ? ((nodeConfig as any)?.[conditionKey] ?? (data as any)?.[conditionKey] ?? '')
      : ''

  const iterations = configIterations
  const collectionString =
    typeof configCollection === 'string' ? configCollection : JSON.stringify(configCollection) || ''
  const conditionString = typeof configCondition === 'string' ? configCondition : ''

  // State management
  const [tempInputValue, setTempInputValue] = useState<string | null>(null)
  const inputValue = tempInputValue ?? iterations.toString()
  const editorValue = isConditionMode ? conditionString : collectionString
  const [typePopoverOpen, setTypePopoverOpen] = useState(false)
  const [configPopoverOpen, setConfigPopoverOpen] = useState(false)
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Get collaborative functions
  const {
    collaborativeUpdateLoopType,
    collaborativeUpdateParallelType,
    collaborativeUpdateIterationCount,
    collaborativeUpdateIterationCollection,
  } = useCollaborativeWorkflow()
  const accessiblePrefixes = useAccessibleReferencePrefixes(nodeId)

  const shouldHighlightReference = useCallback(
    (part: string): boolean => {
      if (!part.startsWith('<') || !part.endsWith('>')) {
        return false
      }

      if (!isLikelyReferenceSegment(part)) {
        return false
      }

      const split = splitReferenceSegment(part)
      if (!split) {
        return false
      }

      const reference = split.reference

      if (!accessiblePrefixes) {
        return true
      }

      const inner = reference.slice(1, -1)
      const [prefix] = inner.split('.')
      const normalizedPrefix = normalizeBlockName(prefix)

      if (SYSTEM_REFERENCE_PREFIXES.has(normalizedPrefix)) {
        return true
      }

      return accessiblePrefixes.has(normalizedPrefix)
    },
    [accessiblePrefixes]
  )

  const highlightWithReferences = useCallback(
    (code: string): string => {
      const placeholders: Array<{
        placeholder: string
        original: string
        type: 'var' | 'env'
      }> = []

      let processedCode = code

      processedCode = processedCode.replace(/\{\{([^}]+)\}\}/g, (match) => {
        const placeholder = `__ENV_VAR_${placeholders.length}__`
        placeholders.push({ placeholder, original: match, type: 'env' })
        return placeholder
      })

      processedCode = processedCode.replace(/<[^>]+>/g, (match) => {
        if (shouldHighlightReference(match)) {
          const placeholder = `__VAR_REF_${placeholders.length}__`
          placeholders.push({ placeholder, original: match, type: 'var' })
          return placeholder
        }
        return match
      })

      let highlightedCode = highlight(processedCode, languages.javascript, 'javascript')

      placeholders.forEach(({ placeholder, original, type }) => {
        if (type === 'env') {
          highlightedCode = highlightedCode.replace(
            placeholder,
            `<span class="text-blue-500">${original}</span>`
          )
        } else {
          const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
          highlightedCode = highlightedCode.replace(
            placeholder,
            `<span class="text-blue-500">${escaped}</span>`
          )
        }
      })

      return highlightedCode
    },
    [shouldHighlightReference]
  )

  // Handle type change
  const handleTypeChange = useCallback(
    (newType: any) => {
      if (isPreview) return
      if (iterationType === 'loop') {
        collaborativeUpdateLoopType(nodeId, newType)
      } else {
        collaborativeUpdateParallelType(nodeId, newType)
      }
      setTypePopoverOpen(false)
    },
    [nodeId, iterationType, collaborativeUpdateLoopType, collaborativeUpdateParallelType, isPreview]
  )

  // Handle iterations input change
  const handleIterationsChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isPreview) return
      const sanitizedValue = e.target.value.replace(/[^0-9]/g, '')
      const numValue = Number.parseInt(sanitizedValue)

      if (!Number.isNaN(numValue)) {
        setTempInputValue(Math.min(config.maxIterations, numValue).toString())
      } else {
        setTempInputValue(sanitizedValue)
      }
    },
    [isPreview, config.maxIterations]
  )

  // Handle iterations save
  const handleIterationsSave = useCallback(() => {
    if (isPreview) return
    const value = Number.parseInt(inputValue)

    if (!Number.isNaN(value)) {
      const newValue = Math.min(config.maxIterations, Math.max(1, value))
      collaborativeUpdateIterationCount(nodeId, iterationType, newValue)
    }
    setTempInputValue(null)
    setConfigPopoverOpen(false)
  }, [
    inputValue,
    nodeId,
    iterationType,
    collaborativeUpdateIterationCount,
    isPreview,
    config.maxIterations,
  ])

  // Handle editor change
  const handleEditorChange = useCallback(
    (value: string) => {
      if (isPreview) return
      collaborativeUpdateIterationCollection(nodeId, iterationType, value)

      const textarea = editorContainerRef.current?.querySelector('textarea')
      if (textarea) {
        textareaRef.current = textarea
        const cursorPos = textarea.selectionStart || 0
        setCursorPosition(cursorPos)

        const triggerCheck = checkTagTrigger(value, cursorPos)
        setShowTagDropdown(triggerCheck.show)
      }
    },
    [nodeId, iterationType, collaborativeUpdateIterationCollection, isPreview]
  )

  // Handle tag selection
  const handleTagSelect = useCallback(
    (newValue: string) => {
      if (isPreview) return
      collaborativeUpdateIterationCollection(nodeId, iterationType, newValue)
      setShowTagDropdown(false)

      setTimeout(() => {
        const textarea = textareaRef.current
        if (textarea) {
          textarea.focus()
        }
      }, 0)
    },
    [nodeId, iterationType, collaborativeUpdateIterationCollection, isPreview]
  )

  // Get type options
  const typeOptions = Object.entries(config.typeLabels)

  return (
    <div className='-top-9 absolute right-0 left-0 z-10 flex justify-between'>
      {/* Type Badge */}
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
            {config.typeLabels[currentType as keyof typeof config.typeLabels]}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent className='w-48 p-3' align='center' onClick={(e) => e.stopPropagation()}>
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>
                {iterationType === 'loop' ? 'Loop Type' : 'Parallel Type'}
              </div>
              <div className='space-y-1'>
                {typeOptions.map(([typeValue, typeLabel]) => (
                  <div
                    key={typeValue}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
                      currentType === typeValue ? 'bg-accent' : 'hover:bg-accent/50'
                    )}
                    onClick={() => handleTypeChange(typeValue)}
                  >
                    <span className='text-sm'>{typeLabel}</span>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        )}
      </Popover>

      {/* Configuration Badge */}
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
            {isCountMode ? `Iterations: ${iterations}` : isConditionMode ? 'Condition' : 'Items'}
            {!isPreview && <ChevronDown className='h-3 w-3 text-muted-foreground' />}
          </Badge>
        </PopoverTrigger>
        {!isPreview && (
          <PopoverContent
            className={cn('p-3', !isCountMode ? 'w-72' : 'w-48')}
            align='center'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='space-y-2'>
              <div className='font-medium text-muted-foreground text-xs'>
                {isCountMode
                  ? `${iterationType === 'loop' ? 'Loop' : 'Parallel'} Iterations`
                  : isConditionMode
                    ? 'While Condition'
                    : `${iterationType === 'loop' ? 'Collection' : 'Parallel'} Items`}
              </div>

              {isCountMode ? (
                // Number input for count-based mode
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
              ) : isConditionMode ? (
                // Code editor for while condition
                <div ref={editorContainerRef} className='relative'>
                  <div className='relative min-h-[80px] rounded-md border border-input bg-background px-3 pt-2 pb-3 font-mono text-sm'>
                    {conditionString === '' && (
                      <div className='pointer-events-none absolute top-[8.5px] left-3 select-none text-muted-foreground/50'>
                        {'<counter.value> < 10'}
                      </div>
                    )}
                    <Editor
                      value={conditionString}
                      onValueChange={handleEditorChange}
                      highlight={highlightWithReferences}
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
                    JavaScript expression that evaluates to true/false. Type "{'<'}" to reference
                    blocks.
                  </div>
                  {showTagDropdown && (
                    <TagDropdown
                      visible={showTagDropdown}
                      onSelect={handleTagSelect}
                      blockId={nodeId}
                      activeSourceBlockId={null}
                      inputValue={conditionString}
                      cursorPosition={cursorPosition}
                      onClose={() => setShowTagDropdown(false)}
                    />
                  )}
                </div>
              ) : (
                // Code editor for collection-based mode
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
                      highlight={highlightWithReferences}
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

              {isCountMode && (
                <div className='text-[10px] text-muted-foreground'>
                  Enter a number between 1 and {config.maxIterations}
                </div>
              )}
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  )
}
