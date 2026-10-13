'use client'

import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'
import { DashboardLoading } from '@/components/dashboards/dashboard-loading'
import { DashboardPreview } from '@/components/dashboards/dashboard-preview'
import { DashboardEmptyState } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { Resource } from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useWorkspaceFilesRoom } from '@/app/workspace/[workspaceId]/files/hooks/use-workspace-files-room'
import { useWorkspaceDashboard } from '@/hooks/queries/dashboards'

interface DashboardResourceProps {
  workspaceId: string
}

/** The workspace's single dashboard, or an empty state until Sim saves the first one. */
export function DashboardResource(props: DashboardResourceProps) {
  return (
    <DashboardFeatureGate>
      <EnabledDashboardResource {...props} />
    </DashboardFeatureGate>
  )
}

function EnabledDashboardResource({ workspaceId }: DashboardResourceProps) {
  useWorkspaceFilesRoom(workspaceId)
  const query = useWorkspaceDashboard(workspaceId)
  const dashboard = query.data?.dashboard ?? null
  return (
    <Resource>
      {query.isPending ? (
        <DashboardLoading />
      ) : query.error ? (
        <div className='p-6 text-[var(--text-error)]' role='alert'>
          {query.error.message}
        </div>
      ) : dashboard && query.data.content !== null ? (
        <div className='min-h-0 flex-1 overflow-auto p-6'>
          <DashboardPreview
            workspaceId={workspaceId}
            dashboardId={dashboard.id}
            content={query.data.content}
          />
        </div>
      ) : (
        <DashboardEmptyState />
      )}
    </Resource>
  )
}
