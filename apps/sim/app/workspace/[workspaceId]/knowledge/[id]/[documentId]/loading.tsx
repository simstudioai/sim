'use client'

import { Plus } from '@sim/emcn'
import { Database } from '@sim/emcn/icons'
import { noop } from '@sim/utils/helpers'
import { FileText } from 'lucide-react'
import {
  type BreadcrumbItem,
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'

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
