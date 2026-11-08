import { EmptyState } from '@sim/emcn/empty-state'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DashboardRoute } from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/dashboard-route/dashboard-route'
import { loadWorkspaceDashboard } from '@/platform/fixtures'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { readScenario } from '@/platform/lib/navigation'

export const metadata: Metadata = { title: 'Dashboard' }

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/dashboards'>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  const mode = resolvePlatformMode()
  if (mode === 'live') {
    const { redirectWorkspaceTabToLegacy } = await import('@/platform/lib/data/workspace-directory')
    redirectWorkspaceTabToLegacy(workspaceId, 'dashboards', undefined, query)
  }
  const data = await loadWorkspaceDashboard(readScenario(query.state), workspaceId)
  if (!data) {
    if (mode === 'fixture') notFound()
    return <EmptyState title='Dashboard' description='No workspace data available.' />
  }
  return <DashboardRoute data={data} />
}
