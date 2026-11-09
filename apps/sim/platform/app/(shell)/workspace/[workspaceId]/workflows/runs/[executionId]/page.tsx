import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Run snapshot' }

/**
 * A run's frozen workflow. It lives in the Workflows tab, the one place the block registry the
 * canvas draws with may load, and returns to the run it came from.
 */
export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/workflows/runs/[executionId]'>) {
  if (resolvePlatformMode() !== 'live') notFound()
  const [{ workspaceId, executionId }, query, { RunSnapshot }] = await Promise.all([
    params,
    searchParams,
    import(
      '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/run-snapshot/run-snapshot'
    ),
  ])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const runId = decodeURIComponent(executionId)
  return (
    <RunSnapshot
      workspaceId={workspaceId}
      executionId={runId}
      back={{
        href: withRunListView(
          platformHref(workspacePath(workspaceId, `logs/${encodeURIComponent(runId)}`), search),
          query
        ),
        label: `Run ${runId.slice(0, 8)}`,
      }}
    />
  )
}
