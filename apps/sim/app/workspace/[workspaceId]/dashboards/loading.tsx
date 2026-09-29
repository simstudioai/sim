'use client'

import { ChartColumn } from '@sim/emcn/icons'
import { ResourceChromeFallback } from '@/app/workspace/[workspaceId]/components/resource/components/resource-chrome-fallback'

const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 3 },
  { id: 'updated', header: 'Updated' },
  { id: 'actions', header: '', widthMultiplier: 0.3 },
]

export default function DashboardsLoading() {
  return (
    <ResourceChromeFallback
      icon={ChartColumn}
      title='Dashboards'
      columns={COLUMNS}
      searchPlaceholder='Search dashboards...'
    />
  )
}
