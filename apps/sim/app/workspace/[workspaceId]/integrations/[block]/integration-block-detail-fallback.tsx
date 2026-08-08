'use client'

import { ChipLink } from '@sim/emcn'
import { ArrowLeft } from '@sim/emcn/icons'
import { PAGE_HEADER_BAR } from '@/components/page-header-bar'

interface IntegrationBlockDetailFallbackProps {
  workspaceId: string
}

/**
 * Suspense fallback for the integration detail page — the back-link chrome
 * shown while {@link IntegrationBlockDetail} hydrates.
 *
 * This MUST be a client component. The `ArrowLeft` icon passed as `ChipLink`'s
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
      <div className={PAGE_HEADER_BAR}>
        <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
          Integrations
        </ChipLink>
      </div>
    </div>
  )
}
