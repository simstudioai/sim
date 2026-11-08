'use client'

import { NuqsAdapter } from 'nuqs/adapters/next/app'
import type { DashboardData } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import { DashboardView } from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/dashboard-view/dashboard-view'

interface DashboardRouteProps {
  data: DashboardData
}

/** The example snapshot. Example time is fixed, so its age holds; live data refreshes itself. */
export function DashboardRoute({ data }: DashboardRouteProps) {
  return (
    <NuqsAdapter>
      <DashboardView data={data} />
    </NuqsAdapter>
  )
}
