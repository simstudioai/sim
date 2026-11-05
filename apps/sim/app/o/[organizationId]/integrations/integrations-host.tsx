import type { ReactNode } from 'react'
import { RedesignHost } from '@/app/o/[organizationId]/_redesign/redesign-host'

interface IntegrationsHostProps {
  children: ReactNode
}

/** A scrolling page filled by the design system's surface. */
export function IntegrationsHost({ children }: IntegrationsHostProps) {
  return (
    <div className='h-full overflow-y-auto [&>[data-platform-ui]]:min-h-full'>
      <RedesignHost>{children}</RedesignHost>
    </div>
  )
}
