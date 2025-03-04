import { useRef, useState } from 'react'
import { EnvVarDropdown, checkEnvVarTrigger } from '@/components/ui/env-var-dropdown'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { TagDropdown, checkTagTrigger } from '@/components/ui/tag-dropdown'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { SubBlockConfig } from '@/blocks/types'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

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
      console.error('Failed to parse drop data:', error)
    }
  }

  // Handle key combinations
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setShowEnvVars(false)
      setShowTags(false)
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
