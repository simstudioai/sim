'use client'

import {
  chipContentIconClass,
  chipFilledFillTokens,
  chipGeometryClass,
  TRIGGER_BORDER_CLASS,
} from '@sim/emcn'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

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
      className={cn(
        chipGeometryClass,
        chipFilledFillTokens,
        TRIGGER_BORDER_CLASS,
        'flex w-[360px] cursor-pointer font-season text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-active)]'
      )}
      onClick={openSearchDialog}
    >
      <Search className={chipContentIconClass} />
      <span>Search&hellip;</span>
      <kbd className='ml-auto flex items-center'>
        <span className='text-[15px]'>⌘</span>
        <span className='text-[12px]'>K</span>
      </kbd>
    </button>
  )
}
