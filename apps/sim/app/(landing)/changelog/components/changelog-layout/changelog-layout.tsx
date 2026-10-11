import type { ReactNode } from 'react'
import { cn } from '@sim/emcn'
import {
  HOME_INSET,
  LANDING_CONTENT_WIDTH,
  LANDING_GUTTER,
  LANDING_HERO_TOP_PADDING,
} from '@/app/(landing)/components/landing-layout'

interface ChangelogLayoutProps {
  children: ReactNode
}

/** Matches the marketing page frame; updates inherit the shared navbar and footer. */
export function ChangelogLayout({ children }: ChangelogLayoutProps) {
  return (
    <main
      id='main-content'
      className={cn(LANDING_CONTENT_WIDTH, LANDING_GUTTER, LANDING_HERO_TOP_PADDING)}
    >
      <div className={cn('flex flex-col gap-16 max-sm:gap-12', HOME_INSET)}>{children}</div>
    </main>
  )
}
