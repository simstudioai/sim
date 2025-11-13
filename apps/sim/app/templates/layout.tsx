'use client'

import { Tooltip } from '@/components/emcn'
import { season } from '@/app/fonts/season/season'

export default function TemplatesLayout({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={600} skipDelayDuration={0}>
      <div className={`${season.variable} font-season`}>{children}</div>
    </Tooltip.Provider>
  )
}
