'use client'

import { Library, RefreshCw } from '@sim/emcn'
import { Download } from '@sim/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const COLUMNS = [
  { id: 'workflow', header: 'Workflow' },
  { id: 'date', header: 'Date' },
  { id: 'status', header: 'Status' },
  { id: 'cost', header: 'Cost' },
  { id: 'trigger', header: 'Trigger' },
  { id: 'duration', header: 'Duration' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'Export', icon: Download },
  { text: 'Refresh', icon: RefreshCw },
  { text: 'Logs', active: true },
  { text: 'Dashboard' },
]

export default function LogsLoading() {
  return (
    <ResourceChromeFallback
      icon={Library}
      title='Logs'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search logs...'
      hasSort
      hasFilter
    />
  )
}
