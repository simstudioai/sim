import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Check, Copy, Wand2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Input } from '@/components/emcn/components/input/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { WandControlHandlers } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/sub-block'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'
import { useWebhookManagement } from '@/hooks/use-webhook-management'

/**
 * Props for the ShortInput component
 */
interface ShortInputProps {
  /** Placeholder text to display when empty */
  placeholder?: string
  /** Whether to mask the input as a password field */
  password?: boolean
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Configuration object for the sub-block */
  config: SubBlockConfig
  /** Controlled value from parent */
  value?: string
  /** Callback when value changes */
  onChange?: (value: string) => void
  /** Whether component is in preview mode */
  isPreview?: boolean
  /** Value to display in preview mode */
  previewValue?: string | null
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether the input is read-only */
  readOnly?: boolean
  /** Whether to show a copy button */
  showCopyButton?: boolean
  /** Whether to use webhook URL as value */
  useWebhookUrl?: boolean
  /** Ref to expose wand control handlers to parent */
  wandControlRef?: React.MutableRefObject<WandControlHandlers | null>
  /** Whether to hide the internal wand button (controlled by parent) */
  hideInternalWand?: boolean
}

/**
 * Single-line text input component with advanced features
 *
 * @remarks
 * - Supports AI-powered content generation via Wand functionality
 * - Auto-detects API key fields and provides environment variable suggestions
 * - Handles drag-and-drop for connections and variable references
 * - Provides environment variable and tag autocomplete
 * - Password masking with reveal on focus
 * - Copy to clipboard functionality
 * - Integrates with ReactFlow for zoom control
 */
