import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { OrganizationSurfaceGate } from '@/lib/organizations/surface'
import { Hydrated } from '@/platform/design-system/components/surface/hydrated'
import { PageSurface } from '@/platform/design-system/components/surface/surface'
import {
  IntegrationsRoute,
  IntegrationsRouteFallback,
  type IntegrationsRouteProps,
} from '@/platform/embedded/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { prefetchIntegrations } from '@/platform/embedded/lib/data/prefetch-member-inventory'

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
