'use client'

import { type KeyboardEvent, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
  disabled?: boolean
  className?: string
}

export function TagInput({
  value = [],
  onChange,
  placeholder = 'Type and press Enter',
  maxTags = 10,
  disabled = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = (tag: string) => {
    const trimmedTag = tag.trim()
    if (trimmedTag && !value.includes(trimmedTag) && value.length < maxTags) {
      onChange([...value, trimmedTag])
      setInputValue('')
    }
  }

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter((tag) => tag !== tagToRemove))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag when backspace is pressed with empty input
      removeTag(value[value.length - 1])
    }
  }

  const handleBlur = () => {
    // Add tag on blur if there's input
    if (inputValue.trim()) {
      addTag(inputValue)
    }
  }

  return (
    <div
      className={cn(
        'flex min-h-[2.5rem] flex-wrap gap-1.5 rounded-md border border-input bg-background p-2',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Badge
          key={tag}
          variant='secondary'
          className='h-7 gap-1.5 border-0 bg-muted/60 pr-1.5 pl-2.5 hover:bg-muted/80'
        >
          <span className='text-xs'>{tag}</span>
          {!disabled && (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              className='ml-auto rounded-full p-0.5 hover:bg-muted-foreground/20'
            >
              <X className='h-3 w-3' />
            </button>
          )}
        </Badge>
      ))}
      {!disabled && value.length < maxTags && (
        <Input
          ref={inputRef}
          type='text'
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className='h-7 min-w-[120px] flex-1 border-0 bg-transparent p-0 px-1 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0'
        />
      )}
    </div>
  )
}
