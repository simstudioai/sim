'use client'

import { Database, FileText, Plus } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { FOLDERED_RESOURCE_HEADERS } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'

const KNOWLEDGE_HEADER = FOLDERED_RESOURCE_HEADERS.knowledge_base

const COLUMNS = [
  { id: 'content', header: 'Content' },
  { id: 'index', header: 'Index', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'status', header: 'Status', widthMultiplier: 0.75 },
]

const ACTIONS: ChromeActionSpec[] = [{ text: 'New chunk', icon: Plus, variant: 'primary' }]

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: KNOWLEDGE_HEADER.rootLabel, icon: Database, onClick: noop },
  { label: '…', icon: Database },
  { label: '…', terminal: true },
]

export default function DocumentLoading() {
  return (
    <ResourceChromeFallback
      icon={FileText}
      breadcrumbs={BREADCRUMBS}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search chunks...'
      hasSort
      hasFilter
    />
  )
}
