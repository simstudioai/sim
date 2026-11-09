import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'

/**
 * The Workflows tab exists on live data only. Its providers (the realtime socket, permissions, the
 * workflow registry and the block loaders) span the list and the editor, so queued canvas edits keep
 * flushing when the reader goes back to the list.
 */
export default async function Layout({
  children,
  params,
}: LayoutProps<'/workspace/[workspaceId]/workflows'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId }, { WorkflowsLayout }] = await Promise.all([
    params,
    import(
      '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflows-layout/workflows-layout'
    ),
  ])
  return <WorkflowsLayout workspaceId={workspaceId}>{children}</WorkflowsLayout>
}
