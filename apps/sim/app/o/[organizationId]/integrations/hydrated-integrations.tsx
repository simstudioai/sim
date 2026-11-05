import { Suspense } from 'react'
import type { SessionPrincipal } from '@sim/auth/principal'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { Hydrated } from '@/app/o/[organizationId]/_redesign/hydrated'
import { SearchConnectionRequest } from '@/app/o/[organizationId]/_redesign/integrations/search-connection-request'
import { SlackSearchActions } from '@/app/o/[organizationId]/_redesign/integrations/slack-search-actions'
import { prefetchIntegrations } from '@/app/o/[organizationId]/_redesign/prefetch-member-inventory'
import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import {
  IntegrationsRoute,
  IntegrationsRouteFallback,
  type IntegrationsRouteProps,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

interface HydratedIntegrationsProps
  extends Omit<IntegrationsRouteProps, 'organizationId' | 'connectionRequest' | 'handoff'> {
  surface: OrganizationSurfaceContext
  principal: SessionPrincipal
  connectionRequest?: { target: SearchConnectionTarget; userId: string }
  slackOnboarding?: { token: string; userId: string }
}

export function HydratedIntegrations({
  surface,
  principal,
  connectionRequest,
  slackOnboarding,
  ...route
}: HydratedIntegrationsProps) {
  const organizationId = surface.organization.id
  return (
    <IntegrationsHost>
      <Suspense fallback={<IntegrationsRouteFallback detail={Boolean(route.section)} />}>
        <Hydrated state={prefetchIntegrations(surface, principal)}>
          <IntegrationsRoute
            organizationId={organizationId}
            handoff={
              slackOnboarding && (
                <SlackSearchActions organizationId={organizationId} {...slackOnboarding} />
              )
            }
            connectionRequest={
              connectionRequest && (
                <SearchConnectionRequest
                  key={JSON.stringify([connectionRequest.userId, connectionRequest.target])}
                  organizationId={organizationId}
                  {...connectionRequest}
                />
              )
            }
            {...route}
          />
        </Hydrated>
      </Suspense>
    </IntegrationsHost>
  )
}
