'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { DashboardData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { useSessionRefresh } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/workspace-session'
import { DashboardView } from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/dashboard-view/dashboard-view'

interface DashboardRouteProps {
  data: DashboardData
}

/** Example data with session-only refreshes: the snapshot stays the same, its timestamp moves. */
export function DashboardRoute({ data }: DashboardRouteProps) {
  const { refreshedAt, refresh } = useSessionRefresh(`dashboard/${data.workspace.id}`)
  return (
    <NuqsAdapter>
      <DashboardView
        data={{ ...data, updatedAt: refreshedAt ?? data.updatedAt }}
        actions={{ refresh: () => refresh(data.referenceTime) }}
      />
    </NuqsAdapter>
  )
}
