import { DashboardResource } from '@/components/dashboards/dashboard-resource'

interface DashboardPageProps {
  params: Promise<{ workspaceId: string; dashboardId: string }>
}

export default async function DashboardPage({ params }: DashboardPageProps) {
  return <DashboardResource {...(await params)} />
}
