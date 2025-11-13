import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronsUpDown, Wand2 } from 'lucide-react'
import { Textarea } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/sub-block'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'

const logger = createLogger('LongInput')

/**
 * Default number of rows for the textarea
 */
const DEFAULT_ROWS = 5

/**
 * Height of each row in pixels
 */
const ROW_HEIGHT_PX = 24

/**
 * Minimum height constraint for the textarea in pixels
 */
const MIN_HEIGHT_PX = 80

/**
 * Props for the LongInput component
 */
interface LongInputProps {
  /** Placeholder text to display when empty */
  placeholder?: string
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Configuration object for the sub-block */
  config: SubBlockConfig
  /** Number of rows to display */
  rows?: number
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | null
  /** Controlled value from parent */
  value?: string
  /** Callback when value changes */
  onChange?: (value: string) => void
  /** Whether the input is disabled */
  disabled?: boolean
  /** Ref to expose wand control handlers to parent */
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  /** Whether to hide the internal wand button (controlled by parent) */
  hideInternalWand?: boolean
}

/**
 * Multi-line text input component with AI generation support and variable reference handling
 *
 * @remarks
 * - Supports AI-powered content generation via Wand functionality
 * - Handles drag-and-drop for connections and variable references
 * - Provides environment variable and tag autocomplete
 * - Resizable with custom drag handle
 * - Integrates with ReactFlow for zoom control
 */
