'use client'

import { Database, FolderPlus, Plus } from '@sim/emcn/icons'
import {
  type ChromeActionSpec,
  ResourceChromeFallback,
} from '@/app/workspace/[workspaceId]/components'
import { FOLDERED_RESOURCE_HEADERS } from '@/app/workspace/[workspaceId]/components/folders/foldered-resources'

const KNOWLEDGE_HEADER = FOLDERED_RESOURCE_HEADERS.knowledge_base

const COLUMNS = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const ACTIONS: ChromeActionSpec[] = [
  { text: 'New folder', icon: FolderPlus },
  { text: 'New base', icon: Plus, variant: 'primary' },
]

export default function KnowledgeLoading() {
  return (
    <ResourceChromeFallback
      icon={Database}
      title={KNOWLEDGE_HEADER.rootLabel}
      columns={COLUMNS}
      actions={ACTIONS}
      searchPlaceholder='Search knowledge bases...'
      hasSort
      hasFilter
    />
  )
}
