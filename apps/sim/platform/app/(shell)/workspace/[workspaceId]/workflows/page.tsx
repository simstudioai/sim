import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

export const metadata: Metadata = { title: 'Workflows' }

export default async function Page({ params }: PageProps<'/workspace/[workspaceId]/workflows'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { WorkflowsRoute }] = await Promise.all([
    params,
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/workflows-route/workflows-route'
    ),
  ])
  return <WorkflowsRoute workspaceId={workspaceId} />
}
