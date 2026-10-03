import { DashboardLoading } from '@/components/dashboards/dashboard-loading'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'

export default function DashboardsLoading() {
  return (
    <Resource>
      <DashboardLoading />
    </Resource>
  )
}
