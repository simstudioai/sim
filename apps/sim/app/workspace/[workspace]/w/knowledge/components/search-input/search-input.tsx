'use client'

import { Search, X } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
  className?: string
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  className = 'max-w-md flex-1',
}: SearchInputProps) {
  return (
    <div className={`relative ${className}`}>
      <div className='relative flex items-center'>
        <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
        <input
          type='text'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
        />
        {value && !disabled && (
          <button
            onClick={() => onChange('')}
            className='-translate-y-1/2 absolute top-1/2 right-3 transform text-muted-foreground hover:text-foreground'
          >
            <X className='h-[18px] w-[18px]' />
          </button>
        )}
      </div>
    </div>
  )
}
