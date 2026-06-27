'use client'

import { useTranslations } from 'next-intl'
import { Library, RefreshCw } from '@/components/emcn'
import { Download } from '@/components/emcn/icons'
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
  const t = useTranslations('auto')
  return (
    <ResourceChromeFallback
      icon={Library}
      title={t('logs')}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search logs...'
      hasSort
      hasFilter
    />
  )
}
