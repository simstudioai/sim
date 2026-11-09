import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Logs' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string }>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ LogsRoute }, { loadWorkspaceRuns }] = await Promise.all([
      import('@/app/(product)/workspace/[workspaceId]/logs/_components/logs-route/logs-route'),
      import('@/platform/fixtures'),
    ])
    const data = await loadWorkspaceRuns(readScenario(query.state), workspaceId)
    if (!data) notFound()
    return <LogsRoute data={data} />
  }
  // Links into legacy's logs name a run by `executionId`; it opens the run's own page here.
  const { executionId } = query
  if (typeof executionId === 'string' && executionId) {
    const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
    redirect(
      withRunListView(
        platformHref(workspacePath(workspaceId, `logs/${encodeURIComponent(executionId)}`), search),
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
