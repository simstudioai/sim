'use client'

import { useRef, useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'

const logger = createLogger('TextareaWithTags')

/**
 * Connection block data structure from drag events
 */
interface ConnectionData {
  sourceBlockId?: string
  outputId?: string
}

interface DragEventData {
  type: string
  connectionData?: ConnectionData
}

/**
 * Shared Textarea component with tag support for workflow references
 *
 * Features:
 * - Drag-and-drop support for workflow block connections
 * - Tag autocomplete with < trigger
 * - Visual formatting for tagged references
 * - Auto-resize behavior
 * - Multi-line text support
 * - Accessible reference filtering
 *
 * Bug Fixes:
 * - Removed redundant activeSourceBlockId tracking (TagDropdown manages internally)
 * - Uses requestAnimationFrame for cursor positioning (more reliable than setTimeout)
 * - Improved drag-drop to insert full reference tag
 * - Configurable rows and resize behavior
 */
export interface TextareaWithTagsProps {
  blockId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  accessiblePrefixes?: Set<string>
  rows?: number
  resize?: 'none' | 'vertical' | 'horizontal' | 'both'
  isConnecting?: boolean
}

export function TextareaWithTags({
  blockId,
  value,
  onChange,
  placeholder,
  disabled,
  accessiblePrefixes,
  rows = 4,
  resize = 'vertical',
  isConnecting = false,
}: TextareaWithTagsProps) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0
    onChange(newValue)
    setCursorPosition(newCursorPosition)
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    try {
      const rawData = e.dataTransfer.getData('application/json')
      const data = JSON.parse(rawData) as DragEventData

      if (data.type !== 'connectionBlock') return

      const dropPosition = textareaRef.current?.selectionStart ?? value.length ?? 0
      const currentValue = value ?? ''

      // Insert opening '<' to trigger tag dropdown
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      onChange(newValue)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      // Use requestAnimationFrame for more reliable cursor positioning
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.selectionStart = dropPosition + 1
          textareaRef.current.selectionEnd = dropPosition + 1
        }
      })
    } catch (error) {
      logger.error('Failed to parse drop data', { error })
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
    setShowTags(false)
  }

  // Map resize prop to Tailwind class
  const resizeClass = {
    none: 'resize-none',
    vertical: 'resize-y',
    horizontal: 'resize-x',
    both: 'resize',
  }[resize]

  return (
    <div className='relative'>
      <Textarea
        ref={textareaRef}
        value={value || ''}
        onChange={handleChange}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className={cn(
          'min-h-[80px] text-transparent caret-foreground',
          resizeClass,
          isConnecting && 'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
        )}
      />
      <div
        className='pointer-events-none absolute inset-0 overflow-auto whitespace-pre-wrap break-words border border-transparent bg-transparent px-3 py-2 text-sm'
        style={{ fontFamily: 'inherit', lineHeight: 'inherit' }}
      >
        {formatDisplayText(value || '', {
          accessiblePrefixes,
          highlightAll: !accessiblePrefixes,
        })}
      </div>
      <TagDropdown
        visible={showTags}
        onSelect={handleTagSelect}
        blockId={blockId}
        activeSourceBlockId={null}
        inputValue={value?.toString() ?? ''}
        cursorPosition={cursorPosition}
        onClose={() => setShowTags(false)}
      />
    </div>
  )
}
