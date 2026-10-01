'use client'

import { useState } from 'react'
import { useQueryStates } from 'nuqs'
import {
  isPanelKind,
  PANEL_KINDS,
  panelKindConfig,
  resourcesOfKind,
} from '@/app/playground/org/lib/chat-resources'
import { RESOURCES, type Workspace } from '@/app/playground/org/lib/mock-data'
import { RESOURCE_SECTIONS, type WorkspaceSection } from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useWorkspacePane } from '@/app/playground/org/lib/workspace-pane-store'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

const KIND_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'count', header: 'Items' },
]

const RESULT_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'kind', header: 'Kind' },
]

function countOf(workspace: Workspace, id: WorkspaceSection): number | null {
  if (id === 'credentials') return RESOURCES.credentials.length
  return isPanelKind(id) ? resourcesOfKind(workspace, id).length : null
}

/**
 * The Resources directory: the same list chrome as every kind page, with one row per kind.
 * Typing searches across every kind of the project; a result opens as a tab.
 */
export function ResourceKinds({ workspace }: { workspace: Workspace }) {
  const setSection = useWorkspacePane((state) => state.setSection)
  const [, setParams] = useQueryStates(protoParsers)
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const kinds = RESOURCE_SECTIONS.filter((section) => section.id !== 'settings')

  const kindRows: ResourceRow[] = kinds.map((section) => ({
    id: section.id,
    cells: {
      name: {
        icon: <section.icon className='size-[14px] text-[var(--text-icon)]' />,
        label: section.label,
      },
      count: { label: String(countOf(workspace, section.id) ?? '') },
    },
  }))

  const results = needle
    ? PANEL_KINDS.flatMap((kind) =>
        resourcesOfKind(workspace, kind.id).filter((resource) =>
          resource.name.toLowerCase().includes(needle)
        )
      )
    : []
  const resultRows: ResourceRow[] = results.map((resource) => {
    const config = panelKindConfig(resource.kind)
    return {
      id: `${resource.kind}:${resource.id}`,
      cells: {
        name: {
          icon: <config.icon className='size-[14px] text-[var(--text-icon)]' />,
          label: resource.name,
        },
        kind: { label: config.label },
      },
    }
  })

  return (
    <Resource>
      <Resource.Options
        search={{ value: search, onChange: setSearch, placeholder: `Search ${workspace.name}` }}
      />
      {needle ? (
        <Resource.Table
          columns={RESULT_COLUMNS}
          rows={resultRows}
          onRowClick={(id) =>
            void setParams({ open: `${id.split(':')[0]}:${workspace.id}:${id.split(':')[1]}` })
          }
        />
      ) : (
        <Resource.Table
          columns={KIND_COLUMNS}
          rows={kindRows}
          onRowClick={(id) => setSection(id as WorkspaceSection)}
        />
      )}
    </Resource>
  )
}
