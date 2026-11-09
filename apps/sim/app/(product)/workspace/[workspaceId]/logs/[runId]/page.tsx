import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { workspacePath } from '@/lib/navigation/paths'
import { RunDetails } from '@/app/(product)/_components/workspace/logs/run-details/run-details'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Run' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string; runId: string }>) {
  const [{ workspaceId, runId }, query] = await Promise.all([params, searchParams])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withRunListView(platformHref(workspacePath(workspaceId, 'logs'), search), query),
    label: 'Logs',
  }
  const executionId = decodeURIComponent(runId)
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const { loadWorkspaceRun } = await import('@/platform/fixtures')
    const run = await loadWorkspaceRun(readScenario(query.state), workspaceId, executionId)
    if (!run) notFound()
    return <RunDetails run={run} back={back} />
  }
  const { LiveRun } = await import('@/app/(product)/_components/workspace/logs/live-run/live-run')
  return <LiveRun workspaceId={workspaceId} executionId={executionId} back={back} />
}
