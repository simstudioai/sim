import type { ReactNode } from 'react'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'

interface LinksSurfaceProps {
  children: ReactNode
}

/** Fills the app's content slot, and the grid stretches the surface so its canvas reaches the end. */
export function LinksSurface({ children }: LinksSurfaceProps) {
  return (
    <div className='grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] overflow-y-auto'>
      <RedesignSurface>{children}</RedesignSurface>
    </div>
  )
}
