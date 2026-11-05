import { type ComponentProps, Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { IntegrationsRouteFallback } from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-member-inventory'

interface HydratedIntegrationsProps extends ComponentProps<typeof OrganizationIntegrations> {
  surface: OrganizationSurfaceContext
  principal: SessionPrincipal
}

export function HydratedIntegrations({ surface, principal, ...route }: HydratedIntegrationsProps) {
  return (
    <Suspense
      fallback={
        <IntegrationsHost>
          <IntegrationsRouteFallback detail={Boolean(route.section)} />
        </IntegrationsHost>
      }
    >
      <Hydrated state={prefetchIntegrations(surface, principal)}>
        <OrganizationIntegrations {...route} />
      </Hydrated>
    </Suspense>
  )
}
