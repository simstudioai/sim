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
  className = '',
  showInlineError = false,
  onValidityChange,
}: TypedTagInputProps) {
  const [inputValue, setInputValue] = useState(value || '')
  const [isValid, setIsValid] = useState(true)
  const [error, setError] = useState<string | undefined>()

  // Update internal state when value prop changes
  useEffect(() => {
    setInputValue(value || '')
  }, [value])

  // Clear validation errors when field type changes
  useEffect(() => {
    setIsValid(true)
    setError(undefined)
    // Re-validate the current value for the new field type if there is a value
    if (inputValue.trim()) {
      validateAndUpdate(inputValue)
    }
  }, [fieldType])

  const validateAndUpdate = (newValue: string) => {
    setInputValue(newValue)

    // Simple client-side validation
    let valid = true
    let errorMessage: string | undefined

    if (newValue.trim()) {
      switch (fieldType) {
        case 'number': {
          const num = Number(newValue.trim())
          if (Number.isNaN(num) || !Number.isFinite(num)) {
            valid = false
            errorMessage = 'Must be a valid number'
          }
          break
        }
        case 'date': {
          const date = new Date(newValue.trim())
          if (Number.isNaN(date.getTime())) {
            valid = false
            errorMessage = 'Must be a valid date'
          }
          break
        }
        case 'boolean': {
          const lower = newValue.trim().toLowerCase()
          if (!['true', 'false', '1', '0', 'yes', 'no'].includes(lower)) {
            valid = false
            errorMessage = 'Must be true, false, yes, no, 1, or 0'
          }
          break
        }
      }
    }

    setIsValid(valid)
    setError(errorMessage)
    if (onValidityChange) onValidityChange(valid)

    if (valid) {
      onChange(newValue)
    }
  }

  // Minimal UI: we don't show validation messages, only subtle border changes.

  // Render different input types based on field type
  switch (fieldType) {
    case 'boolean':
      return (
        <div className={className}>
          <Select
            value={inputValue || undefined}
            onValueChange={validateAndUpdate}
            disabled={disabled}
          >
            <SelectTrigger
              className={cn(
                'h-8 w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
                !isValid && 'border-red-300 focus:border-red-500 focus:ring-0'
              )}
            >
              <SelectValue placeholder='Select' />
            </SelectTrigger>
            <SelectContent className='rounded-lg border-[#E5E5E5] bg-[#FFFFFF] dark:border-[#414141] dark:bg-[var(--surface-elevated)]'>
              <SelectItem value='true'>True</SelectItem>
              <SelectItem value='false'>False</SelectItem>
            </SelectContent>
          </Select>
          {showInlineError && !isValid && error && (
            <p className='mt-1 text-red-600 text-xs'>{error}</p>
          )}
        </div>
      )

    case 'date':
      return (
        <div className={className}>
          <Input
            type='date'
            value={inputValue ? inputValue.split('T')[0] : ''}
            onChange={(e) => validateAndUpdate(e.target.value)}
            disabled={disabled}
            className={cn(
              'h-8 rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
              !isValid && 'border-red-300 focus:border-red-500 focus:ring-0'
            )}
          />
          {showInlineError && !isValid && error && (
            <p className='mt-1 text-red-600 text-xs'>{error}</p>
          )}
        </div>
      )

    case 'number':
      return (
        <div className={className}>
          <Input
            type='text'
            inputMode='numeric'
            value={inputValue}
            onChange={(e) => validateAndUpdate(e.target.value)}
            placeholder={placeholder || 'Number'}
            disabled={disabled}
            className={cn(
              'h-8 rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
              !isValid && 'border-red-300 focus:border-red-500 focus:ring-0'
            )}
          />
          {showInlineError && !isValid && error && (
            <p className='mt-1 text-red-600 text-xs'>{error}</p>
          )}
        </div>
      )

    default:
      // text, select, or unknown types use regular input
      return (
        <div className={className}>
          <Input
            type='text'
            value={inputValue}
            onChange={(e) => validateAndUpdate(e.target.value)}
            placeholder={placeholder || 'Value'}
            disabled={disabled}
            className={cn(
              'h-8 rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]',
              !isValid && 'border-red-300 focus:border-red-500 focus:ring-0'
            )}
          />
          {showInlineError && !isValid && error && (
            <p className='mt-1 text-red-600 text-xs'>{error}</p>
          )}
        </div>
      )
  }
}
