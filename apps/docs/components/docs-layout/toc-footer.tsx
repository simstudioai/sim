import Link from 'next/link'

export function TOCFooter() {
  return (
    <div className='sticky bottom-0 mt-6'>
      <div className='flex flex-col gap-2.5 rounded-xl border border-neutral-200/60 bg-neutral-50 p-6 text-sm dark:border-neutral-700/30 dark:bg-neutral-800/40'>
        <div className='text-balance font-[520] text-[15px] text-neutral-900 leading-tight dark:text-neutral-100'>
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
          className='mt-2 inline-flex h-[30px] w-fit items-center rounded-[5px] bg-[#33C482] px-[10px] font-medium text-[#1b1b1b] text-[12px] transition-colors hover:bg-[#2DAC72]'
          aria-label='Get started with Sim - Sign up for free'
        >
          Get started
        </Link>
      </div>
    </div>
  )
}
