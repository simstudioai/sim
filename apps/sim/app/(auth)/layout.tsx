'use client'

import Image from 'next/image'
import Link from 'next/link'
import { GridPattern } from '../(landing)/components/grid-pattern'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className='relative flex min-h-screen flex-col bg-[#0C0C0C] font-geist-sans text-white'>
      {/* Background pattern */}
      <GridPattern
        x={-5}
        y={-5}
        className='absolute inset-0 z-0 stroke-[#ababab]/5'
        width={90}
        height={90}
        aria-hidden='true'
      />

      {/* Header */}
      <div className='relative z-10 px-6 pt-9'>
        <div className='mx-auto max-w-7xl'>
          <Link href='/' className='inline-flex'>
            <Image src='/sim.svg' alt='Sim Logo' width={42} height={42} />
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className='relative z-10 flex flex-1 items-center justify-center px-4 pb-6'>
        <div className='w-full max-w-md'>{children}</div>
      </div>
    </main>
  )
}
