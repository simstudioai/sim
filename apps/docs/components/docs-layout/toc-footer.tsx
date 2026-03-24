'use client'

import { ArrowRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export function TOCFooter() {
  return (
    <div className='sticky bottom-0 mt-6'>
      <div className='flex flex-col gap-2 rounded-lg border border-border bg-secondary p-6 text-sm'>
        <div className='text-balance font-semibold text-base leading-tight'>
          Start building today
        </div>
        <div className='text-muted-foreground'>Trusted by over 100,000 builders.</div>
        <div className='text-muted-foreground'>
          The open-source platform to build AI agents and run your agentic workforce.
        </div>
        <Link
          href='https://sim.ai/signup'
          target='_blank'
          rel='noopener noreferrer'
          className='group mt-2 inline-flex h-8 w-fit items-center justify-center gap-2 whitespace-nowrap rounded-[5px] border border-[#33C482] bg-[#33C482] px-[10px] font-medium text-black text-sm outline-none transition-[filter] hover:brightness-110 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'
          aria-label='Get started with Sim - Sign up for free'
        >
          <span>Get started</span>
          <span className='relative inline-flex h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5'>
            <ChevronRight
              className='absolute inset-0 h-4 w-4 transition-opacity duration-200 group-hover:opacity-0'
              aria-hidden='true'
            />
            <ArrowRight
              className='absolute inset-0 h-4 w-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100'
              aria-hidden='true'
            />
          </span>
        </Link>
      </div>
    </div>
  )
}
