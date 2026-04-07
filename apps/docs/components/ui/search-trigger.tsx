'use client'

import { Search } from 'lucide-react'

export function SearchTrigger() {
  const handleClick = () => {
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
    })
    document.dispatchEvent(event)
  }

  return (
    <button
      type='button'
      data-search-trigger
      className='flex h-8 w-[360px] cursor-pointer items-center gap-2 rounded-lg border border-border/50 bg-fd-muted/50 px-3 text-[13px] text-fd-muted-foreground transition-colors hover:bg-fd-muted'
      onClick={handleClick}
    >
      <Search className='h-3.5 w-3.5' />
      <span>Search...</span>
      <kbd className='ml-auto flex items-center font-medium'>
        <span className='text-[15px]'>⌘</span>
        <span className='text-[12px]'>K</span>
      </kbd>
    </button>
  )
}
