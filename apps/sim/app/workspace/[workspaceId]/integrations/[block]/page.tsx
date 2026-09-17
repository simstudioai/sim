import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PermissionAccessBoundary } from '@/components/access-requests/permission-access-boundary'
import { INTEGRATIONS } from '@/lib/integrations'
import { IntegrationBlockDetail } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail'
import { IntegrationBlockDetailFallback } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail-fallback'

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
    <PermissionAccessBoundary configKey='hideIntegrationsTab'>
      <Suspense fallback={<IntegrationBlockDetailFallback workspaceId={workspaceId} />}>
        <IntegrationBlockDetail integration={integration} workspaceId={workspaceId} />
      </Suspense>
    </PermissionAccessBoundary>
  )
}
