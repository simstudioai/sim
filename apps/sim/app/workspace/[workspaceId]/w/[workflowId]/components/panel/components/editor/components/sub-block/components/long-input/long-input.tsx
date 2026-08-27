import type React from 'react'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Button, cn } from '@sim/emcn'
import { ChevronsUpDown, Wand } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'
import { ReferenceTextarea } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/reference-text-control'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { getActiveWorkflowSearchHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
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
  /** Whether to conceal the value except while the textarea is focused */
  password?: boolean
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
  workflowSearchValuePath?: Array<string | number>
}

/**
 * Multi-line text input component with AI generation support and variable reference handling
 *
 * @remarks
 * - Supports AI-powered content generation via Wand functionality
 * - Handles drag-and-drop for connections and variable references
 * - Provides environment variable and tag autocomplete
 * - Resizable with custom drag handle
 * - Password masking, revealed only while focused
 * - Integrates with ReactFlow for zoom control
 */
export function LongInput({
  placeholder,
  password,
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
  workflowSearchValuePath = [],
}: LongInputProps) {
  const activeSearchTarget = useActiveSearchTarget()
  // Local state for immediate UI updates during streaming
  const [localContent, setLocalContent] = useState<string>('')
  const [isFocused, setIsFocused] = useState(false)
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

  persistSubBlockValueRef.current = (value: string) => {
    setSubBlockValue(value)
  }

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
  const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: workflowSearchValuePath,
  })

  /**
   * Callback to show tag dropdown when input is empty and focused
   */
  const shouldForceTagDropdown = useCallback(
    ({
      value,
    }: {
      value: string
      cursor: number
      event: 'focus'
    }): { show: boolean } | undefined => {
      if (isPreview || disabled) return { show: false }
      // Show tag dropdown on focus when input is empty
      if (value.trim() === '') {
        return { show: true }
      }
      return { show: false }
    },
    [isPreview, disabled]
  )

  // During streaming, use local content; otherwise use the controller value
  const value = wandHook.isStreaming ? localContent : ctrl.valueString

  const shouldMask = shouldMaskSecretValue({ password, isFocused })
  const displayValue = shouldMask ? maskSecretText(value) : value

  const handleBlur = useCallback(() => {
    setIsFocused(false)
  }, [])

  // Base value for syncing (not including streaming)
  const baseValue = isPreview
    ? previewValue
    : propValue !== undefined
      ? propValue
      : ctrl.valueString

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!wandHook.isStreaming) {
      setLocalContent((prev) => {
        const baseValueString = baseValue?.toString() ?? ''
        return baseValueString !== prev ? baseValueString : prev
      })
    }
  }, [baseValue, wandHook.isStreaming])

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

  // Ensure overlay updates when content changes
  useEffect(() => {
    if (textareaRef.current && overlayRef.current) {
      // Ensure scrolling is synchronized
      overlayRef.current.scrollTop = textareaRef.current.scrollTop
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [value])

  // Handle resize functionality
  const startResize = (e: React.MouseEvent) => {
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
  }

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

  const showWandButton = isWandEnabled && !isPreview && !wandHook.isStreaming && !hideInternalWand

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
        shouldForceTagDropdown={shouldForceTagDropdown}
      >
        {({ ref, onChange: handleChange, onKeyDown, onDrop, onDragOver, onFocus }) => {
          const setRefs = (el: HTMLTextAreaElement | null) => {
            textareaRef.current = el
            ;(ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
          }
          return (
            <ReferenceTextarea
              ref={setRefs}
              containerRef={containerRef}
              containerStyle={{ height: `${height}px` }}
              overlayRef={overlayRef}
              overlayContent={
                shouldMask
                  ? displayValue
                  : formatDisplayText(value, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                      workflowSearchHighlight,
                    })
              }
              overlayClassName={cn(showWandButton && 'pr-7')}
              interactiveOverlay={isPreview || Boolean(disabled)}
              className={cn(
                'allow-scroll',
                wandHook.isStreaming && 'pointer-events-none cursor-not-allowed opacity-50'
              )}
              rows={rows ?? DEFAULT_ROWS}
              placeholder={placeholder ?? ''}
              value={displayValue}
              onChange={handleChange as (e: React.ChangeEvent<HTMLTextAreaElement>) => void}
              onDrop={onDrop as (e: React.DragEvent<HTMLTextAreaElement>) => void}
              onDragOver={onDragOver as (e: React.DragEvent<HTMLTextAreaElement>) => void}
              onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLTextAreaElement>) => void}
              onFocus={(event) => {
                setIsFocused(true)
                onFocus(event)
              }}
              onBlur={handleBlur}
              disabled={isPreview || disabled}
              adornment={
                <>
                  {showWandButton ? (
                    <div className='absolute top-2 right-2 z-10 flex items-center opacity-0 transition-opacity group-hover:opacity-100'>
                      <Button
                        variant='quiet'
                        size='icon'
                        onClick={
                          wandHook.isPromptVisible
                            ? wandHook.hidePromptInline
                            : wandHook.showPromptInline
                        }
                        disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
                        aria-label='Generate content with AI'
                      >
                        <Wand className='size-[14px]' />
                      </Button>
                    </div>
                  ) : null}
                  {!wandHook.isStreaming ? (
                    <div
                      role='separator'
                      aria-orientation='horizontal'
                      className='absolute right-1 bottom-1 flex size-4 cursor-ns-resize items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--surface-5)] dark:bg-[var(--surface-4)]'
                      onMouseDown={startResize}
                      onDragStart={(e) => {
                        e.preventDefault()
                      }}
                    >
                      <ChevronsUpDown className='size-[14px] text-[var(--text-icon)]' />
                    </div>
                  ) : null}
                </>
              }
            />
          )
        }}
      </SubBlockInputController>
    </>
  )
}
