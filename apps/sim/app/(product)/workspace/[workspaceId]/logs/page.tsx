import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { LogsRoute } from '@/app/(product)/workspace/[workspaceId]/logs/_components/logs-route/logs-route'
import { loadWorkspaceRuns } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Logs' }

/** The mode is per-request; a build must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/logs'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') {
    // Links into legacy's logs name a run by `executionId`; it opens the run's own page here.
    const { executionId } = query
    if (typeof executionId === 'string' && executionId) {
      const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
      redirect(
        withRunListView(
          platformHref(
            workspacePath(workspaceId, `logs/${encodeURIComponent(executionId)}`),
            search
          ),
          query
        )
      )
    }
    const [{ LiveRuns }, { readIntegrationTriggerOptions }] = await Promise.all([
      import('@/app/(product)/workspace/[workspaceId]/logs/_components/live-runs/live-runs'),
      import('@/platform/lib/data/workflows/trigger-options'),
    ])
    return (
      <LiveRuns workspaceId={workspaceId} integrationTriggers={readIntegrationTriggerOptions()} />
    )
  }
  const data = await loadWorkspaceRuns(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Logs' description='No workspace data available.' />
  }
  return <LogsRoute data={data} />
}
