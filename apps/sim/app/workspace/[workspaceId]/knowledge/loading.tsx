'use client'

import { useTranslations } from 'next-intl'
import { Plus } from '@/components/emcn'
import { Database } from '@/components/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const COLUMNS = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [{ text: 'New base', icon: Plus, variant: 'primary' }]

export default function KnowledgeLoading() {
  const t = useTranslations('auto')
  return (
    <ResourceChromeFallback
      icon={Database}
      title={t('knowledge_base')}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search knowledge bases...'
      hasSort
      hasFilter
    />
  )
}
