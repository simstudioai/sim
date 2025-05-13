'use client'

import { KeyboardEvent, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SearchBarProps {
  initialValue?: string
  onSearch: (value: string) => void
  disabled?: boolean
  placeholder?: string
  debounceTime?: number
  searchOnBlur?: boolean
  searchOnEnter?: boolean
}

export function SearchBar({
  initialValue = '',
  onSearch,
  disabled = false,
  placeholder = 'Search...',
  debounceTime = 500,
  searchOnBlur = true,
  searchOnEnter = true,
}: SearchBarProps) {
  const [value, setValue] = useState(initialValue)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setValue(newValue)

    // If debounce is enabled, clear existing timeout and set a new one
    if (debounceTime > 0) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        onSearch(newValue)
      }, debounceTime)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (searchOnEnter && e.key === 'Enter') {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      onSearch(value)
    }
  }

  const handleBlur = () => {
    if (searchOnBlur) {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      onSearch(value)
    }
  }

  return (
    <div className="relative flex-1 sm:max-w-xs">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        type="search"
        placeholder={placeholder}
        className="pl-8 h-9 text-sm"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        disabled={disabled}
      />
    </div>
  )
}
