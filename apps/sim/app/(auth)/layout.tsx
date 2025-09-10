'use client'

import { useEffect } from 'react'
import { GridPattern } from '@/app/(landing-2)/components/grid-pattern'
import Nav from '@/app/(landing)/components/nav/nav'

// Helper to detect if a color is dark
function isColorDark(hexColor: string): boolean {
  const hex = hexColor.replace('#', '')
  const r = Number.parseInt(hex.substr(0, 2), 16)
  const g = Number.parseInt(hex.substr(2, 2), 16)
  const b = Number.parseInt(hex.substr(4, 2), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance < 0.5
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Check if brand background is dark and add class accordingly
    const rootStyle = getComputedStyle(document.documentElement)
    const brandBackground = rootStyle.getPropertyValue('--brand-background-hex').trim()

    if (brandBackground && isColorDark(brandBackground)) {
      document.body.classList.add('auth-dark-bg')
    } else {
      document.body.classList.remove('auth-dark-bg')
    }
  }, [])
  return (
    <main className='relative flex min-h-screen flex-col bg-brand-background font-geist-sans text-foreground'>
      {/* Background pattern */}
      <GridPattern
        x={-5}
        y={-5}
        className='auth-grid absolute inset-0 z-0'
        width={90}
        height={90}
        aria-hidden='true'
      />

      {/* Header - Nav handles all conditional logic */}
      <div className='relative z-10'>
        <Nav hideAuthButtons={true} variant='auth' />
      </div>

      {/* Content */}
      <div className='relative z-10 flex flex-1 items-center justify-center px-4 pb-6'>
        <div className='w-full max-w-lg'>{children}</div>
      </div>
    </main>
  )
}
