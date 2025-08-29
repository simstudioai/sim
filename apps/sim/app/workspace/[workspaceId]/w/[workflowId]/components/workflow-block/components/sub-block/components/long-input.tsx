import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronsUpDown, Wand2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { WandPromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/wand-prompt-bar/wand-prompt-bar'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useWand } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-wand'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { useOperationQueueStore } from '@/stores/operation-queue/store'

const logger = createLogger('LongInput')

interface LongInputProps {
  placeholder?: string
  blockId: string
  subBlockId: string
  isConnecting: boolean
  config: SubBlockConfig
  rows?: number
  isPreview?: boolean
  previewValue?: string | null
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
}

// Constants
const DEFAULT_ROWS = 4
const ROW_HEIGHT_PX = 24
const MIN_HEIGHT_PX = 80

export function LongInput({
  placeholder,
  blockId,
  subBlockId,
  isConnecting,
  config,
  rows,
  isPreview = false,
  previewValue,
  value: propValue,
  onChange,
  disabled,
}: LongInputProps) {
  // Local state for immediate UI updates during streaming
  const [localContent, setLocalContent] = useState<string>('')

  // Wand functionality (only if wandConfig is enabled) - define early to get streaming state
  const wandHook = config.wandConfig?.enabled
    ? useWand({
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
        },
      })
    : null

  // State management - useSubBlockValue with explicit streaming control
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    isStreaming: wandHook?.isStreaming || false, // Use wand streaming state
    onStreamingEnd: () => {
      logger.debug('Wand streaming ended, value persisted', { blockId, subBlockId })
    },
  })

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const overlayInnerRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use preview value when in preview mode, otherwise use store value or prop value
  const baseValue = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // During streaming, use local content; otherwise use base value
  const value = wandHook?.isStreaming ? localContent : baseValue

  // Sync local content with base value when not streaming
  useEffect(() => {
    if (!wandHook?.isStreaming) {
      const baseValueString = baseValue?.toString() ?? ''
      if (baseValueString !== localContent) {
        setLocalContent(baseValueString)
      }
    }
  }, [baseValue, wandHook?.isStreaming]) // Removed localContent to prevent infinite loop

  // Update store value during streaming (but won't persist until streaming ends)
  useEffect(() => {
    if (wandHook?.isStreaming && localContent !== '') {
      if (!isPreview && !disabled) {
        setStoreValue(localContent)
      }
    }
  }, [localContent, wandHook?.isStreaming, isPreview, disabled, setStoreValue])

  // Calculate initial height based on rows prop with reasonable defaults
  const getInitialHeight = () => {
    // Use provided rows or default, then convert to pixels with a minimum
    const rowCount = rows || DEFAULT_ROWS
    return Math.max(rowCount * ROW_HEIGHT_PX, MIN_HEIGHT_PX)
  }

  const [height, setHeight] = useState(getInitialHeight())
  const isResizing = useRef(false)

  // Get ReactFlow instance for zoom control
  const reactFlowInstance = useReactFlow()

  // Set initial height on first render
  useLayoutEffect(() => {
    const initialHeight = getInitialHeight()
    setHeight(initialHeight)

    if (textareaRef.current && overlayRef.current) {
      textareaRef.current.style.height = `${initialHeight}px`
      overlayRef.current.style.height = `${initialHeight}px`
    }
  }, [rows])

  // Set overlay width to match textarea clientWidth
  useLayoutEffect(() => {
    if (!textareaRef.current || !overlayRef.current) return
    const textarea = textareaRef.current
    const overlay = overlayRef.current

    const applyWidth = () => {
      // Match overlay content width to the inner content area of the textarea
      overlay.style.width = `${textarea.clientWidth}px`
    }

    applyWidth()

    const resizeObserver = new ResizeObserver(() => {
      applyWidth()
    })
    resizeObserver.observe(textarea)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // Initialize overlay transform to current scroll
  useLayoutEffect(() => {
    // Initialize overlay transform to current scroll
    syncScrollPositions()
  }, [])

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Don't allow changes if disabled or streaming
    if (disabled || wandHook?.isStreaming) return

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    // Update local content immediately
    setLocalContent(newValue)

    if (onChange) {
      onChange(newValue)
    } else if (!isPreview) {
      // Only update store when not in preview mode
      setStoreValue(newValue)
    }

    setCursorPosition(newCursorPosition)

    // Check for environment variables trigger
    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)
    setShowEnvVars(envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  // Sync scroll position between textarea and overlay
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (!overlayInnerRef.current) return
    const { scrollTop, scrollLeft } = e.currentTarget
    overlayInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
  }

  // Force synchronize scroll positions
  const syncScrollPositions = () => {
    if (!textareaRef.current || !overlayInnerRef.current) return
    const { scrollTop, scrollLeft } = textareaRef.current
    overlayInnerRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
  }

  // Ensure overlay updates when content changes
  useEffect(() => {
    syncScrollPositions()
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
        if (containerRef.current) {
          containerRef.current.style.height = `${newHeight}px`
        }
        // Keep overlay aligned with textarea scroll during live resize
        syncScrollPositions()
      }
    }

    const handleMouseUp = () => {
      if (textareaRef.current) {
        const finalHeight = Number.parseInt(textareaRef.current.style.height, 10) || height
        setHeight(finalHeight)
      }

      isResizing.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      // After resizing completes, re-sync to ensure caret at end remains visually aligned
      syncScrollPositions()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      // Get current cursor position or append to end
      const dropPosition = textareaRef.current?.selectionStart ?? value?.toString().length ?? 0

      // Insert '<' at drop position to trigger the dropdown
      const currentValue = value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      // Focus the textarea first
      textareaRef.current?.focus()

      // Update all state in a single batch
      Promise.resolve().then(() => {
        // Update local content immediately
        setLocalContent(newValue)

        if (onChange) {
          onChange(newValue)
        } else if (!isPreview) {
          setStoreValue(newValue)
        }
        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        // Pass the source block ID from the dropped connection
        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        // Set cursor position after state updates
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.selectionStart = dropPosition + 1
            textareaRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Handle key combinations
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      setShowTags(false)
    }
    // Prevent user input during streaming
    if (wandHook?.isStreaming) {
      e.preventDefault()
    }
  }

  // Handle wheel events to control ReactFlow zoom
  const handleWheel = (e: React.WheelEvent<HTMLTextAreaElement>) => {
    // Only handle zoom when Ctrl/Cmd key is pressed
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      e.stopPropagation()

      // Get current zoom level and viewport
      const currentZoom = reactFlowInstance.getZoom()
      const { x: viewportX, y: viewportY } = reactFlowInstance.getViewport()

      // Calculate zoom factor based on wheel delta
      const delta = e.deltaY > 0 ? 1 : -1
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
    // No overlay scroll; overlay position is synced via transform on scroll handler
  }

  return (
    <>
      {/* Wand Prompt Bar - positioned above the textarea */}
      {wandHook && (
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

      <div
        ref={containerRef}
        className={cn('group relative w-full', wandHook?.isStreaming && 'streaming-effect')}
        style={{ height: `${height}px` }}
      >
        <Textarea
          ref={textareaRef}
          className={cn(
            'allow-scroll min-h-full w-full resize-none text-transparent caret-foreground placeholder:text-muted-foreground/50',
            '!text-[14px]', // Force override any responsive text sizes from Textarea component
            isConnecting &&
              config?.connectionDroppable !== false &&
              'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500',
            wandHook?.isStreaming && 'pointer-events-none cursor-not-allowed opacity-50'
          )}
          rows={rows ?? DEFAULT_ROWS}
          placeholder={placeholder ?? ''}
          value={value?.toString() ?? ''}
          onChange={handleChange}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onScroll={handleScroll}
          onWheel={handleWheel}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            try {
              useOperationQueueStore.getState().flushDebouncedForBlock(blockId)
            } catch {}
          }}
          onFocus={() => {
            setShowEnvVars(false)
            setShowTags(false)
            setSearchTerm('')
          }}
          disabled={isPreview || disabled}
          style={{
            // Explicit font properties for perfect alignment
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontSize: '14px',
            fontWeight: '400',
            // Match the fixed pixel line-height used on the textarea
            lineHeight: '21px',
            letterSpacing: 'normal',
            height: `${height}px`,
            // Text wrapping properties
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            // Box sizing to ensure padding is calculated correctly
            boxSizing: 'border-box',
            // Remove text rendering optimizations that can affect layout
            textRendering: 'auto',
          }}
        />
        <div
          ref={overlayRef}
          className='pointer-events-none absolute bg-transparent'
          style={{
            // Position exactly over the textarea content area
            top: '0',
            left: '0',
            // width is set dynamically to match textarea clientWidth to ensure identical wrapping
            // right is disabled to avoid conflicts with explicit width
            right: 'auto',
            // Padding: py-2 px-3 = top/bottom: 8px, left/right: 12px
            paddingTop: '8px',
            paddingBottom: '8px',
            paddingLeft: '12px',
            paddingRight: '12px',
            // No border; border would shrink content width under border-box and break wrapping parity
            // Exact same font properties as textarea
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            fontSize: '14px',
            fontWeight: '400',
            lineHeight: '21px', // Use fixed pixel line-height to prevent subpixel rounding drift with overlay
            letterSpacing: 'normal',
            // Text wrapping properties - must match textarea exactly
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            // Hide overlay scrolling to avoid dual scroll offsets
            overflow: 'hidden',
            // Box sizing to ensure padding is calculated correctly
            boxSizing: 'border-box',
            // Match text rendering
            textRendering: 'auto',
          }}
        >
          <div
            ref={overlayInnerRef}
            style={{
              willChange: 'transform',
              lineHeight: '21px',
            }}
          >
            {formatDisplayText(value?.toString() ?? '', true)}
          </div>
        </div>

        {/* Wand Button */}
        {wandHook && !isPreview && !wandHook.isStreaming && (
          <div className='absolute top-2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
            <Button
              variant='ghost'
              size='icon'
              onClick={
                wandHook.isPromptVisible ? wandHook.hidePromptInline : wandHook.showPromptInline
              }
              disabled={wandHook.isLoading || wandHook.isStreaming || disabled}
              aria-label='Generate content with AI'
              className='h-8 w-8 rounded-full border border-transparent bg-muted/80 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-primary hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </Button>
          </div>
        )}

        {/* Custom resize handle */}
        {!wandHook?.isStreaming && (
          <div
            className='absolute right-1 bottom-1 flex h-4 w-4 cursor-s-resize items-center justify-center rounded-sm bg-background'
            onMouseDown={startResize}
            onDragStart={(e) => {
              e.preventDefault()
            }}
          >
            <ChevronsUpDown className='h-3 w-3 text-muted-foreground/70' />
          </div>
        )}

        {!wandHook?.isStreaming && (
          <>
            <EnvVarDropdown
              visible={showEnvVars}
              onSelect={(newValue) => {
                if (onChange) {
                  onChange(newValue)
                } else if (!isPreview) {
                  emitTagSelection(newValue)
                }
              }}
              searchTerm={searchTerm}
              inputValue={value?.toString() ?? ''}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowEnvVars(false)
                setSearchTerm('')
              }}
            />
            <TagDropdown
              visible={showTags}
              onSelect={(newValue) => {
                if (onChange) {
                  onChange(newValue)
                } else if (!isPreview) {
                  emitTagSelection(newValue)
                }
              }}
              blockId={blockId}
              activeSourceBlockId={activeSourceBlockId}
              inputValue={value?.toString() ?? ''}
              cursorPosition={cursorPosition}
              onClose={() => {
                setShowTags(false)
                setActiveSourceBlockId(null)
              }}
            />
          </>
        )}
      </div>
    </>
  )
}
