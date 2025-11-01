'use client'

import { useState } from 'react'
import { ArrowRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export function TOCFooter() {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div className='sticky bottom-0 mt-6'>
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-secondary p-6 text-sm'>
        <div className='text-balance font-semibold text-base leading-tight'>
          Start building today
        </div>
        <div className='text-muted-foreground'>Trusted by over 60,000 builders.</div>
        <div className='text-muted-foreground'>
          Build Agentic workflows visually on a drag-and-drop canvas or with natural language.
        </div>
        <Link
          href='https://sim.ai/signup'
          target='_blank'
          rel='noopener noreferrer'
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className='group mt-2 inline-flex h-8 w-fit items-center justify-center gap-1 whitespace-nowrap rounded-[10px] border border-[#6F3DFA] bg-gradient-to-b from-[#8357FF] to-[#6F3DFA] px-3 pr-[10px] pl-[12px] font-medium text-sm text-white shadow-[inset_0_2px_4px_0_#9B77FF] outline-none transition-all hover:shadow-lg focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
          aria-label='Get started with Sim - Sign up for free'
        >
          <span>Get started</span>
          <span className='inline-flex transition-transform duration-200 group-hover:translate-x-0.5'>
            {isHovered ? (
              <ArrowRight className='h-4 w-4' aria-hidden='true' />
            ) : (
              <ChevronRight className='h-4 w-4' aria-hidden='true' />
            )}
          </span>
        </Link>
      </div>
    </div>
  )
}
