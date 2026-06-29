import { Suspense } from 'react'
import { ChipLink } from '@sim/emcn'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { INTEGRATIONS } from '@/lib/integrations'
import { IntegrationBlockDetail } from '@/app/workspace/[workspaceId]/integrations/[block]/integration-block-detail'

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
    <Suspense
      fallback={
        <div className='flex h-full flex-col bg-[var(--bg)]'>
          <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
            <ChipLink href={`/workspace/${workspaceId}/integrations`} leftIcon={ArrowLeft}>
              Integrations
            </ChipLink>
          </div>
        </div>
      }
    >
      <IntegrationBlockDetail integration={integration} workspaceId={workspaceId} />
    </Suspense>
  )
}
