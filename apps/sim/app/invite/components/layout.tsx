'use client'

import Image from 'next/image'
import { useBrandConfig } from '@/lib/branding/branding'
import { GridPattern } from '@/app/(landing)/components/grid-pattern'

interface InviteLayoutProps {
  children: React.ReactNode
}

export function InviteLayout({ children }: InviteLayoutProps) {
  const brandConfig = useBrandConfig()

  return (
    <main className='dark relative flex min-h-screen flex-col bg-[var(--brand-background-hex)] font-geist-sans text-white'>
      {/* Background pattern */}
      <GridPattern
        x={-5}
        y={-5}
        className='absolute inset-0 z-0 stroke-[#ababab]/5'
        width={90}
        height={90}
        aria-hidden='true'
      />

      {/* Content */}
      <div className='relative z-10 flex flex-1 items-center justify-center px-4 pb-6'>
        <div className='w-full max-w-md'>
          <div className='mb-8 text-center'>
            <Image
              src={brandConfig.logoUrl || '/logo/primary/text/medium.png'}
              alt='Sim Logo'
              width={140}
              height={42}
              priority
              className='mx-auto'
            />
          </div>
          <div className='rounded-xl border border-neutral-700/40 bg-neutral-800/50 p-6 backdrop-blur-sm'>
            {children}
          </div>

          <div className='mt-6 text-center text-neutral-500/80 text-xs leading-relaxed'>
            Need help?{' '}
            <a
              href={`mailto:${brandConfig.supportEmail}`}
              className='text-[var(--brand-accent-hex)] underline-offset-4 transition hover:text-[var(--brand-accent-hover-hex)] hover:underline'
            >
              Contact support
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}
