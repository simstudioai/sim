'use client'

import { IntegrationsHost } from '@/app/o/[organizationId]/integrations/integrations-host'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  IntegrationsRoute,
  type IntegrationsRouteProps,
} from '@/platform/app/(shell)/integrations/_components/integrations-page/integrations-route'

export function OrganizationIntegrations(props: Omit<IntegrationsRouteProps, 'organizationId'>) {
  const { organization } = useOrganizationContext()
  return (
    <IntegrationsHost>
      <IntegrationsRoute organizationId={organization.id} {...props} />
    </IntegrationsHost>
  )
}
