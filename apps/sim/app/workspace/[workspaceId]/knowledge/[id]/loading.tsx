'use client'

import { Plus } from '@sim/emcn'
import { Database } from '@sim/emcn/icons'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

const noop = () => {}

const COLUMNS = [
  { id: 'name', header: 'Name', widthMultiplier: 0.8 },
  { id: 'size', header: 'Size', widthMultiplier: 0.75 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.75 },
  { id: 'chunks', header: 'Chunks', widthMultiplier: 0.75 },
  { id: 'uploaded', header: 'Uploaded' },
  { id: 'status', header: 'Status', widthMultiplier: 0.75 },
  { id: 'tags', header: 'Tags' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'New connector', icon: Plus },
  { text: 'New documents', icon: Plus, variant: 'primary' },
]

const BREADCRUMBS: BreadcrumbItem[] = [
  { label: 'Knowledge Base', icon: Database, onClick: noop },
  { label: '…', icon: Database, terminal: true },
]

export default function KnowledgeBaseLoading() {
  return (
    <ResourceChromeFallback
      icon={Database}
      breadcrumbs={BREADCRUMBS}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search documents...'
      hasSort
      hasFilter
    />
  )
}
