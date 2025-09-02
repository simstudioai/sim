'use client'

import Image from 'next/image'
import { useBrandConfig } from '@/lib/branding/branding'

interface InviteLayoutProps {
  children: React.ReactNode
}

export function InviteLayout({ children }: InviteLayoutProps) {
  const brandConfig = useBrandConfig()

  return (
    <div className='flex min-h-screen flex-col items-center justify-center bg-white px-4 dark:bg-black'>
      <div className='mb-8'>
        <Image
          src={brandConfig.logoUrl || '/logo/b&w/medium.png'}
          alt='Sim Logo'
          width={120}
          height={67}
          className='dark:invert'
          priority
        />
      </div>

      {children}

      <footer className='mt-8 text-center text-gray-500 text-xs'>
        Need help?{' '}
        <a href='mailto:help@sim.ai' className='text-blue-400 hover:text-blue-300'>
          Contact support
        </a>
      </footer>
    </div>
  )
}
