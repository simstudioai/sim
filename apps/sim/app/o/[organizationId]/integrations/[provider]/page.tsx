import type { Metadata } from 'next'
import { requireIntegrationsViewer } from '@/app/o/[organizationId]/integrations/access'
import { HydratedIntegrations } from '@/app/o/[organizationId]/integrations/hydrated-integrations'
import { integrationPath } from '@/platform/embedded/lib/integrations/model'

export const metadata: Metadata = {
  title: 'Integrations',
  referrer: 'no-referrer',
}

interface IntegrationProviderPageProps {
  params: Promise<{ organizationId: string; provider: string }>
}

export default async function IntegrationProviderPage({ params }: IntegrationProviderPageProps) {
  const { organizationId, provider } = await params
  const viewer = await requireIntegrationsViewer(
    organizationId,
    integrationPath(organizationId, provider)
  )
  return <HydratedIntegrations {...viewer} section={provider} />
}
