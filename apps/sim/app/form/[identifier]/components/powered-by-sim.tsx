'use client'

import Image from 'next/image'
import { inter } from '@/app/_styles/fonts/inter/inter'
import { useBrandConfig } from '@/ee/whitelabeling'

export function PoweredBySim() {
  const brandConfig = useBrandConfig()

  return (
    <div
      className={`${inter.className} auth-text-muted fixed right-0 bottom-0 left-0 z-50 pb-8 text-center font-[340] text-[13px] leading-relaxed`}
    >
      <a
        href='https://sim.ai'
        target='_blank'
        rel='noopener noreferrer'
        className='inline-flex items-center gap-1.5 transition hover:opacity-80'
      >
        <span>Powered by</span>
        <Image
          src='/logo/b&w/text/small.png'
          alt='Sim'
          width={30}
          height={15}
          className='h-[14px] w-auto'
        />
      </a>
    </div>
  )
}
