import type { Metadata } from 'next'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'

export const metadata: Metadata = {
  title: 'Integrations',
}

export default function OrganizationIntegrationsPage() {
  return <OrganizationIntegrations />
}
