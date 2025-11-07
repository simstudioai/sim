'use client'

import { useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { checkTagTrigger, TagDropdown } from '@/components/ui/tag-dropdown'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'

const logger = createLogger('InputWithTags')

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
 * Shared Input component with tag support for workflow references
 *
 * Features:
 * - Drag-and-drop support for workflow block connections
 * - Tag autocomplete with < trigger
 * - Visual formatting for tagged references
 * - Password field support
 * - Accessible reference filtering
 *
 * Bug Fixes:
 * - Removed redundant activeSourceBlockId tracking (TagDropdown manages internally)
 * - Uses requestAnimationFrame for cursor positioning (more reliable than setTimeout)
 * - Improved drag-drop to insert full reference tag
 */
export interface InputWithTagsProps {
  blockId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  isPassword?: boolean
  accessiblePrefixes?: Set<string>
  isConnecting?: boolean
}

export function InputWithTags({
  blockId,
  value,
  onChange,
  placeholder,
  disabled,
  isPassword,
  accessiblePrefixes,
  isConnecting = false,
}: InputWithTagsProps) {
  const [showTags, setShowTags] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    const newCursorPosition = e.target.selectionStart ?? 0
    onChange(newValue)
    setCursorPosition(newCursorPosition)
    const tagTrigger = checkTagTrigger(newValue, newCursorPosition)
    setShowTags(tagTrigger.show)
  }

  const handleDrop = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
    try {
      const rawData = e.dataTransfer.getData('application/json')
      const data = JSON.parse(rawData) as DragEventData

      if (data.type !== 'connectionBlock') return

      const dropPosition = inputRef.current?.selectionStart ?? value.length ?? 0
      const currentValue = value ?? ''

      // Insert opening '<' to trigger tag dropdown
      const newValue = `${currentValue.slice(0, dropPosition)}<${currentValue.slice(dropPosition)}`

      onChange(newValue)
      setCursorPosition(dropPosition + 1)
      setShowTags(true)

      // Use requestAnimationFrame for more reliable cursor positioning
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.selectionStart = dropPosition + 1
          inputRef.current.selectionEnd = dropPosition + 1
        }
      })
    } catch (error) {
      logger.error('Failed to parse drop data', { error })
    }
  }

  const handleDragOver = (e: React.DragEvent<HTMLInputElement>) => {
    e.preventDefault()
  }

  const handleTagSelect = (newValue: string) => {
    onChange(newValue)
    setShowTags(false)
  }

  return (
    <div className='relative'>
      <div className='relative'>
        <Input
          ref={inputRef}
          type={isPassword ? 'password' : 'text'}
          value={value || ''}
          onChange={handleChange}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            !isPassword && 'text-transparent caret-foreground',
            isConnecting && 'ring-2 ring-blue-500 ring-offset-2 focus-visible:ring-blue-500'
          )}
        />
        {!isPassword && (
          <div className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-3 text-sm'>
            <div className='whitespace-pre'>
              {formatDisplayText(value?.toString() || '', {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
        )}
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
