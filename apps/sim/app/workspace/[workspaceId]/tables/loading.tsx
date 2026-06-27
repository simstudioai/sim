'use client'

import { useTranslations } from 'next-intl'
import { Plus, Upload } from '@/components/emcn'
import { Table as TableIcon } from '@/components/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const COLUMNS = [
  { id: 'name', header: 'Name' },
  { id: 'columns', header: 'Columns' },
  { id: 'rows', header: 'Rows' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'Import CSV', icon: Upload },
  { text: 'New table', icon: Plus, variant: 'primary' },
]

export default function TablesLoading() {
  const t = useTranslations('auto')
  return (
    <ResourceChromeFallback
      icon={TableIcon}
      title={t('tables')}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search tables...'
      hasSort
      hasFilter
    />
  )
}
