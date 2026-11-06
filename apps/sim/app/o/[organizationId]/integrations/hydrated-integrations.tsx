import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { RedesignPageSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import {
  IntegrationsRoute,
  IntegrationsRouteFallback,
  type IntegrationsRouteProps,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'
import { prefetchIntegrations } from '@/platform/lib/data/prefetch-member-inventory'

interface HydratedIntegrationsProps extends Omit<IntegrationsRouteProps, 'organizationId'> {
  surface: OrganizationSurfaceContext
  principal: SessionPrincipal
}

export function HydratedIntegrations({ surface, principal, ...route }: HydratedIntegrationsProps) {
  return (
    <RedesignPageSurface>
      <Suspense fallback={<IntegrationsRouteFallback detail={Boolean(route.section)} />}>
        <Hydrated state={prefetchIntegrations(surface, principal)}>
          <IntegrationsRoute organizationId={surface.organization.id} {...route} />
        </Hydrated>
      </Suspense>
    </RedesignPageSurface>
  )
}
