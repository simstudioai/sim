import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { INTEGRATIONS } from '@/lib/integrations'
import { IntegrationBlockDetail } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail'
import { IntegrationBlockFallback } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-fallback'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ block: string }>
}): Promise<Metadata> {
  const { block } = await params
  const integration = INTEGRATIONS.find((i) => i.slug === block)
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
  const integration = INTEGRATIONS.find((i) => i.slug === block)
  if (!integration) notFound()

  return (
    <Suspense fallback={<IntegrationBlockFallback workspaceId={workspaceId} />}>
      <IntegrationBlockDetail integration={integration} workspaceId={workspaceId} />
    </Suspense>
  )
}
