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
      className='flex h-9 w-[400px] cursor-pointer items-center gap-2.5 rounded-lg border border-neutral-200/60 bg-neutral-100/50 px-3 text-[13px] text-neutral-400 transition-colors hover:border-neutral-300 hover:text-neutral-500 dark:border-neutral-700/50 dark:bg-neutral-800/40 dark:text-neutral-500 dark:hover:border-neutral-600 dark:hover:text-neutral-400'
      onClick={handleClick}
    >
      <Search className='h-3.5 w-3.5 flex-shrink-0' />
      <span>Search documentation...</span>
      <kbd className='ml-auto flex items-center gap-0.5 font-medium text-neutral-400 dark:text-neutral-500'>
        <span className='text-[14px]'>&#x2318;</span>
        <span className='text-[11px]'>K</span>
      </kbd>
    </button>
  )
}