export function LongInput({
  placeholder,
  blockId,
  subBlockId,
  config,
  rows,
  isPreview = false,
  previewValue,
  value: propValue,
  onChange,
  disabled,
  wandControlRef,
  hideInternalWand = false,
}: LongInputProps) {
  // Local state for immediate UI updates during streaming
  const [localContent, setLocalContent] = useState<string>('')
  const persistSubBlockValueRef = useRef<(value: string) => void>(() => {})

  // Wand functionality - always call the hook unconditionally
  const wandHook = useWand({
    wandConfig: config.wandConfig,
    currentValue: localContent,
    onStreamStart: () => {
      // Clear the content when streaming starts
      setLocalContent('')
    },
    onStreamChunk: (chunk) => {
      // Update local content with each chunk as it arrives
      setLocalContent((current) => current + chunk)
    },
    onGeneratedContent: (content) => {
      // Final content update (fallback)
      setLocalContent(content)
      if (!isPreview && !disabled) {
        persistSubBlockValueRef.current(content)
      }
    },
  })

  const [, setSubBlockValue] = useSubBlockValue<string>(blockId, subBlockId, false, {
    isStreaming: wandHook.isStreaming,
  })

  useEffect(() => {
    persistSubBlockValueRef.current = (value: string) => {
      setSubBlockValue(value)
    }
  }, [setSubBlockValue])

  // Check if wand is actually enabled
  const isWandEnabled = config.wandConfig?.enabled ?? false

  // Use the new input controller hook for shared behavior
  const ctrl = useSubBlockInput({
    blockId,
    subBlockId,
    config,
    value: propValue,
    onChange,
    isPreview,
    disabled,
    isStreaming: wandHook.isStreaming,
    onStreamingEnd: () => {
      logger.debug('Wand streaming ended, value persisted', { blockId, subBlockId })
    },
    previewValue,
  })

  const [height, setHeight] = useState(() => {
    const rowCount = rows || DEFAULT_ROWS
    return Math.max(rowCount * ROW_HEIGHT_PX, MIN_HEIGHT_PX)
  })

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  // During streaming, use local content; otherwise use the controller value
  const value = useMemo(() => {
    if (wandHook.isStreaming) return localContent
    return ctrl.valueString
  }, [wandHook.isStreaming, localContent, ctrl.valueString])

  // Base value for syncing (not including streaming)
  const baseValue = isPreview
    ? previewValue
    : propValue !== undefined
      ? propValue
      : ctrl.valueString

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!wandHook.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook.isStreaming]) // Removed localContent to prevent infinite loop

  // Update height when rows prop changes
  useLayoutEffect(() => {
    const rowCount = rows || DEFAULT_ROWS
    const newHeight = Math.max(rowCount * ROW_HEIGHT_PX, MIN_HEIGHT_PX)
    setHeight(newHeight)

    if (textareaRef.current && overlayRef.current) {
      textareaRef.current.style.height = `${newHeight}px`
      overlayRef.current.style.height = `${newHeight}px`
    }
  }, [rows])

  // Sync scroll position between textarea and overlay
  const handleScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  // Ensure overlay updates when content changes
  useEffect(() => {
    if (textareaRef.current && overlayRef.current) {
      // Ensure scrolling is synchronized
      overlayRef.current.scrollTop = textareaRef.current.scrollTop
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [value])

  // Handle resize functionality
  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      isResizing.current = true

      const startY = e.clientY
      const startHeight = height

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!isResizing.current) return

        const deltaY = moveEvent.clientY - startY
        const newHeight = Math.max(MIN_HEIGHT_PX, startHeight + deltaY)

        if (textareaRef.current && overlayRef.current) {
          textareaRef.current.style.height = `${newHeight}px`
          overlayRef.current.style.height = `${newHeight}px`
        }
        if (containerRef.current) {
          containerRef.current.style.height = `${newHeight}px`
        }
        // Keep React state in sync so parent layouts (e.g., Editor) update during drag
        setHeight(newHeight)
      }

      const handleMouseUp = () => {
        if (textareaRef.current) {
          const finalHeight = Number.parseInt(textareaRef.current.style.height, 10) || height
          setHeight(finalHeight)
        }

        isResizing.current = false
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [height]
  )

  // Expose wand control handlers to parent via ref
  useImperativeHandle(
    wandControlRef,
    () => ({
      onWandTrigger: (prompt: string) => {
        wandHook.generateStream({ prompt })
      },
      isWandActive: wandHook.isPromptVisible,
      isWandStreaming: wandHook.isStreaming,
    }),
    [wandHook]
  )

  return (
    <>
      {/* Wand Prompt Bar - positioned above the textarea */}
      {isWandEnabled && !hideInternalWand && (
        <WandPromptBar
          isVisible={wandHook.isPromptVisible}
          isLoading={wandHook.isLoading}
          isStreaming={wandHook.isStreaming}
          promptValue={wandHook.promptInputValue}
          onSubmit={(prompt: string) => wandHook.generateStream({ prompt })}
          onCancel={wandHook.isStreaming ? wandHook.cancelGeneration : wandHook.hidePromptInline}
          onChange={wandHook.updatePromptValue}
          placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
        />
      )}

      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlockId}
        config={config}
        value={propValue}
        onChange={onChange}
        isPreview={isPreview}
        disabled={disabled}
        isStreaming={wandHook.isStreaming}
        previewValue={previewValue}
      >
        {({ ref, onChange: handleChange, onKeyDown, onDrop, onDragOver, onFocus }) => {
          const setRefs = (el: HTMLTextAreaElement | null) => {
            textareaRef.current = el
            ;(ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
          }
          return (
            <div
              ref={containerRef}
              className={cn('group relative w-full', wandHook.isStreaming && 'streaming-effect')}
              style={{ height: `${height}px` }}
            >
              <Textarea
                ref={setRefs}
                className={cn(
                  'allow-scroll box-border min-h-full w-full resize-none text-transparent caret-foreground placeholder:text-muted-foreground/50',
                  wandHook.isStreaming && 'pointer-events-none cursor-not-allowed opacity-50'
                )}
                rows={rows ?? DEFAULT_ROWS}
                placeholder={placeholder ?? ''}
                value={value}
                onChange={handleChange as (e: React.ChangeEvent<HTMLTextAreaElement>) => void}
                onDrop={onDrop as (e: React.DragEvent<HTMLTextAreaElement>) => void}
                onDragOver={onDragOver as (e: React.DragEvent<HTMLTextAreaElement>) => void}
                onScroll={handleScroll}
                onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLTextAreaElement>) => void}
                onFocus={onFocus}
                disabled={isPreview || disabled}
                style={{
                  fontFamily: 'inherit',
                  lineHeight: 'inherit',
                  height: `${height}px`,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              />
              <div
                ref={overlayRef}
                className='pointer-events-none absolute inset-0 box-border overflow-auto whitespace-pre-wrap break-words border border-transparent bg-transparent px-[8px] py-[8px] font-medium font-sans text-sm'
                style={{
                  fontFamily: 'inherit',
                  lineHeight: 'inherit',
                  width: '100%',
                  height: `${height}px`,
                }}
              >
                {formatDisplayText(value, {
                  accessiblePrefixes,
                  highlightAll: !accessiblePrefixes,
                })}
              </div>

              {/* Wand Button - only show if not hidden by parent */}
              {isWandEnabled && !isPreview && !wandHook.isStreaming && !hideInternalWand && (
                <div className='absolute top-2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={
                      wandHook.isPromptVisible
                        ? wandHook.hidePromptInline
                        : wandHook.showPromptInline
                    }
                    disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
                    aria-label='Generate content with AI'
                    className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow'
                  >
                    <Wand2 className='h-4 w-4' />
                  </Button>
                </div>
              )}

              {/* Custom resize handle */}
              {!wandHook.isStreaming && (
                <div
                  className='absolute right-1 bottom-1 flex h-4 w-4 cursor-ns-resize items-center justify-center rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] dark:bg-[var(--surface-9)]'
                  onMouseDown={startResize}
                  onDragStart={(e) => {
                    e.preventDefault()
                  }}
                >
                  <ChevronsUpDown className='h-3 w-3 text-[var(--text-muted)]' />
                </div>
              )}
            </div>
          )
        }}
      </SubBlockInputController>
    </>
  )
}
