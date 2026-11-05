import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'

interface PeopleSurfaceProps {
  children: ReactNode
}

/** Fills the app's content slot, so the chart can take the height the page's other rows leave. */
export function PeopleSurface({ children }: PeopleSurfaceProps) {
  return (
    <div className='flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto [&>[data-platform-ui]]:flex [&>[data-platform-ui]]:flex-1 [&>[data-platform-ui]]:flex-col'>
      <RedesignSurface>{children}</RedesignSurface>
    </div>
  )
}
