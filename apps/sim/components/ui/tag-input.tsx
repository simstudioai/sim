'use client'

import { type KeyboardEvent, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/core/utils/cn'

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
      removeTag(value[value.length - 1])
    }
  }

  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue)
    }
  }

  return (
    <div
      className={cn(
        'scrollbar-hide flex max-h-32 min-h-9 flex-wrap items-center gap-x-[8px] gap-y-[4px] overflow-y-auto rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[6px] py-[4px] focus-within:outline-none dark:bg-[var(--surface-9)]',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
      onClick={() => !disabled && inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Tag key={tag} value={tag} onRemove={() => removeTag(tag)} disabled={disabled} />
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
          className={cn(
            'h-6 min-w-[180px] flex-1 border-none bg-transparent p-0 font-medium font-sans text-sm placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0',
            value.length > 0 ? 'pl-[4px]' : 'pl-[4px]'
          )}
        />
      )}
    </div>
  )
}

interface TagProps {
  value: string
  onRemove: () => void
  disabled?: boolean
}

function Tag({ value, onRemove, disabled }: TagProps) {
  return (
    <div className='flex w-auto items-center gap-[4px] rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-5)] px-[6px] py-[2px] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'>
      <span className='max-w-[200px] truncate'>{value}</span>
      {!disabled && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className='flex-shrink-0 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] focus:outline-none'
          aria-label={`Remove ${value}`}
        >
          <X className='h-[12px] w-[12px] translate-y-[0.2px]' />
        </button>
      )}
    </div>
  )
}
