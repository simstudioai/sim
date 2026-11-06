import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { OrganizationSurfaceGate } from '@/lib/organizations/surface'
import {
  IntegrationsRoute,
  IntegrationsRouteFallback,
  type IntegrationsRouteProps,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { Hydrated } from '@/platform/design-system/components/surface/hydrated'
import { PageSurface } from '@/platform/design-system/components/surface/surface'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-member-inventory'

interface HydratedIntegrationsProps extends Omit<IntegrationsRouteProps, 'organizationId'> {
  surface: OrganizationSurfaceGate
  principal: SessionPrincipal
}

export function HydratedIntegrations({ surface, principal, ...route }: HydratedIntegrationsProps) {
  return (
    <PageSurface>
      <Suspense fallback={<IntegrationsRouteFallback detail={Boolean(route.section)} />}>
        <Hydrated state={prefetchIntegrations(surface, principal)}>
          <IntegrationsRoute organizationId={surface.organization.id} {...route} />
        </Hydrated>
      </Suspense>
    </PageSurface>
  )
}
