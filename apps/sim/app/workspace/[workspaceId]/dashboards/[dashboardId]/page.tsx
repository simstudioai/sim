import { DashboardResource } from '@/components/dashboards/dashboard-resource'
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ workspaceId: string; dashboardId: string }>
}) {
  return <DashboardResource {...(await params)} />
}
