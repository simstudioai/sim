import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RunDetails } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/run-details/run-details'
import { loadWorkspaceRun } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { platformHref, readScenario } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { withRunListView } from '@/platform/lib/workspace-views'

export const metadata: Metadata = { title: 'Run' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/logs/[runId]'>) {
  const [{ workspaceId, runId }, query] = await Promise.all([params, searchParams])
  if (resolvePlatformMode() === 'live') {
    const { redirectWorkspaceTabToLegacy } = await import('@/platform/lib/data/workspace-directory')
    redirectWorkspaceTabToLegacy(workspaceId, 'logs', runId, query)
  }
  const run = await loadWorkspaceRun(
    readScenario(query.state),
    workspaceId,
    decodeURIComponent(runId)
  )
  if (!run) notFound()
  const search = { get: (key: string) => (typeof query[key] === 'string' ? query[key] : null) }
  const back = {
    href: withRunListView(platformHref(workspacePath(workspaceId, 'logs'), search), query),
    label: 'Logs',
  }
  return <RunDetails run={run} back={back} />
}
