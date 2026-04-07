'use client'

import Link from 'next/link'

export function BackLink() {
  return (
    <Link
      href='/blog'
      className='group/link inline-flex items-center gap-1.5 font-season text-[var(--landing-text-muted)] text-sm tracking-[0.02em] hover:text-[var(--landing-text)]'
    >
      <svg
        className='h-3 w-3 shrink-0'
        viewBox='0 0 10 10'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
      >
        <line
          x1='1'
          y1='5'
          x2='10'
          y2='5'
          stroke='currentColor'
          strokeWidth='1.33'
          strokeLinecap='square'
          className='origin-right scale-x-0 transition-transform duration-200 ease-out [transform-box:fill-box] group-hover/link:scale-x-100'
        />
        <path
          d='M6.5 2L3.5 5L6.5 8'
          stroke='currentColor'
          strokeWidth='1.33'
          strokeLinecap='square'
          strokeLinejoin='miter'
          fill='none'
          className='group-hover/link:-translate-x-[30%] transition-transform duration-200 ease-out'
        />
      </svg>
      Back to Blog
    </Link>
  )
}
