'use client'

import { useCallback, useRef } from 'react'
import { Search } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'

export function SearchInput() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const currentQuery = searchParams.get('q') ?? ''

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const value = inputRef.current?.value.trim() ?? ''
      if (value) {
        router.push(`/blog?q=${encodeURIComponent(value)}`)
      } else {
        router.push('/blog')
      }
    },
    [router]
  )

  return (
    <form onSubmit={handleSubmit} className='relative'>
      <input
        ref={inputRef}
        type='text'
        defaultValue={currentQuery}
        placeholder='SEARCH POSTS...'
        className='w-full border border-[#2A2A2A] bg-[#232323] px-4 py-2 pr-9 font-season text-[11px] text-[#ECECEC] placeholder:text-[#666] transition-colors focus:border-[#00F701] focus:outline-none caret-[#00F701]'
        style={{ borderRadius: '5px', caretColor: '#00F701' }}
        aria-label='Search blog posts'
      />
      <button
        type='submit'
        className='absolute right-0 top-0 flex h-full items-center px-3 text-[#666] transition-colors hover:text-[#999]'
        aria-label='Search'
      >
        <Search className='h-3.5 w-3.5' aria-hidden='true' />
      </button>
    </form>
  )
}
