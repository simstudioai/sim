'use client'

import { Database, Plus } from '@sim/emcn-legacy/icons'
import { noop } from '@sim/utils/helpers'
import { FOLDERED_RESOURCE_HEADERS } from '@/components/folders/foldered-resources'
import { DOCUMENT_COLUMNS } from '@/components/knowledge/base/document-columns'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/components/resource/components/resource-chrome-fallback'
import type { BreadcrumbItem } from '@/components/resource/components/resource-header'

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
