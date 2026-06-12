'use client'

import { Search } from 'lucide-react'

export function SearchTrigger() {
  const openSearchDialog = () => {
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
      className='flex h-[30px] w-[360px] cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] px-2 font-season text-[var(--text-muted)] text-sm transition-colors hover:bg-[var(--surface-active)] dark:bg-[var(--surface-4)]'
      onClick={openSearchDialog}
    >
      <Search className='size-[14px] text-[var(--text-icon)]' />
      <span>Search&hellip;</span>
      <kbd className='ml-auto flex items-center'>
        <span className='text-[15px]'>⌘</span>
        <span className='text-[12px]'>K</span>
      </kbd>
    </button>
  )
}
