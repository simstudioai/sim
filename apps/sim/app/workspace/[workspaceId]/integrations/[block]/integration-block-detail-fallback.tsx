'use client'

import { ChipLink } from '@sim/emcn'
import { ArrowLeft } from 'lucide-react'

interface IntegrationBlockDetailFallbackProps {
  workspaceId: string
}

/**
 * Suspense fallback for the integration detail page — the back-link chrome
 * shown while {@link IntegrationBlockDetail} hydrates.
 *
 * This MUST be a client component. The lucide `ArrowLeft` passed as `ChipLink`'s
 * `leftIcon` is a function, and functions cannot cross the server→client
 * boundary as props. Rendering the fallback from the server `page.tsx` directly
 * threw a React Server Components error ("Functions cannot be passed directly to
 * Client Components") that surfaced as the integrations error boundary. Keeping
 * the icon inside a client component avoids the boundary crossing entirely.
 */
export function IntegrationBlockDetailFallback({
  workspaceId,
}: IntegrationBlockDetailFallbackProps) {
  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
          Integrations
        </ChipLink>
      </div>
    </div>
  )
}
