'use client'

import { useState } from 'react'
import { ArrowLeft, ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export function BackLink() {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <Link
      href='/blog'
      className='group flex items-center gap-1 text-[#999] text-sm hover:text-[#ECECEC]'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className='group-hover:-translate-x-0.5 inline-flex transition-transform duration-200'>
        {isHovered ? (
          <ArrowLeft className='h-4 w-4' aria-hidden='true' />
        ) : (
          <ChevronLeft className='h-4 w-4' aria-hidden='true' />
        )}
      </span>
      Back to Blog
    </Link>
  )
}
