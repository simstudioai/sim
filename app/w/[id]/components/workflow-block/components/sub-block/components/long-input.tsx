import { useRef, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { EnvVarDropdown, checkEnvVarTrigger } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { TagDropdown, checkTagTrigger } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('LongInput')

interface LongInputProps {
  placeholder?: string
  blockId: string
  subBlockId: string
  isConnecting: boolean
  config: SubBlockConfig
}

export function LongInput({
  placeholder,
  blockId,
  subBlockId,
  isConnecting,
  config,
}: LongInputProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  // Get ReactFlow instance for zoom control
  const reactFlowInstance = useReactFlow()

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0
    setValue(newValue)
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
      const newValue = currentValue.slice(0, dropPosition) + '<' + currentValue.slice(dropPosition)

      // Focus the textarea first
      textareaRef.current?.focus()

      // Update all state in a single batch
      Promise.resolve().then(() => {
        setValue(newValue)
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
      // Use a smaller factor for smoother zooming that matches ReactFlow's native behavior
      const delta = e.deltaY > 0 ? 1 : -1
      // Using 0.98 instead of 0.95 makes the zoom much slower and more gradual
      const zoomFactor = Math.pow(0.96, delta)

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
    <div className="relative w-full">
      <Textarea
        ref={textareaRef}
        className={cn(
          'w-full placeholder:text-muted-foreground/50 allow-scroll text-transparent caret-foreground break-words whitespace-pre-wrap box-border',
          isConnecting &&
            config?.connectionDroppable !== false &&
            'focus-visible:ring-blue-500 ring-2 ring-blue-500 ring-offset-2'
        )}
        rows={4}
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
      />
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none px-3 py-2 overflow-auto whitespace-pre-wrap break-words scrollbar-none text-sm bg-transparent box-border"
        style={{ width: 'calc(100% - 2px)' }}
      >
        {formatDisplayText(value?.toString() ?? '')}
      </div>
      <EnvVarDropdown
        visible={showEnvVars}
        onSelect={setValue}
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
        onSelect={setValue}
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
