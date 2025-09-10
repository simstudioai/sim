'use client'

import { isHosted } from '@/lib/environment'
import { GridPattern } from '@/app/(landing-2)/components/grid-pattern'
import Footer from '@/app/(landing)/components/footer/footer'
import Nav from '@/app/(landing)/components/nav/nav'
import { soehne } from '@/app/fonts/soehne/soehne'

interface LegalLayoutProps {
  title: string
  children: React.ReactNode
}

export default function LegalLayout({ title, children }: LegalLayoutProps) {
  return (
    <main
      className={`${soehne.className} relative min-h-screen bg-[var(--brand-background-hex)] text-gray-900`}
    >
      {/* Background pattern */}
      <GridPattern
        x={-5}
        y={-5}
        className='absolute inset-0 z-0 stroke-gray-200/50'
        width={90}
        height={90}
        aria-hidden='true'
      />

      {/* Header - Nav handles all conditional logic */}
      <div className='relative z-10'>
        <Nav variant='legal' />
      </div>

      {/* Content */}
      <div className='relative z-10 flex justify-center'>
        <div className='w-full max-w-4xl px-4 py-16'>
          <div className='rounded-xl border border-gray-200 bg-white/90 px-8 py-12 shadow-gray-100/50 shadow-lg backdrop-blur-sm'>
            <h1 className='mb-8 text-center font-bold text-4xl text-gray-900'>{title}</h1>
            <div className='prose prose-gray max-w-none space-y-8 text-gray-700'>{children}</div>
          </div>
        </div>
      </div>

      {/* Footer - Only for hosted instances */}
      {isHosted && (
        <div className='relative z-20'>
          <Footer fullWidth={true} />
        </div>
      )}
    </main>
  )
}
