import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Workflows' }

export default async function Page({ params }: ProductPageProps<{ workspaceId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { WorkflowsRoute }] = await Promise.all([
    params,
    import(
      '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflows-route/workflows-route'
    ),
  ])
  return <WorkflowsRoute workspaceId={workspaceId} />
}
