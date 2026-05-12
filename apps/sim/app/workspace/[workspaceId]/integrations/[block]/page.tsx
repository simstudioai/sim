import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import integrationsData from '@/app/(landing)/integrations/data/integrations.json'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationBlockDetail } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail'

const integrations = integrationsData as Integration[]

export async function generateMetadata({
  params,
}: {
  params: Promise<{ block: string }>
}): Promise<Metadata> {
  const { block } = await params
  const integration = integrations.find((i) => i.slug === block)
  return {
    title: integration ? `${integration.name} Integration` : 'Integration',
  }
}

export default async function IntegrationBlockPage({
  params,
}: {
  params: Promise<{ workspaceId: string; block: string }>
}) {
  const { workspaceId, block } = await params
  const integration = integrations.find((i) => i.slug === block)
  if (!integration) notFound()

  return <IntegrationBlockDetail integration={integration} workspaceId={workspaceId} />
}
