'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FIELD_TYPE_METADATA, validateFieldValue } from '@/lib/knowledge/consts'
import { cn } from '@/lib/utils'

interface TypedTagInputProps {
  fieldType: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  showInlineError?: boolean
  onValidityChange?: (valid: boolean) => void
}

export function TypedTagInput({
  fieldType,
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  showInlineError = false,
  onValidityChange,
}: TypedTagInputProps) {
  const [error, setError] = useState<string>('')

  // Validate on value or fieldType change
  useEffect(() => {
    if (!value.trim()) {
      setError('')
      onValidityChange?.(true)
      return
    }

    const validation = validateFieldValue(fieldType, value)
    setError(validation.isValid ? '' : validation.error || '')
    onValidityChange?.(validation.isValid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fieldType])

  const metadata =
    FIELD_TYPE_METADATA[fieldType as keyof typeof FIELD_TYPE_METADATA] || FIELD_TYPE_METADATA.text

  // Boolean type uses Select
  if (fieldType === 'boolean') {
    return (
      <div className='space-y-1'>
        <Select value={value || 'true'} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className={cn('w-full', className)}>
            <SelectValue placeholder={placeholder || metadata.placeholder} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='true'>True</SelectItem>
            <SelectItem value='false'>False</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  // All other types use Input
  return (
    <div className='space-y-1'>
      <Input
        type={fieldType === 'number' ? 'text' : 'text'}
        inputMode={fieldType === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || metadata.placeholder}
        disabled={disabled}
        className={cn(error && showInlineError && 'border-red-500', className)}
      />
      {showInlineError && error && <p className='text-red-600 text-xs'>{error}</p>}
    </div>
  )
}
