'use client'

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useDebounce } from '@/hooks/use-debounce'

interface ControlBarProps {
  setSearchQuery: (query: string) => void
}

/**
 * Control bar for marketplace page - includes search functionality
 */
export function ControlBar({ setSearchQuery }: ControlBarProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(localSearchQuery, 300)

  // Update parent component when debounced search query changes
  useEffect(() => {
    setSearchQuery(debouncedSearchQuery)
  }, [debouncedSearchQuery, setSearchQuery])

  return (
    <div className='flex h-16 w-full items-center justify-between border-b bg-background px-6 transition-all duration-300'>
      {/* Left Section - Search */}
      <div className='relative w-[400px]'>
        <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'>
          <Search className='h-4 w-4 text-muted-foreground' />
        </div>
        <Input
          type='search'
          placeholder='Search workflows...'
          className='h-9 pl-10'
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
        />
      </div>

      {/* Middle Section - Reserved for future use */}
      <div className='flex-1' />

      {/* Right Section - Reserved for future use */}
      <div className='flex items-center gap-3' />
    </div>
  )
}
