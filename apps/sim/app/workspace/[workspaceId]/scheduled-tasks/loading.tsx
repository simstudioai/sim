'use client'

import { Plus } from '@/components/emcn'
import { Calendar } from '@/components/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const COLUMNS = [
  { id: 'task', header: 'Task' },
  { id: 'schedule', header: 'Schedule' },
  { id: 'nextRun', header: 'Next Run' },
  { id: 'lastRun', header: 'Last Run' },
]

const ACTIONS: ChromeActionSpec[] = [{ text: 'New scheduled task', icon: Plus, variant: 'primary' }]

export default function ScheduledTasksLoading() {
  return (
    <ResourceChromeFallback
      icon={Calendar}
      title='Scheduled Tasks'
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search scheduled tasks...'
      hasSort
      hasFilter
    />
  )
}
