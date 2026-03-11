'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/core/utils/cn'

interface InlineRenameInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  className?: string
}

export function InlineRenameInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  className,
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.focus()
      el.select()
    }
  }, [])

  return (
    <input
      ref={inputRef}
      type='text'
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={onSubmit}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'min-w-0 flex-1 truncate border-0 bg-transparent p-0 font-medium text-[14px] text-[var(--text-body)] outline-none focus:outline-none focus:ring-0',
        className
      )}
    />
  )
}
