import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import Editor from 'react-simple-code-editor'
import { useUpdateNodeInternals } from 'reactflow'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/emcn/components/button/button'
import {
  Code,
  calculateGutterWidth,
  getCodeEditorProps,
  highlight,
  languages,
} from '@/components/emcn/components/code/code'
import { Trash } from '@/components/emcn/icons/trash'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import {
  isLikelyReferenceSegment,
  SYSTEM_REFERENCE_PREFIXES,
  splitReferenceSegment,
} from '@/lib/workflows/references'
import {
  checkEnvVarTrigger,
  EnvVarDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import {
  checkTagTrigger,
  TagDropdown,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { normalizeBlockName } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('ConditionInput')

/**
 * Represents a single conditional block (if/else if/else).
 */
interface ConditionalBlock {
  /** Unique identifier for the block */
  id: string
  /** Block title (if/else if/else) */
  title: string
  /** Code content of the condition */
  value: string
  /** Whether tag dropdown is visible */
  showTags: boolean
  /** Whether environment variable dropdown is visible */
  showEnvVars: boolean
  /** Current search term for env var dropdown */
  searchTerm: string
  /** Current cursor position in the editor */
  cursorPosition: number
  /** ID of the active source block for connections */
  activeSourceBlockId: string | null
}

/**
 * Props for the ConditionInput component.
 */
interface ConditionInputProps {
  /** ID of the parent workflow block */
  blockId: string
  /** ID of this subblock */
  subBlockId: string
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Preview value to display instead of store value */
  previewValue?: string | null
  /** Whether the component is disabled */
  disabled?: boolean
}

/**
 * Generates a stable ID for conditional blocks.
 *
 * @param blockId - The parent block ID
 * @param suffix - Suffix to append (e.g., 'if', 'else', 'else-if-timestamp')
 * @returns A stable composite ID
 */
const generateStableId = (blockId: string, suffix: string): string => {
  return `${blockId}-${suffix}`
}

/**
 * Condition input component for creating if/else if/else conditional logic blocks.
 * Provides a code editor interface with syntax highlighting, tag completion,
 * and environment variable support for each condition branch.
 *
 * @param props - Component props
 * @returns Rendered condition input component
 */
export function ConditionInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
}: ConditionInputProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)

  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  const containerRef = useRef<HTMLDivElement>(null)

  /**
   * Determines if a reference string should be highlighted in the editor.
   *
   * @param part - String segment to check (e.g., '<blockName.field>')
   * @returns True if the reference should be highlighted
   */
  const shouldHighlightReference = (part: string): boolean => {
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
  }
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
  const shouldPersistRef = useRef<boolean>(false)

  /**
   * Creates default if/else conditional blocks with stable IDs.
   *
   * @returns Array of two default blocks (if and else)
   */
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

  /**
   * Safely parses JSON string into conditional blocks array.
   *
   * @param jsonString - JSON string to parse
   * @returns Parsed blocks array or null if invalid
   */
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
          if (!isReady) setIsReady(true)
          isSyncingFromStoreRef.current = false
          return
        }

        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
        shouldPersistRef.current = false
        isSyncingFromStoreRef.current = false
        return
      }

      if (effectiveValueStr === prevStoreValueRef.current && hasInitializedRef.current) {
        if (!isReady) setIsReady(true)
        isSyncingFromStoreRef.current = false
        return
      }

      prevStoreValueRef.current = effectiveValueStr

      const parsedBlocks = safeParseJSON(effectiveValueStr)

      if (parsedBlocks) {
        const blocksWithCorrectTitles = parsedBlocks.map((block, index) => ({
          ...block,
          title: index === 0 ? 'if' : index === parsedBlocks.length - 1 ? 'else' : 'else if',
        }))

        setConditionalBlocks(blocksWithCorrectTitles)
        hasInitializedRef.current = true
        if (!isReady) setIsReady(true)
        shouldPersistRef.current = false
      } else if (!hasInitializedRef.current) {
        setConditionalBlocks(createDefaultBlocks())
        hasInitializedRef.current = true
        setIsReady(true)
        shouldPersistRef.current = false
      }
    } finally {
      setTimeout(() => {
        isSyncingFromStoreRef.current = false
      }, 0)
    }
  }, [storeValue, previewValue, isPreview, blockId, isReady])

  // Update store whenever conditional blocks change
  useEffect(() => {
    if (
      isSyncingFromStoreRef.current ||
      !isReady ||
      conditionalBlocks.length === 0 ||
      isPreview ||
      !shouldPersistRef.current
    )
      return

    const newValue = JSON.stringify(conditionalBlocks)

    if (newValue !== prevStoreValueRef.current) {
      prevStoreValueRef.current = newValue
      setStoreValue(newValue)
      updateNodeInternals(blockId)
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
    if (!containerRef.current || conditionalBlocks.length === 0) return

    const calculateVisualLines = () => {
      const preElement = containerRef.current?.querySelector('pre')
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
    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [conditionalBlocks])

  /**
   * Renders line numbers for a specific conditional block.
   *
   * @param blockId - ID of the block to render line numbers for
   * @returns Array of line number elements
   */
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

  /**
   * Handles dropping a connection block onto a condition editor.
   *
   * @param blockId - ID of the conditional block receiving the drop
   * @param e - Drag event
   */
  const handleDrop = (blockId: string, e: React.DragEvent) => {
    if (isPreview || disabled) return
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      const textarea: any = containerRef.current?.querySelector(
        `[data-block-id="${blockId}"] textarea`
      )
      const dropPosition = textarea?.selectionStart ?? 0

      shouldPersistRef.current = true
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
    shouldPersistRef.current = true
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
    shouldPersistRef.current = true
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

  const handleTagSelectImmediate = (blockId: string, newValue: string) => {
    if (isPreview || disabled) return

    shouldPersistRef.current = true
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

    const updatedBlocks = conditionalBlocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            value: newValue,
            showTags: false,
            activeSourceBlockId: null,
          }
        : block
    )
    emitTagSelection(JSON.stringify(updatedBlocks))
  }

  const handleEnvVarSelectImmediate = (blockId: string, newValue: string) => {
    if (isPreview || disabled) return

    shouldPersistRef.current = true
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

    const updatedBlocks = conditionalBlocks.map((block) =>
      block.id === blockId
        ? {
            ...block,
            value: newValue,
            showEnvVars: false,
            searchTerm: '',
          }
        : block
    )
    emitTagSelection(JSON.stringify(updatedBlocks))
  }

  /**
   * Updates block titles based on their position in the array.
   * First block is always 'if', last is 'else', middle ones are 'else if'.
   *
   * @param blocks - Array of conditional blocks
   * @returns Updated blocks with correct titles
   */
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
    if (conditionalBlocks[blockIndex]?.title === 'else') return

    const newBlockId = generateStableId(blockId, `else-if-${Date.now()}`)

    const newBlock: ConditionalBlock = {
      id: newBlockId,
      title: '',
      value: '',
      showTags: false,
      showEnvVars: false,
      searchTerm: '',
      cursorPosition: 0,
      activeSourceBlockId: null,
    }

    const newBlocks = [...conditionalBlocks]
    newBlocks.splice(blockIndex + 1, 0, newBlock)
    shouldPersistRef.current = true
    setConditionalBlocks(updateBlockTitles(newBlocks))

    setTimeout(() => {
      const textarea: any = containerRef.current?.querySelector(
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
    shouldPersistRef.current = true
    setConditionalBlocks((blocks) => updateBlockTitles(blocks.filter((block) => block.id !== id)))

    setTimeout(() => updateNodeInternals(blockId), 0)
  }

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    if (isPreview || disabled) return

    const blockIndex = conditionalBlocks.findIndex((block) => block.id === id)
    if (blockIndex === -1) return

    if (conditionalBlocks[blockIndex]?.title === 'else') return

    if (
      (direction === 'up' && blockIndex === 0) ||
      (direction === 'down' && blockIndex === conditionalBlocks.length - 1)
    )
      return

    const newBlocks = [...conditionalBlocks]
    const targetIndex = direction === 'up' ? blockIndex - 1 : blockIndex + 1

    if (direction === 'down' && newBlocks[targetIndex]?.title === 'else') return

    ;[newBlocks[blockIndex], newBlocks[targetIndex]] = [
      newBlocks[targetIndex],
      newBlocks[blockIndex],
    ]
    shouldPersistRef.current = true
    setConditionalBlocks(updateBlockTitles(newBlocks))

    setTimeout(() => updateNodeInternals(blockId), 0)
  }

  // Add useEffect to handle keyboard events for both dropdowns
  useEffect(() => {
    conditionalBlocks.forEach((block) => {
      const textarea = containerRef.current?.querySelector(`[data-block-id="${block.id}"] textarea`)
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
    <div className='space-y-[8px]' ref={containerRef}>
      {conditionalBlocks.map((block, index) => (
        <div
          key={block.id}
          className='group relative overflow-visible rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'
        >
          <div
            className={cn(
              'flex items-center justify-between overflow-hidden bg-transparent px-[10px] py-[5px]',
              block.title === 'else'
                ? 'rounded-[4px] border-0'
                : 'rounded-t-[4px] border-[var(--border-strong)] border-b'
            )}
          >
            <span className='font-medium text-[14px] text-[var(--text-tertiary)]'>
              {block.title}
            </span>
            <div className='flex items-center gap-[8px]'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => addBlock(block.id)}
                    disabled={isPreview || disabled || block.title === 'else'}
                    className='h-auto p-0'
                  >
                    <Plus className='h-[14px] w-[14px]' />
                    <span className='sr-only'>Add Block</span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Add Block</Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => moveBlock(block.id, 'up')}
                    disabled={isPreview || index === 0 || disabled || block.title === 'else'}
                    className='h-auto p-0'
                  >
                    <ChevronUp className='h-[14px] w-[14px]' />
                    <span className='sr-only'>Move Up</span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Move Up</Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => moveBlock(block.id, 'down')}
                    disabled={
                      isPreview ||
                      disabled ||
                      index === conditionalBlocks.length - 1 ||
                      conditionalBlocks[index + 1]?.title === 'else' ||
                      block.title === 'else'
                    }
                    className='h-auto p-0'
                  >
                    <ChevronDown className='h-[14px] w-[14px]' />
                    <span className='sr-only'>Move Down</span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Move Down</Tooltip.Content>
              </Tooltip.Root>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    variant='ghost'
                    onClick={() => removeBlock(block.id)}
                    disabled={isPreview || conditionalBlocks.length === 1 || disabled}
                    className='h-auto p-0 text-[var(--text-error)] hover:text-[var(--text-error)]'
                  >
                    <Trash className='h-[14px] w-[14px]' />
                    <span className='sr-only'>Delete Block</span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>Delete Condition</Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>
          {block.title !== 'else' &&
            (() => {
              const blockLineCount = block.value.split('\n').length
              const blockGutterWidth = calculateGutterWidth(blockLineCount)

              return (
                <Code.Container
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(block.id, e)}
                  className='rounded-t-none border-0'
                >
                  <Code.Gutter width={blockGutterWidth}>{renderLineNumbers(block.id)}</Code.Gutter>

                  <Code.Content paddingLeft={`${blockGutterWidth}px`}>
                    <div data-block-id={block.id}>
                      <Code.Placeholder
                        gutterWidth={blockGutterWidth}
                        show={block.value.length === 0}
                      >
                        {'<response> === true'}
                      </Code.Placeholder>

                      <Editor
                        value={block.value}
                        onValueChange={(newCode) => {
                          if (!isPreview && !disabled) {
                            const textarea = containerRef.current?.querySelector(
                              `[data-block-id="${block.id}"] textarea`
                            ) as HTMLTextAreaElement | null
                            if (textarea) {
                              const pos = textarea.selectionStart ?? 0

                              const tagTrigger = checkTagTrigger(newCode, pos)
                              const envVarTrigger = checkEnvVarTrigger(newCode, pos)

                              shouldPersistRef.current = true
                              setConditionalBlocks((blocks) =>
                                blocks.map((b) => {
                                  if (b.id === block.id) {
                                    return {
                                      ...b,
                                      value: newCode,
                                      showTags: tagTrigger.show,
                                      showEnvVars: envVarTrigger.show,
                                      searchTerm: envVarTrigger.show
                                        ? envVarTrigger.searchTerm
                                        : '',
                                      cursorPosition: pos,
                                      activeSourceBlockId: tagTrigger.show
                                        ? b.activeSourceBlockId
                                        : null,
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
                                b.id === block.id
                                  ? { ...b, showTags: false, showEnvVars: false }
                                  : b
                              )
                            )
                          }
                        }}
                        highlight={(codeToHighlight) => {
                          const placeholders: {
                            placeholder: string
                            original: string
                            type: 'var' | 'env'
                          }[] = []
                          let processedCode = codeToHighlight

                          // Replace environment variables with placeholders
                          processedCode = processedCode.replace(/\{\{([^}]+)\}\}/g, (match) => {
                            const placeholder = `__ENV_VAR_${placeholders.length}__`
                            placeholders.push({ placeholder, original: match, type: 'env' })
                            return placeholder
                          })

                          // Replace variable references with placeholders
                          processedCode = processedCode.replace(/<([^>]+)>/g, (match) => {
                            if (shouldHighlightReference(match)) {
                              const placeholder = `__VAR_REF_${placeholders.length}__`
                              placeholders.push({ placeholder, original: match, type: 'var' })
                              return placeholder
                            }
                            return match
                          })

                          // Apply Prism syntax highlighting
                          let highlightedCode = highlight(
                            processedCode,
                            languages.javascript,
                            'javascript'
                          )

                          // Restore and highlight the placeholders
                          placeholders.forEach(({ placeholder, original, type }) => {
                            if (type === 'env') {
                              highlightedCode = highlightedCode.replace(
                                placeholder,
                                `<span class="text-blue-500">${original}</span>`
                              )
                            } else if (type === 'var') {
                              // Escape the < and > for display
                              const escaped = original.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                              highlightedCode = highlightedCode.replace(
                                placeholder,
                                `<span class="text-blue-500">${escaped}</span>`
                              )
                            }
                          })

                          return highlightedCode
                        }}
                        {...getCodeEditorProps({ isPreview, disabled })}
                      />

                      {block.showEnvVars && (
                        <EnvVarDropdown
                          visible={block.showEnvVars}
                          onSelect={(newValue) => handleEnvVarSelectImmediate(block.id, newValue)}
                          searchTerm={block.searchTerm}
                          inputValue={block.value}
                          cursorPosition={block.cursorPosition}
                          workspaceId={workspaceId}
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
                          onSelect={(newValue) => handleTagSelectImmediate(block.id, newValue)}
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
                  </Code.Content>
                </Code.Container>
              )
            })()}
        </div>
      ))}
    </div>
  )
}
