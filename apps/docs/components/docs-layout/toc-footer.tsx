import { ArrowRight, ChevronRight } from 'lucide-react'
import Link from 'next/link'

export function TOCFooter() {
  return (
    <div className='sticky bottom-0 mt-6'>
      <div className='flex flex-col gap-2.5 rounded-xl border border-neutral-200/60 bg-neutral-50 p-6 text-sm dark:border-neutral-700/30 dark:bg-neutral-800/40'>
        <div className='text-balance font-[520] text-[15px] leading-tight text-neutral-900 dark:text-neutral-100'>
          Start building today
        </div>
        <div className='text-[13px] text-neutral-500 dark:text-neutral-400'>
          Trusted by over 100,000 builders.
        </div>
        <div className='text-[13px] text-neutral-500 dark:text-neutral-400'>
          The open-source platform to build AI agents and run your agentic workforce.
        </div>
        <Link
          href='https://sim.ai/signup'
          target='_blank'
          rel='noopener noreferrer'
          className='group mt-2 inline-flex h-[32px] w-fit items-center rounded-[5px] bg-[#33c482] px-[10px] font-[430] font-season text-[14px] text-black transition-colors hover:border-[#E0E0E0] hover:bg-[#2DAC72] dark:bg-[#33c482] dark:text-black dark:hover:border-[#E0E0E0] dark:hover:bg-[#2DAC72]'
          aria-label='Get started with Sim - Sign up for free'
        >
          Get started
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
