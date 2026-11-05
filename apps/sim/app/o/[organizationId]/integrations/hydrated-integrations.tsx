import { type ComponentProps, Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import { HydrationBoundary } from '@tanstack/react-query'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { IntegrationsPageFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-page'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch'

interface HydratedIntegrationsProps extends ComponentProps<typeof OrganizationIntegrations> {
  surface: OrganizationSurfaceContext
  principal: SessionPrincipal
}

async function PrefetchedIntegrations({ surface, principal, ...route }: HydratedIntegrationsProps) {
  return (
    <HydrationBoundary state={await prefetchIntegrations(surface, principal)}>
      <OrganizationIntegrations {...route} />
    </HydrationBoundary>
  )
}

/** The route, painted from the server's reads. The fallback holds only this boundary. */
export function HydratedIntegrations(props: HydratedIntegrationsProps) {
  return (
    <Suspense
      fallback={
        <IntegrationsHost>
          <IntegrationsPageFallback detail={Boolean(props.section)} />
        </IntegrationsHost>
      }
    >
      <PrefetchedIntegrations {...props} />
    </Suspense>
  )
}
