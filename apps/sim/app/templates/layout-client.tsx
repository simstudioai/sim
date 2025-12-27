'use client'

import { Tooltip } from '@/components/emcn'
import { season } from '@/app/_styles/fonts/season/season'

export default function TemplatesLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
      <div className={`${season.variable} relative flex min-h-screen flex-col font-season`}>
        <div className='-z-50 pointer-events-none fixed inset-0 bg-white' />
        {children}
      </div>
    </Tooltip.Provider>
  )
}
