'use client'

import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { IndexedOrganizationIntegrationsSettings } from '@/app/o/[organizationId]/settings/components/integrations/indexed'
import { LiveSearchSettings } from '@/app/o/[organizationId]/settings/components/integrations/live-search-settings'

export function OrganizationIntegrationsSettings() {
  const { features } = useDeploymentShape()
  return features.liveEnterpriseSearch ? (
    <LiveSearchSettings />
  ) : (
    <IndexedOrganizationIntegrationsSettings />
  )
}