export function ShortInput({
  blockId,
  subBlockId,
  placeholder,
  password,
  config,
  onChange,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
  readOnly = false,
  showCopyButton = false,
  useWebhookUrl = false,
  wandControlRef,
  hideInternalWand = false,
}: ShortInputProps) {
  // Local state for immediate UI updates during streaming
  const [localContent, setLocalContent] = useState<string>('')
  const [isFocused, setIsFocused] = useState(false)
  const [copied, setCopied] = useState(false)
  const persistSubBlockValueRef = useRef<(value: string) => void>(() => {})

  // Always call the hook - hooks must be called unconditionally
  const webhookManagement = useWebhookManagement({
    blockId,
    triggerId: undefined,
    isPreview,
  })

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
      // Final content update
      setLocalContent(content)
      if (!isPreview && !disabled && !readOnly) {
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

  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Get ReactFlow instance for zoom control
  const reactFlowInstance = useReactFlow()

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  // Check if this input is API key related - memoized to prevent recalculation
  const isApiKeyField = useMemo(() => {
    const normalizedId = config?.id?.replace(/\s+/g, '').toLowerCase() || ''
    const normalizedTitle = config?.title?.replace(/\s+/g, '').toLowerCase() || ''

    // Check for common API key naming patterns
    const apiKeyPatterns = [
      'apikey',
      'api_key',
      'api-key',
      'secretkey',
      'secret_key',
      'secret-key',
      'token',
      'access_token',
      'auth_token',
      'secret',
      'password',
    ]

    return apiKeyPatterns.some(
      (pattern) =>
        normalizedId === pattern ||
        normalizedTitle === pattern ||
        normalizedId.includes(pattern) ||
        normalizedTitle.includes(pattern)
    )
  }, [config?.id, config?.title])

  const shouldForceEnvDropdown = useCallback(
    ({
      value,
      event,
    }: {
      value: string
      cursor: number
      event: 'change' | 'focus' | 'deleteAll'
    }) => {
      if (!isApiKeyField || isPreview || disabled || readOnly) return { show: false }
      if (event === 'focus') {
        return { show: true, searchTerm: '' }
      }
      if (event === 'change') {
        // For API key fields, show env vars while typing without requiring '{{'
        return { show: true, searchTerm: value }
      }
      if (event === 'deleteAll') {
        return { show: true, searchTerm: '' }
      }
      return { show: false }
    },
    [isApiKeyField, isPreview, disabled, readOnly]
  )

  // Use preview value when in preview mode, otherwise use store value or prop value
  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : undefined

  // During streaming, use local content; otherwise use base value
  // Only use webhook URL when useWebhookUrl flag is true
  const effectiveValue =
    useWebhookUrl && webhookManagement.webhookUrl ? webhookManagement.webhookUrl : baseValue

  const value = wandHook?.isStreaming ? localContent : effectiveValue

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!wandHook.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook.isStreaming, localContent])

  /**
   * Scrolls the input to show the cursor position
   * Uses canvas for efficient text width measurement instead of DOM manipulation
   */
  const scrollToCursor = useCallback(() => {
    if (!inputRef.current) return

    // Use requestAnimationFrame to ensure DOM has updated
    requestAnimationFrame(() => {
      if (!inputRef.current) return

      const cursorPos = inputRef.current.selectionStart ?? 0
      const inputWidth = inputRef.current.offsetWidth
      const scrollWidth = inputRef.current.scrollWidth

      // Get approximate cursor position in pixels using canvas (more efficient)
      const textBeforeCursor = inputRef.current.value.substring(0, cursorPos)
      const computedStyle = window.getComputedStyle(inputRef.current)

      // Use canvas context for text measurement (more efficient than creating DOM elements)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (context) {
        context.font = computedStyle.font
        const cursorPixelPos = context.measureText(textBeforeCursor).width

        // Calculate optimal scroll position to center the cursor
        const targetScroll = Math.max(0, cursorPixelPos - inputWidth / 2)

        // Only scroll if cursor is not visible
        if (
          cursorPixelPos < inputRef.current.scrollLeft ||
          cursorPixelPos > inputRef.current.scrollLeft + inputWidth
        ) {
          inputRef.current.scrollLeft = Math.min(targetScroll, scrollWidth - inputWidth)
        }

        // Sync overlay scroll
        if (overlayRef.current) {
          overlayRef.current.scrollLeft = inputRef.current.scrollLeft
        }
      }
    })
  }, [])

  // Sync scroll position between input and overlay
  const handleScroll = useCallback((e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }, [])

  // Remove the auto-scroll effect that forces cursor position and replace with natural scrolling
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  // Handle paste events to ensure long values are handled correctly
  const handlePaste = useCallback((_e: React.ClipboardEvent<HTMLInputElement>) => {
    // Let the paste happen normally
    // Then ensure scroll positions are synced after the content is updated
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }, [])

  // Handle wheel events to control ReactFlow zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      // Only handle zoom when Ctrl/Cmd key is pressed
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()

        // Get current zoom level and viewport
        const currentZoom = reactFlowInstance.getZoom()
        const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

        // Calculate zoom factor based on wheel delta
        // Use a smaller factor for smoother zooming that matches ReactFlow's native behavior
        const delta = e.deltaY > 0 ? 1 : -1
        // Using 0.98 instead of 0.95 makes the zoom much slower and more gradual
        const zoomFactor = 0.96 ** delta

        // Calculate new zoom level with min/max constraints
        const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.1), 1)

        // Get the position of the cursor in the page
        const { x: pointerX, y: pointerY } = reactFlowInstance.screenToFlowPosition({
          x: e.clientX,
          y: e.clientY,
        })

        // Calculate the new viewport position to keep the cursor position fixed
        const newViewportX = viewportX + (pointerX * currentZoom - pointerX * newZoom)
        const newViewportY = viewportY + (pointerY * currentZoom - pointerY * newZoom)

        // Set the new viewport with the calculated position and zoom
        reactFlowInstance.setViewport(
          {
            x: newViewportX,
            y: newViewportY,
            zoom: newZoom,
          },
          { duration: 0 }
        )

        return false
      }

      // For regular scrolling (without Ctrl/Cmd), let the default behavior happen
      // Don't interfere with normal scrolling
      return true
    },
    [reactFlowInstance]
  )

  /**
   * Handles copying the value to the clipboard.
   */
  const handleCopy = useCallback(() => {
    const textToCopy = useWebhookUrl ? webhookManagement?.webhookUrl : value?.toString()
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [useWebhookUrl, webhookManagement?.webhookUrl, value])

  // Value display logic - memoize to avoid unnecessary string operations
  const displayValue = useMemo(
    () =>
      password && !isFocused
        ? '•'.repeat(value?.toString().length ?? 0)
        : (value?.toString() ?? ''),
    [password, isFocused, value]
  )

  // Memoize formatted text to avoid recalculation on every render
  const formattedText = useMemo(() => {
    const textValue = value?.toString() ?? ''
    if (password && !isFocused) {
      return '•'.repeat(textValue.length)
    }
    return formatDisplayText(textValue, {
      accessiblePrefixes,
      highlightAll: !accessiblePrefixes,
    })
  }, [value, password, isFocused, accessiblePrefixes])

  // Memoize focus handler to prevent unnecessary re-renders
  const handleFocus = useCallback(() => {
    setIsFocused(true)
  }, [])

  // Memoize blur handler to prevent unnecessary re-renders
  const handleBlur = useCallback(() => {
    setIsFocused(false)
  }, [])

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
      {isWandEnabled && !hideInternalWand && (
        <WandPromptBar
          isVisible={wandHook.isPromptVisible}
          isLoading={wandHook.isLoading}
          isStreaming={wandHook.isStreaming}
          promptValue={wandHook.promptInputValue}
          onSubmit={(prompt: string) => wandHook.generateStream({ prompt })}
          onCancel={wandHook.isStreaming ? wandHook.cancelGeneration : wandHook.hidePromptInline}
          onChange={(newValue: string) => wandHook.updatePromptValue(newValue)}
          placeholder={config.wandConfig?.placeholder || 'Describe what you want to generate...'}
        />
      )}

      <div className='group relative w-full'>
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
          shouldForceEnvDropdown={shouldForceEnvDropdown}
        >
          {({
            ref,
            value: ctrlValue,
            onChange: handleChange,
            onKeyDown,
            onDrop,
            onDragOver,
            onFocus,
          }) => {
            // Use controller's value for input, but apply local transformations
            const actualValue = wandHook.isStreaming
              ? localContent
              : useWebhookUrl && webhookManagement.webhookUrl
                ? webhookManagement.webhookUrl
                : ctrlValue

            const displayValue =
              password && !isFocused ? '•'.repeat(actualValue?.length ?? 0) : actualValue

            const formattedText =
              password && !isFocused
                ? '•'.repeat(actualValue?.length ?? 0)
                : formatDisplayText(actualValue, {
                    accessiblePrefixes,
                    highlightAll: !accessiblePrefixes,
                  })

            return (
              <>
                <Input
                  ref={ref as React.RefObject<HTMLInputElement>}
                  className={cn(
                    'allow-scroll w-full overflow-auto text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden',
                    showCopyButton && 'pr-14'
                  )}
                  readOnly={readOnly}
                  placeholder={placeholder ?? ''}
                  type='text'
                  value={displayValue}
                  onChange={handleChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
                  onFocus={() => {
                    setIsFocused(true)
                    onFocus()
                  }}
                  onBlur={handleBlur}
                  onDrop={onDrop as (e: React.DragEvent<HTMLInputElement>) => void}
                  onDragOver={onDragOver as (e: React.DragEvent<HTMLInputElement>) => void}
                  onScroll={handleScroll}
                  onPaste={handlePaste}
                  onWheel={handleWheel}
                  onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLInputElement>) => void}
                  autoComplete='off'
                  disabled={disabled}
                />
                <div
                  ref={overlayRef}
                  className={cn(
                    'pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-foreground text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                    showCopyButton ? 'pr-14' : 'pr-3'
                  )}
                >
                  <div className='min-w-fit whitespace-pre'>{formattedText}</div>
                </div>
              </>
            )
          }}
        </SubBlockInputController>

        {/* Copy Button */}
        {showCopyButton && value && (
          <div className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 flex w-14 items-center justify-end pr-2 opacity-0 transition-opacity group-hover:opacity-100'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              onClick={handleCopy}
              disabled={!value}
              className='pointer-events-auto h-6 w-6 p-0'
              aria-label='Copy value'
            >
              {copied ? (
                <Check className='h-3.5 w-3.5 text-green-500' />
              ) : (
                <Copy className='h-3.5 w-3.5 text-muted-foreground' />
              )}
            </Button>
          </div>
        )}

        {/* Wand Button - only show if not hidden by parent */}
        {isWandEnabled && !isPreview && !wandHook.isStreaming && !hideInternalWand && (
          <div className='-translate-y-1/2 absolute top-1/2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
            <Button
              variant='ghost'
              size='icon'
              onClick={
                wandHook.isPromptVisible ? wandHook.hidePromptInline : wandHook.showPromptInline
              }
              disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
              aria-label='Generate content with AI'
              className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-foreground hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
