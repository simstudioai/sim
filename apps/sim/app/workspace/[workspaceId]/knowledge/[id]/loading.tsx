'use client'

import { Database, Plus } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { FOLDERED_RESOURCE_HEADERS } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'
import { DOCUMENT_COLUMNS } from '@/app/workspace/[workspaceId]/knowledge/[id]/document-columns'

const KNOWLEDGE_HEADER = FOLDERED_RESOURCE_HEADERS.knowledge_base

const ACTIONS: ChromeActionSpec[] = [
  { text: 'New connector', icon: Plus },
  { text: 'New documents', icon: Plus, variant: 'primary' },
]

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: KNOWLEDGE_HEADER.rootLabel, icon: Database, onClick: noop },
  { label: '…', terminal: true },
]

export default function KnowledgeBaseLoading() {
  return (
    <ResourceChromeFallback
      icon={Database}
      breadcrumbs={BREADCRUMBS}
      columns={DOCUMENT_COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search documents...'
      hasSort
      hasFilter
    />
  )
}
