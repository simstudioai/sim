'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  className?: string
  debounceMs?: number
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  className = 'max-w-md flex-1',
  debounceMs = 0,
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value)

  // Sync external value changes
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  // Debounced onChange
  useEffect(() => {
    if (debounceMs === 0) {
      onChange(localValue)
      return
    }

    const timeout = setTimeout(() => {
      onChange(localValue)
    }, debounceMs)

    return () => clearTimeout(timeout)
  }, [localValue, debounceMs, onChange])

  const handleChange = useCallback((newValue: string) => {
    setLocalValue(newValue)
  }, [])

  const handleClear = useCallback(() => {
    setLocalValue('')
  }, [])
  return (
    <div className={`relative ${className}`}>
      <div className='relative flex items-center'>
        <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
        <input
          type='text'
          value={localValue}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
        />
        {localValue && !disabled && (
          <button
            onClick={handleClear}
            className='-translate-y-1/2 absolute top-1/2 right-3 transform text-muted-foreground hover:text-foreground'
          >
            <X className='h-[18px] w-[18px]' />
          </button>
        )}
      </div>
    </div>
  )
}
