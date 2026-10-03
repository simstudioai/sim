'use client'

import type { ReactNode } from 'react'
import { usePlatformIntro } from '@/app/(landing)/components/hero/components/hero-platform-intro/use-platform-intro'

interface HeroPlatformIntroProps {
  children: ReactNode
  onComplete: (reducedMotion: boolean) => void
}

/** Exposes the product immediately while starting the automatic exchange only on visibility. */
export function HeroPlatformIntro({ children, onComplete }: HeroPlatformIntroProps) {
  const { rootRef } = usePlatformIntro({ onComplete })

  return (
    <div ref={rootRef} className='absolute inset-0'>
      {children}
    </div>
  )
}
