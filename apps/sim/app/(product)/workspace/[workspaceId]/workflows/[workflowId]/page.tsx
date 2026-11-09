import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Workflow' }

export default async function Page({
  params,
}: ProductPageProps<{ workspaceId: string; workflowId: string }>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, workflowId }, { WorkflowEditor }] = await Promise.all([
    params,
    import(
      '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflow-editor/workflow-editor'
    ),
  ])
  return <WorkflowEditor workspaceId={workspaceId} workflowId={workflowId} />
}
