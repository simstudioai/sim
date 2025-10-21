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
      className='flex h-10 w-[460px] items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-sm backdrop-blur-xl transition-colors hover:border-border'
      style={{
        backgroundColor: 'hsla(0, 0%, 5%, 0.85)',
        backdropFilter: 'blur(33px) saturate(180%)',
        WebkitBackdropFilter: 'blur(33px) saturate(180%)',
        color: 'rgba(255, 255, 255, 0.6)',
      }}
      onClick={handleClick}
    >
      <Search className='h-4 w-4' />
      <span>Search...</span>
      <kbd
        className='ml-auto flex items-center gap-0.5 font-medium'
        style={{ color: 'rgba(255, 255, 255, 0.6)' }}
      >
        <span style={{ fontSize: '15px', lineHeight: '1' }}>⌘</span>
        <span style={{ fontSize: '13px', lineHeight: '1' }}>K</span>
      </kbd>
    </button>
  )
}
