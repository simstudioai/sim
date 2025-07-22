import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-javascript'
import 'prismjs/themes/prism.css'

import Editor from 'react-simple-code-editor'
import { Handle, Position, useUpdateNodeInternals } from 'reactflow'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('ConditionInput')

interface ConditionalBlock {
  id: string
  title: string
  value: string
  showTags: boolean
  showEnvVars: boolean
  searchTerm: string
  cursorPosition: number
  activeSourceBlockId: string | null
}

interface ConditionInputProps {
  blockId: string
  subBlockId: string
  isConnecting: boolean
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
}

// Generate a stable ID based on the blockId and a suffix
const generateStableId = (blockId: string, suffix: string): string => {
  return `${blockId}-${suffix}`
}

export function ConditionInput({
  blockId,
  subBlockId,
  isConnecting,
  isPreview = false,
  previewValue,
  disabled = false,
}: ConditionInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const editorRef = useRef<HTMLDivElement>(null)
  const [visualLineHeights, setVisualLineHeights] = useState<{
    [key: string]: number[]
  }>({})
  const updateNodeInternals = useUpdateNodeInternals()
  const removeEdge = useWorkflowStore((state) => state.removeEdge)
  const edges = useWorkflowStore((state) => state.edges)

  // Use a ref to track the previous store value for comparison
  const prevStoreValueRef = useRef<string | null>(null)
  // Use a ref to track if we're currently syncing from store to prevent loops
  const isSyncingFromStoreRef = useRef(false)
  // Use a ref to track if we've already initialized from store
  const hasInitializedRef = useRef(false)
  // Track previous blockId to detect workflow changes
  const previousBlockIdRef = useRef<string>(blockId)

  // Create default blocks with stable IDs
  const createDefaultBlocks = (): ConditionalBlock[] => [
    {
      id: generateStableId(blockId, 'if'),
      title: 'if',
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    },
    {
      id: generateStableId(blockId, 'else'),
      title: 'else',
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    },
  ]

  // Initialize with a loading state instead of default blocks
  const [conditionalBlocks, setConditionalBlocks] = useState<ConditionalBlock[]>([])
  const [isReady, setIsReady] = useState(false)

  // Reset initialization state when blockId changes (workflow navigation)
  useEffect(() => {
    if (blockId !== previousBlockIdRef.current) {
      // Reset refs and state for new workflow/block
      hasInitializedRef.current = false
      isSyncingFromStoreRef.current = false
      prevStoreValueRef.current = null
      previousBlockIdRef.current = blockId
      setIsReady(false)
      setConditionalBlocks([])
    }
  }, [blockId])

  // Safely parse JSON with fallback
  const safeParseJSON = (jsonString: string | null): ConditionalBlock[] | null => {
    if (!jsonString) return null
    try {
      const parsed = JSON.parse(jsonString)
      if (!Array.isArray(parsed)) return null

      // Validate that the parsed data has the expected structure
      if (parsed.length === 0 || !('id' in parsed[0]) || !('title' in parsed[0])) {
        return null
      }

      return parsed
    } catch (error) {
      logger.error('Failed to parse JSON:', { error, jsonString })
      return null
    }
  }

  // Sync store value with conditional blocks when storeValue changes
  useEffect(() => {
    // Skip if syncing is already in progress
    if (isSyncingFromStoreRef.current) return

    // Use preview value when in preview mode, otherwise use store value
    const effectiveValue = isPreview ? previewValue : storeValue
    // Convert effectiveValue to string if it's not null
    const effectiveValueStr = effectiveValue !== null ? effectiveValue?.toString() : null

    // Set that we're syncing from store to prevent loops
    isSyncingFromStoreRef.current = true

    try {
      // If effective value is null, and we've already initialized, keep current state
      if (effectiveValueStr === null) {
        if (hasInitializedRef.current) {
          // We already have blocks, just mark as ready if not already
          if (!isReady) setIsReady(true)
          isSyncingFromStoreRef.current = false
          return
        }

        // If we haven't initialized yet, set default blocks
        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
        isSyncingFromStoreRef.current = false
        return
      }

      // Skip if the effective value hasn't changed and we're already initialized
      if (effectiveValueStr === prevStoreValueRef.current && hasInitializedRef.current) {
        if (!isReady) setIsReady(true)
        isSyncingFromStoreRef.current = false
        return
      }

      // Update the previous store value ref
      prevStoreValueRef.current = effectiveValueStr

      // Parse the effective value
      const parsedBlocks = safeParseJSON(effectiveValueStr)

      if (parsedBlocks) {
        // Use the parsed blocks, but ensure titles are correct based on position
        const blocksWithCorrectTitles = parsedBlocks.map((block, index) => ({
          ...block,
          title: index === 0 ? 'if' : index === parsedBlocks.length - 1 ? 'else' : 'else if',
        }))

        setConditionalBlocks(blocksWithCorrectTitles)
        hasInitializedRef.current = true
        if (!isReady) setIsReady(true)
      } else if (!hasInitializedRef.current) {
        // Only set default blocks if we haven't initialized yet
        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
      }
    } finally {
      // Reset the syncing flag after a short delay
      setTimeout(() => {
        isSyncingFromStoreRef.current = false
      }, 0)
    }
  }, [storeValue, previewValue, isPreview, blockId, isReady])

  // Update store whenever conditional blocks change
  useEffect(() => {
    // Skip if we're currently syncing from store to prevent loops
    // or if we're not ready yet (still initializing) or in preview mode
    if (isSyncingFromStoreRef.current || !isReady || conditionalBlocks.length === 0 || isPreview)
      return

    const newValue = JSON.stringify(conditionalBlocks)

    // Only update if the value has actually changed
    if (newValue !== prevStoreValueRef.current) {
      prevStoreValueRef.current = newValue
      setStoreValue(newValue)
      updateNodeInternals(`${blockId}-${subBlockId}`)
    }
  }, [
    conditionalBlocks,
    blockId,
    subBlockId,
    setStoreValue,
    updateNodeInternals,
    isReady,
    isPreview,
  ])

  // Cleanup when component unmounts
  useEffect(() => {
    return () => {
      hasInitializedRef.current = false
      prevStoreValueRef.current = null
      isSyncingFromStoreRef.current = false
    }
  }, [])

  // Update the line counting logic to be block-specific
  useEffect(() => {
    if (!editorRef.current || conditionalBlocks.length === 0) return

    const calculateVisualLines = () => {
      const preElement = editorRef.current?.querySelector('pre')
      if (!preElement) return

      const newVisualLineHeights: { [key: string]: number[] } = {}

      conditionalBlocks.forEach((block) => {
        const lines = block.value.split('\n')
        const blockVisualHeights: number[] = []

        // Create a hidden container with the same width as the editor
        const container = document.createElement('div')
        container.style.cssText = `
          position: absolute;
          visibility: hidden;
          width: ${preElement.clientWidth}px;
          font-family: ${window.getComputedStyle(preElement).fontFamily};
          font-size: ${window.getComputedStyle(preElement).fontSize};
          padding: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        `
        document.body.appendChild(container)

        // Process each line
        lines.forEach((line) => {
          const lineDiv = document.createElement('div')

          if (line.includes('<') && line.includes('>')) {
            const parts = line.split(/(<[^>]+>)/g)
            parts.forEach((part) => {
              const span = document.createElement('span')
              span.textContent = part
              if (part.startsWith('<') && part.endsWith('>')) {
                span.style.color = 'rgb(153, 0, 85)'
              }
              lineDiv.appendChild(span)
            })
          } else {
            lineDiv.textContent = line || ' '
          }

          container.appendChild(lineDiv)

          const actualHeight = lineDiv.getBoundingClientRect().height
          const lineUnits = Math.ceil(actualHeight / 21)
          blockVisualHeights.push(lineUnits)

          container.removeChild(lineDiv)
        })

        document.body.removeChild(container)
        newVisualLineHeights[block.id] = blockVisualHeights
      })

      setVisualLineHeights(newVisualLineHeights)
    }

    calculateVisualLines()

    const resizeObserver = new ResizeObserver(calculateVisualLines)
    resizeObserver.observe(editorRef.current)

    return () => resizeObserver.disconnect()
  }, [conditionalBlocks])

  // Modify the line numbers rendering to be block-specific
  const renderLineNumbers = (blockId: string) => {
    const numbers: ReactElement[] = []
    let lineNumber = 1
    const blockHeights = visualLineHeights[blockId] || []

    blockHeights.forEach((height) => {
      for (let i = 0; i < height; i++) {
        numbers.push(
          <div
            key={`${blockId}-${lineNumber}-${i}`}
            className={cn('text-muted-foreground text-xs leading-[21px]', i > 0 && 'invisible')}
          >
            {lineNumber}
          </div>
        )
      }
      lineNumber++
    })

    return numbers
  }

  // Handle drops from connection blocks - updated for individual blocks
  const handleDrop = (blockId: string, e: React.DragEvent) => {
    if (isPreview || disabled) return
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const textarea: any = editorRef.current?.querySelector(
        `[data-block-id="${blockId}"] textarea`
      )
      const dropPosition = textarea?.selectionStart ?? 0

      setConditionalBlocks((blocks) =>
        blocks.map((block) => {
          if (block.id === blockId) {
            const newValue = `${block.value.slice(0, dropPosition)}<${block.value.slice(dropPosition)}`
            return {
              ...block,
              value: newValue,
              showTags: true,
              cursorPosition: dropPosition + 1,
              activeSourceBlockId: data.connectionData?.sourceBlockId || null,
            }
          }
          return block
        })
      )

      // Set cursor position after state updates
      setTimeout(() => {
        if (textarea) {
          textarea.selectionStart = dropPosition + 1
          textarea.selectionEnd = dropPosition + 1
          textarea.focus()
        }
      }, 0)
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Handle tag selection - updated for individual blocks
  const handleTagSelect = (blockId: string, newValue: string) => {
    if (isPreview || disabled) return
    setConditionalBlocks((blocks) =>
      blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              value: newValue,
              showTags: false,
              activeSourceBlockId: null,
            }
          : block
      )
    )
  }

  // Handle environment variable selection - updated for individual blocks
  const handleEnvVarSelect = (blockId: string, newValue: string) => {
    if (isPreview || disabled) return
    setConditionalBlocks((blocks) =>
      blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              value: newValue,
              showEnvVars: false,
              searchTerm: '',
            }
          : block
      )
    )
  }

  // Update block titles based on position
  const updateBlockTitles = (blocks: ConditionalBlock[]): ConditionalBlock[] => {
    return blocks.map((block, index) => ({
      ...block,
      title: index === 0 ? 'if' : index === blocks.length - 1 ? 'else' : 'else if',
    }))
  }

  // Update these functions to use updateBlockTitles and stable IDs
  const addBlock = (afterId: string) => {
    if (isPreview || disabled) return

    const blockIndex = conditionalBlocks.findIndex((block) => block.id === afterId)

    // Generate a stable ID using the blockId and a timestamp
    const newBlockId = generateStableId(blockId, `else-if-${Date.now()}`)

    const newBlock: ConditionalBlock = {
      id: newBlockId,
      title: '', // Will be set by updateBlockTitles
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    }

    const newBlocks = [...conditionalBlocks]
    newBlocks.splice(blockIndex + 1, 0, newBlock)
    setConditionalBlocks(updateBlockTitles(newBlocks))

    // Focus the new block's editor after a short delay
    setTimeout(() => {
      const textarea: any = editorRef.current?.querySelector(
        `[data-block-id="${newBlock.id}"] textarea`
      )
      if (textarea) {
        textarea.focus()
      }
    }, 0)
  }

  const removeBlock = (id: string) => {
    if (isPreview || disabled || conditionalBlocks.length <= 2) return

    // Remove any associated edges before removing the block
    edges.forEach((edge) => {
      if (edge.sourceHandle?.startsWith(`condition-${id}`)) {
        removeEdge(edge.id)
      }
    })

    if (conditionalBlocks.length === 1) return
    setConditionalBlocks((blocks) => updateBlockTitles(blocks.filter((block) => block.id !== id)))
  }

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    if (isPreview || disabled) return

    const blockIndex = conditionalBlocks.findIndex((block) => block.id === id)
    if (
      (direction === 'up' && blockIndex === 0) ||
      (direction === 'down' && blockIndex === conditionalBlocks.length - 1)
    )
      return

    const newBlocks = [...conditionalBlocks]
    const targetIndex = direction === 'up' ? blockIndex - 1 : blockIndex + 1
    ;[newBlocks[blockIndex], newBlocks[targetIndex]] = [
      newBlocks[targetIndex],
      newBlocks[blockIndex],
    ]
    setConditionalBlocks(updateBlockTitles(newBlocks))
  }

  // Add useEffect to handle keyboard events for both dropdowns
  useEffect(() => {
    conditionalBlocks.forEach((block) => {
      const textarea = editorRef.current?.querySelector(`[data-block-id="${block.id}"] textarea`)
      if (textarea) {
        textarea.addEventListener('keydown', (e: Event) => {
          if ((e as KeyboardEvent).key === 'Escape') {
            setConditionalBlocks((blocks) =>
              blocks.map((b) =>
                b.id === block.id
                  ? {
                      ...b,
                      showTags: false,
                      showEnvVars: false,
                      searchTerm: '',
                    }
                  : b
              )
            )
          }
        })
      }
    })
  }, [conditionalBlocks.length])

  // Show loading or empty state if not ready or no blocks
  if (!isReady || conditionalBlocks.length === 0) {
    return (
      <div className='flex min-h-[150px] items-center justify-center text-muted-foreground'>
        Loading conditions...
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      {conditionalBlocks.map((block, index) => (
        <div
          key={block.id}
          className='group relative overflow-visible rounded-lg border bg-background'
        >
          <div
            className={cn(
              'flex h-10 items-center justify-between overflow-hidden bg-card px-3',
              block.title === 'else' ? 'rounded-lg border-0' : 'rounded-t-lg border-b'
            )}
          >
            <span className='font-medium text-sm'>{block.title}</span>
            <Handle
              type='source'
              position={Position.Right}
              id={`condition-${block.id}`}
              key={`${block.id}-${index}`}
              className={cn(
                '!w-[7px] !h-5',
                '!bg-slate-300 dark:!bg-slate-500 !rounded-[2px] !border-none',
                '!z-[30]',
                'group-hover:!shadow-[0_0_0_3px_rgba(156,163,175,0.15)]',
                'hover:!w-[10px] hover:!right-[-28px] hover:!rounded-r-full hover:!rounded-l-none',
                '!cursor-crosshair',
                'transition-all duration-150',
                '!right-[-25px]'
              )}
              data-nodeid={`${blockId}-${subBlockId}`}
              data-handleid={`condition-${block.id}`}
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
              }}
              isConnectableStart={true}
              isConnectableEnd={false}
              isValidConnection={(connection) => {
                // Prevent self-connections
                if (connection.source === connection.target) return false

                // Existing validation to prevent connections within the same parent node
                const sourceNodeId = connection.source?.split('-')[0]
                const targetNodeId = connection.target?.split('-')[0]
                return sourceNodeId !== targetNodeId
              }}
            />
            <div className='flex items-center gap-1'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => addBlock(block.id)}
                    disabled={isPreview || disabled}
                    className='h-8 w-8'
                  >
                    <Plus className='h-4 w-4' />
                    <span className='sr-only'>Add Block</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Add Block</TooltipContent>
              </Tooltip>

              <div className='flex items-center'>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => moveBlock(block.id, 'up')}
                      disabled={isPreview || index === 0 || disabled}
                      className='h-8 w-8'
                    >
                      <ChevronUp className='h-4 w-4' />
                      <span className='sr-only'>Move Up</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move Up</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => moveBlock(block.id, 'down')}
                      disabled={isPreview || index === conditionalBlocks.length - 1 || disabled}
                      className='h-8 w-8'
                    >
                      <ChevronDown className='h-4 w-4' />
                      <span className='sr-only'>Move Down</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Move Down</TooltipContent>
                </Tooltip>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => removeBlock(block.id)}
                    disabled={isPreview || conditionalBlocks.length === 1 || disabled}
                    className='h-8 w-8 text-destructive hover:text-destructive'
                  >
                    <Trash className='h-4 w-4' />
                    <span className='sr-only'>Delete Block</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete Condition</TooltipContent>
              </Tooltip>
            </div>
          </div>
          {block.title !== 'else' && (
            <div
              className={cn(
                'relative min-h-[100px] rounded-b-lg bg-background font-mono text-sm',
                isConnecting && 'ring-2 ring-blue-500 ring-offset-2'
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(block.id, e)}
            >
              {/* Line numbers */}
              <div
                className='absolute top-0 bottom-0 left-0 flex w-[30px] select-none flex-col items-end bg-muted/30 pt-3 pr-3'
                aria-hidden='true'
              >
                {renderLineNumbers(block.id)}
              </div>

              <div
                className='relative mt-0 pt-0 pl-[30px]'
                ref={editorRef}
                data-block-id={block.id}
              >
                {block.value.length === 0 && (
                  <div className='pointer-events-none absolute top-[12px] left-[42px] select-none text-muted-foreground/50'>
                    {'<response> === true'}
                  </div>
                )}
                <Editor
                  value={block.value}
                  onValueChange={(newCode) => {
                    if (!isPreview && !disabled) {
                      const textarea = editorRef.current?.querySelector(
                        `[data-block-id="${block.id}"] textarea`
                      ) as HTMLTextAreaElement | null
                      if (textarea) {
                        const pos = textarea.selectionStart ?? 0

                        const tagTrigger = checkTagTrigger(newCode, pos)
                        const envVarTrigger = checkEnvVarTrigger(newCode, pos)

                        setConditionalBlocks((blocks) =>
                          blocks.map((b) => {
                            if (b.id === block.id) {
                              return {
                                ...b,
                                value: newCode,
                                showTags: tagTrigger.show,
                                showEnvVars: envVarTrigger.show,
                                searchTerm: envVarTrigger.show ? envVarTrigger.searchTerm : '',
                                cursorPosition: pos,
                                activeSourceBlockId: tagTrigger.show ? b.activeSourceBlockId : null,
                              }
                            }
                            return b
                          })
                        )
                      }
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setConditionalBlocks((blocks) =>
                        blocks.map((b) =>
                          b.id === block.id ? { ...b, showTags: false, showEnvVars: false } : b
                        )
                      )
                    }
                  }}
                  highlight={(code) => highlight(code, languages.javascript, 'javascript')}
                  padding={12}
                  style={{
                    fontFamily: 'inherit',
                    minHeight: '46px',
                    lineHeight: '21px',
                  }}
                  className={cn('focus:outline-none', isPreview && 'cursor-not-allowed opacity-50')}
                  textareaClassName={cn(
                    'focus:outline-none focus:ring-0 bg-transparent',
                    isPreview && 'pointer-events-none'
                  )}
                />

                {block.showEnvVars && (
                  <EnvVarDropdown
                    visible={block.showEnvVars}
                    onSelect={(newValue) => handleEnvVarSelect(block.id, newValue)}
                    searchTerm={block.searchTerm}
                    inputValue={block.value}
                    cursorPosition={block.cursorPosition}
                    onClose={() => {
                      setConditionalBlocks((blocks) =>
                        blocks.map((b) =>
                          b.id === block.id ? { ...b, showEnvVars: false, searchTerm: '' } : b
                        )
                      )
                    }}
                  />
                )}

                {block.showTags && (
                  <TagDropdown
                    visible={block.showTags}
                    onSelect={(newValue) => handleTagSelect(block.id, newValue)}
                    blockId={blockId}
                    activeSourceBlockId={block.activeSourceBlockId}
                    inputValue={block.value}
                    cursorPosition={block.cursorPosition}
                    onClose={() => {
                      setConditionalBlocks((blocks) =>
                        blocks.map((b) =>
                          b.id === block.id
                            ? {
                                ...b,
                                showTags: false,
                                activeSourceBlockId: null,
                              }
                            : b
                        )
                      )
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
