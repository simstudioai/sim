import { useEffect, useMemo, useRef, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'

const logger = createLogger('ShortInput')

interface ShortInputProps {
  placeholder?: string
  password?: boolean
  blockId: string
  subBlockId: string
  isConnecting: boolean
  config: SubBlockConfig
  value?: string
  onChange?: (value: string) => void
  isPreview?: boolean
  previewValue?: string | null
  disabled?: boolean
}

export function ShortInput({
  blockId,
  subBlockId,
  placeholder,
  password,
  isConnecting,
  config,
  onChange,
  value: propValue,
  isPreview = false,
  previewValue,
  disabled = false,
}: ShortInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [showTags, setShowTags] = useState(false)
  const validatePropValue = (value: any): string => {
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    try {
      return String(value)
    } catch {
      return ''
    }
  }
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [activeSourceBlockId, setActiveSourceBlockId] = useState<string | null>(null)

  const emitTagSelection = useTagSelection(blockId, subBlockId)

  // Get ReactFlow instance for zoom control
  const reactFlowInstance = useReactFlow()

  // Use preview value when in preview mode, otherwise use store value or prop value
  const value = isPreview ? previewValue : propValue !== undefined ? propValue : storeValue

  // Check if this input is API key related
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

  // Handle input changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Don't allow changes if disabled
    if (disabled) {
      e.preventDefault()
      return
    }

    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0

    // Update cursor first to minimize state staleness for dropdown selection logic
    setCursorPosition(newCursorPosition)

    if (onChange) {
      onChange(newValue)
    } else if (!isPreview) {
      // Only update store when not in preview mode
      setStoreValue(newValue)
    }

    // Check for environment variables trigger
    const envVarTrigger = checkEnvVarTrigger(newValue, newCursorPosition)

    // For API key fields, always show dropdown when typing (without requiring {{ trigger)
    if (isApiKeyField && isFocused) {
      // Only show dropdown if there's text to filter by or the field is empty
      const shouldShowDropdown = newValue.trim() !== '' || newValue === ''
      setShowEnvVars(shouldShowDropdown)
      // Use the entire input value as search term for API key fields,
      // but if {{ is detected, use the standard search term extraction
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : newValue)
    } else {
      // Normal behavior for non-API key fields
      setShowEnvVars(envVarTrigger.show)
      setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
    }

    // Check for tag trigger
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  // Sync scroll position between input and overlay
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    if (overlayRef.current) {
      overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  // Remove the auto-scroll effect that forces cursor position and replace with natural scrolling
  useEffect(() => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }, [value])

  // Handle paste events to ensure long values are handled correctly
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    // Let the paste happen normally
    // Then ensure scroll positions are synced after the content is updated
    setTimeout(() => {
      if (inputRef.current && overlayRef.current) {
        overlayRef.current.scrollLeft = inputRef.current.scrollLeft
      }
    }, 0)
  }

  // Handle wheel events to control ReactFlow zoom
  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
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
  }

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    if (config?.connectionDroppable === false) return
    e.preventDefault()

    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      if (data.type !== 'connectionBlock') return

      // Get current cursor position or append to end
      const dropPosition = inputRef.current?.selectionStart ?? value?.toString().length ?? 0

      // Insert '<' at drop position to trigger the dropdown
      const currentValue = value?.toString() ?? ''
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      // Focus the input first
      inputRef.current?.focus()

      // Update all state in a single batch
      Promise.resolve().then(() => {
        setStoreValue(newValue)
        setCursorPosition(dropPosition + 1)
        setShowTags(true)

        // Pass the source block ID from the dropped connection
        if (data.connectionData?.sourceBlockId) {
          setActiveSourceBlockId(data.connectionData.sourceBlockId)
        }

        // Set cursor position after state updates
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.selectionStart = dropPosition + 1
            inputRef.current.selectionEnd = dropPosition + 1
          }
        }, 0)
      })
    } catch (error) {
      logger.error('Failed to parse drop data:', { error })
    }
  }

  // Handle key combinations
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      setShowTags(false)
      return
    }

    // For API key fields, show env vars when clearing with keyboard shortcuts
    if (
      isApiKeyField &&
      (e.key === 'Delete' || e.key === 'Backspace') &&
      inputRef.current?.selectionStart === 0 &&
      inputRef.current?.selectionEnd === value?.toString().length
    ) {
      setTimeout(() => setShowEnvVars(true), 0)
    }
  }

  // Value display logic
  const displayValue =
    password && !isFocused ? '•'.repeat(value?.toString().length ?? 0) : (value?.toString() ?? '')

  // Explicitly mark environment variable references with '{{' and '}}' when inserting
  const handleEnvVarSelect = (newValue: string) => {
    // For API keys, ensure we're using the full value with {{ }} format
    if (isApiKeyField && !newValue.startsWith('{{')) {
      newValue = `{{${newValue}}}`
    }

    if (onChange) {
      onChange(newValue)
    } else if (!isPreview) {
      emitTagSelection(newValue)
    }
  }

  return (
    <div className='relative w-full'>
      <Input
        ref={inputRef}
        className={cn(
          'allow-scroll w-full overflow-auto text-transparent caret-foreground placeholder:text-muted-foreground/50',
          isConnecting &&
            config?.connectionDroppable !== false &&
            'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
        )}
        placeholder={placeholder ?? ''}
        type='text'
        value={displayValue}
        onChange={handleChange}
        onFocus={() => {
          setIsFocused(true)

          // If this is an API key field, automatically show env vars dropdown
          if (isApiKeyField) {
            setShowEnvVars(true)
            setSearchTerm('')

            // Set cursor position to the end of the input
            const inputLength = value?.toString().length ?? 0
            setCursorPosition(inputLength)
          } else {
            setShowEnvVars(false)
            setShowTags(false)
            setSearchTerm('')
          }
        }}
        onBlur={() => {
          setIsFocused(false)
          setShowEnvVars(false)
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onScroll={handleScroll}
        onPaste={handlePaste}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        autoComplete='off'
        style={{ overflowX: 'auto' }}
        disabled={disabled}
      />
      <div
        ref={overlayRef}
        className='pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-3 text-sm'
        style={{ overflowX: 'auto' }}
      >
        <div
          className='w-full whitespace-pre'
          style={{ scrollbarWidth: 'none', minWidth: 'fit-content' }}
        >
          {password && !isFocused
            ? '•'.repeat(value?.toString().length ?? 0)
            : formatDisplayText(value?.toString() ?? '', true)}
        </div>
      </div>

      <EnvVarDropdown
        visible={showEnvVars}
        onSelect={handleEnvVarSelect}
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
        onSelect={handleEnvVarSelect}
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
