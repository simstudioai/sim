import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronsUpDown, Wand2 } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { CodePromptBar } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/code-prompt-bar/code-prompt-bar'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useCodeGeneration } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-code-generation'
import type { SubBlockConfig } from '@/blocks/types'

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
  // Extract wand configuration from config
  const wandConfig = config?.wandConfig
  // Local state for text content (similar to code.tsx pattern)
  const [localText, setLocalText] = useState<string>('')
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Calculate initial height based on rows prop with reasonable defaults
  const initialHeight = Math.max((rows || DEFAULT_ROWS) * ROW_HEIGHT_PX, MIN_HEIGHT_PX)
  const [height, setHeight] = useState(initialHeight)
  const isResizing = useRef(false)

  // Get ReactFlow instance for zoom control
  const reactFlowInstance = useReactFlow()

  // State management - useSubBlockValue without depending on aiGeneration initially
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId, false, {
    debounceMs: 150,
    isStreaming: false,
    onStreamingEnd: () => {
      logger.debug('AI streaming ended, value persisted', { blockId, subBlockId })
    },
  })

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Helper function for updating store value
  const updateStoreValue = useCallback((newValue: string) => {
    if (onChange) {
      onChange(newValue)
    } else if (!isPreview && !disabled) {
      // Defer store update to prevent setState during render
      Promise.resolve().then(() => {
        setStoreValue(newValue)
      })
    }
  }, [onChange, isPreview, disabled, setStoreValue])

  // Define stable handlers using useCallback
  const handleStreamStart = useCallback(() => {
    setLocalText('')
  }, [])

  const handleGeneratedContent = useCallback((generatedContent: string) => {
    setLocalText(generatedContent)
    updateStoreValue(generatedContent)
  }, [updateStoreValue])

  const handleStreamChunk = useCallback((chunk: string) => {
    setLocalText((currentText) => {
      const newText = currentText + chunk
      updateStoreValue(newText)
      return newText
    })
  }, [updateStoreValue])

  const aiGeneration = wandConfig?.enabled
    ? useCodeGeneration({
        generationType: wandConfig.generationType ?? 'system-prompt',
        initialContext: localText,
        onGeneratedContent: handleGeneratedContent,
        onStreamChunk: handleStreamChunk,
        onStreamStart: handleStreamStart,
      })
    : null

  // Common conditions
  const isAIBusy = aiGeneration?.isStreaming || aiGeneration?.isLoading
  const canEdit = !isPreview && !disabled && !isAIBusy
  const showWandButton = wandConfig?.enabled && canEdit
  const dropdownsVisible = !isAIBusy

  // Sync localText with store value when not streaming
  useEffect(() => {
    const valueString = value?.toString() ?? ''
    if (valueString !== localText && !isAIBusy) {
      setLocalText(valueString)
    }
  }, [value, isAIBusy])

  // Set initial height on first render
  useLayoutEffect(() => {
    setHeight(initialHeight)

    if (textareaRef.current && overlayRef.current) {
      textareaRef.current.style.height = `${initialHeight}px`
      overlayRef.current.style.height = `${initialHeight}px`
    }
  }, [initialHeight])

  // Simplified scroll sync - only when content size might change
  useEffect(() => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft
    }
  }, [localText])

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (disabled) return

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    // Update local text immediately for responsive UI
    setLocalText(newValue)
    updateStoreValue(newValue)
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
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

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
        if (!isPreview) {
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
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
    }
  }

  return (
    <>
      {/* AI Prompt Bar - rendered on top of the block */}
      {wandConfig?.enabled && (
        <CodePromptBar
          isVisible={aiGeneration?.isPromptVisible ?? false}
          isLoading={aiGeneration?.isLoading ?? false}
          isStreaming={aiGeneration?.isStreaming ?? false}
          promptValue={aiGeneration?.promptInputValue ?? ''}
          onSubmit={(prompt) => aiGeneration?.generateStream({ prompt, context: localText })}
          onCancel={() => {
            aiGeneration?.isStreaming 
              ? aiGeneration.cancelGeneration?.()
              : aiGeneration?.hidePromptInline?.()
          }}
          onChange={(value) => aiGeneration?.updatePromptValue?.(value)}
          placeholder={wandConfig?.placeholder ?? 'Describe the system prompt...'}
        />
      )}

      <div ref={containerRef} className='group relative w-full' style={{ height: `${height}px` }}>
        <div className={cn('relative h-full', aiGeneration?.isStreaming && 'streaming-effect')}>
          <Textarea
            ref={textareaRef}
            className={cn(
              'allow-scroll min-h-full w-full resize-none text-transparent caret-foreground placeholder:text-muted-foreground/50',
              isConnecting &&
                config?.connectionDroppable !== false &&
                'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500',
              isAIBusy && 'cursor-not-allowed opacity-50'
            )}
            rows={rows ?? DEFAULT_ROWS}
            placeholder={placeholder ?? ''}
            value={localText}
            onChange={handleChange}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onScroll={handleScroll}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setShowEnvVars(false)
              setShowTags(false)
              setSearchTerm('')
            }}
            disabled={!canEdit}
            style={{
              fontFamily: 'inherit',
              lineHeight: 'inherit',
              height: `${height}px`,
            }}
          />
          <div
            ref={overlayRef}
            className={cn(
              'pointer-events-none absolute inset-0 whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-sm',
              isAIBusy && 'cursor-not-allowed opacity-50'
            )}
            style={{
              fontFamily: 'inherit',
              lineHeight: 'inherit',
              width: textareaRef.current ? `${textareaRef.current.clientWidth}px` : '100%',
              height: `${height}px`,
              overflow: 'hidden',
            }}
          >
            {formatDisplayText(localText, true)}
          </div>
        </div>

        {/* Wand Button */}
        {showWandButton && (
          <div className='absolute top-2 right-3 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
            <button
              type='button'
              onClick={
                aiGeneration?.isPromptVisible
                  ? aiGeneration.hidePromptInline
                  : aiGeneration?.showPromptInline
              }
              disabled={isAIBusy}
              aria-label='Generate system prompt with AI'
              className='flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-muted/80 p-0 text-muted-foreground shadow-sm transition-all duration-200 hover:border-primary/20 hover:bg-muted hover:text-primary hover:shadow'
            >
              <Wand2 className='h-4 w-4' />
            </button>
          </div>
        )}

        {/* Custom resize handle */}
        <div
          className='absolute right-1 bottom-1 flex h-4 w-4 cursor-s-resize items-center justify-center rounded-sm bg-background'
          onMouseDown={startResize}
          onDragStart={(e) => {
            e.preventDefault()
          }}
        >
          <ChevronsUpDown className='h-3 w-3 text-muted-foreground/70' />
        </div>

        <EnvVarDropdown
          visible={showEnvVars && dropdownsVisible}
          onSelect={updateStoreValue}
          searchTerm={searchTerm}
          inputValue={localText}
          cursorPosition={cursorPosition}
          onClose={() => {
            setShowEnvVars(false)
            setSearchTerm('')
          }}
        />
        <TagDropdown
          visible={showTags && dropdownsVisible}
          onSelect={updateStoreValue}
          blockId={blockId}
          activeSourceBlockId={activeSourceBlockId}
          inputValue={localText}
          cursorPosition={cursorPosition}
          onClose={() => {
            setShowTags(false)
            setActiveSourceBlockId(null)
          }}
        />
      </div>
    </>
  )
}
