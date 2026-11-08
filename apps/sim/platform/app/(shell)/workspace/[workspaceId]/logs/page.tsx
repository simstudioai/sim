import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { LogsRoute } from '@/platform/app/(shell)/workspace/[workspaceId]/logs/_components/logs-route/logs-route'
import { loadWorkspaceRuns } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Logs' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/logs'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') {
    const { redirectWorkspaceTabToLegacy } = await import('@/platform/lib/data/workspace-directory')
    redirectWorkspaceTabToLegacy(workspaceId, 'logs', undefined, query)
  }
  const data = await loadWorkspaceRuns(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Logs' description='No workspace data available.' />
  }
  return <LogsRoute data={data} />
}
