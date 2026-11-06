import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { OrganizationSurfaceGate } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import {
  IntegrationsRoute,
  IntegrationsRouteFallback,
  type IntegrationsRouteProps,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-member-inventory'

interface HydratedIntegrationsProps extends Omit<IntegrationsRouteProps, 'organizationId'> {
  surface: OrganizationSurfaceGate
  principal: SessionPrincipal
}

export function HydratedIntegrations({ surface, principal, ...route }: HydratedIntegrationsProps) {
  return (
    <IntegrationsHost>
      <Suspense fallback={<IntegrationsRouteFallback detail={Boolean(route.section)} />}>
        <Hydrated state={prefetchIntegrations(surface, principal)}>
          <IntegrationsRoute organizationId={surface.organization.id} {...route} />
        </Hydrated>
      </Suspense>
    </IntegrationsHost>
  )
}
