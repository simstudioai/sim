import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { readScenario } from '@/platform/lib/navigation'
import type { ProductPageProps } from '@/platform/lib/route-props'

export const metadata: Metadata = { title: 'Dashboard' }

/** Rendered per request: a build must never prerender a viewer's page. */
export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: ProductPageProps<{ workspaceId: string }>) {
  const [{ workspaceId }, query] = await Promise.all([params, searchParams])
  // Inlined at build time, so a normal build carries neither this branch nor the example data.
  if (process.env.SIM_PLATFORM_FIXTURES === '1') {
    const [{ DashboardRoute }, { loadWorkspaceDashboard }] = await Promise.all([
      import(
        '@/app/(product)/workspace/[workspaceId]/dashboards/_components/dashboard-route/dashboard-route'
      ),
      import('@/platform/fixtures'),
    ])
    const data = await loadWorkspaceDashboard(readScenario(query.state), workspaceId)
    if (!data) notFound()
    return <DashboardRoute data={data} />
  }
  const [{ readWorkspaceTabFlag }, { LiveDashboard }] = await Promise.all([
    import('@/platform/lib/data/workspace-tab-flags'),
    import('@/app/(product)/_components/workspace/dashboards/live-dashboard/live-dashboard'),
  ])
  if (!(await readWorkspaceTabFlag('dashboards'))) notFound()
  return <LiveDashboard workspaceId={workspaceId} />
}
