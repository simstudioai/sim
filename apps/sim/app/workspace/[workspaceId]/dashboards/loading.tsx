'use client'

import { ChartColumn } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

export default function DashboardsLoading() {
  return <ResourceChromeFallback icon={ChartColumn} title='Dashboard' />
}
