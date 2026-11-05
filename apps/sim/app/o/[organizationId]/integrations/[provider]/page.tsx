import type { Metadata } from 'next'
import { requireIntegrationsViewer } from '@/app/o/[organizationId]/integrations/access'
import { OrganizationIntegrations } from '@/app/o/[organizationId]/integrations/integrations'
import { integrationPath } from '@/platform/lib/integrations/model'

export const metadata: Metadata = {
  title: 'Integrations',
  referrer: 'no-referrer',
}

interface IntegrationProviderPageProps {
  params: Promise<{ organizationId: string; provider: string }>
}

export default async function IntegrationProviderPage({ params }: IntegrationProviderPageProps) {
  const { organizationId, provider } = await params
  await requireIntegrationsViewer(organizationId, integrationPath(organizationId, provider))
  return <OrganizationIntegrations section={provider} />
}
