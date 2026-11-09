import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RunDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-details/run-details'
import { loadWorkspaceRun } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Run' }

/** The mode is per-request; a build with no API origin must not freeze the answer. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/logs/[runId]'>) {
  const [{ workspaceId, runId }, query] = await Promise.all([params, searchParams])
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withRunListView(platformHref(workspacePath(workspaceId, 'logs'), search), query),
    label: 'Logs',
  }
  const executionId = decodeURIComponent(runId)
  if (resolvePlatformMode() === 'live') {
    const { LiveRun } = await import(
      '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/live-run/live-run'
    )
    return <LiveRun workspaceId={workspaceId} executionId={executionId} back={back} />
  }
  const run = await loadWorkspaceRun(readScenario(query.state), workspaceId, executionId)
  if (!run) notFound()
  return <RunDetails run={run} back={back} />
}
