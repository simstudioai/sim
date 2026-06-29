'use client'

import { FileText } from 'lucide-react'
import { Plus } from '@/components/emcn'
import { Database } from '@/components/emcn/icons'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { useTranslations } from 'next-intl'

const noop = () => {}

const COLUMNS = [
  { id: 'content', header: 'Content' },
  { id: 'index', header: 'Index', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'status', header: 'Status', widthMultiplier: 0.75 },
]

const ACTIONS: ChromeActionSpec[] = [{ text: 'New chunk', icon: Plus, variant: 'primary' }]

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Knowledge Base', icon: Database, onClick: noop },
  { label: '…', icon: Database },
  { label: '…', terminal: true },
]

export default function DocumentLoading() {
  const t = useTranslations('auto')
  return (
    <ResourceChromeFallback
      icon={FileText}
      breadcrumbs={BREADCRUMBS}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder={t('search_chunks')}
      hasSort
      hasFilter
    />
  )
}
