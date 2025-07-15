import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import type { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

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
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

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

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Don't allow changes if disabled
    if (disabled) return

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

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
    if (overlayRef.current) {
      overlayRef.current.scrollTop = e.currentTarget.scrollTop
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

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
    <div ref={containerRef} className='relative w-full' style={{ height: `${height}px` }}>
      <Textarea
        ref={textareaRef}
        className={cn(
          'allow-scroll min-h-full w-full resize-none text-transparent caret-foreground placeholder:text-muted-foreground/50',
          isConnecting &&
            config?.connectionDroppable !== false &&
            'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
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
        onFocus={() => {
          setShowEnvVars(false)
          setShowTags(false)
          setSearchTerm('')
        }}
        disabled={isPreview || disabled}
        style={{
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          height: `${height}px`,
        }}
      />
      <div
        ref={overlayRef}
        className='pointer-events-none absolute inset-0 whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-sm'
        style={{
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          width: textareaRef.current ? `${textareaRef.current.clientWidth}px` : '100%',
          height: `${height}px`,
          overflow: 'hidden',
        }}
      >
        {formatDisplayText(value?.toString() ?? '', true)}
      </div>

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
        visible={showEnvVars}
        onSelect={(newValue) => {
          if (onChange) {
            onChange(newValue)
          } else if (!isPreview) {
            setStoreValue(newValue)
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
            setStoreValue(newValue)
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
    </div>
  )
}
