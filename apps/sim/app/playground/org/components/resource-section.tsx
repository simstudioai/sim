'use client'

import { useState } from 'react'
import { Chip, ChipTag } from '@sim/emcn'
import {
  Database,
  Files,
  Folder,
  Integration,
  Library,
  Plus,
  Table,
  Workflow,
} from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { isPanelKind } from '@/app/playground/org/lib/chat-resources'
import { RESOURCES, type Workspace } from '@/app/playground/org/lib/mock-data'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { useWorkspacePane } from '@/app/playground/org/lib/workspace-pane-store'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

type ResourceSectionId = keyof typeof RESOURCES

const CONFIG: Record<
  ResourceSectionId,
  {
    title: string
    icon: React.ComponentType<{ className?: string }>
    create?: string
    meta: string
  }
> = {
  workflows: { title: 'Workflows', icon: Workflow, create: 'New workflow', meta: 'Status' },
  logs: { title: 'Logs', icon: Library, meta: 'Result' },
  tables: { title: 'Tables', icon: Table, create: 'New table', meta: 'Rows' },
  files: { title: 'Files', icon: Files, create: 'Upload', meta: 'Type' },
  knowledge: { title: 'Knowledge', icon: Database, create: 'New base', meta: 'Documents' },
  credentials: { title: 'Integrations', icon: Integration, create: 'Connect', meta: 'Status' },
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'meta', header: 'Detail' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Updated' },
]

interface ResourceSectionProps {
  workspace: Workspace
  section: ResourceSectionId
}

/** The existing Resource list over static rows, under a breadcrumb back to the directory; a row opens as a tab. */
export function ResourceSection({ workspace, section }: ResourceSectionProps) {
  const [, setParams] = useQueryStates(protoParsers)
  const setSection = useWorkspacePane((state) => state.setSection)
  const config = CONFIG[section]
  const [search, setSearch] = useState('')
  const Icon = config.icon
  const rows: ResourceRow[] = RESOURCES[section]
    .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
    .map((item) => ({
      id: item.id,
      cells: {
        name: { icon: <Icon className='size-[14px] text-[var(--text-icon)]' />, label: item.name },
        meta: /expired|error|failing/i.test(item.meta)
          ? { content: <ChipTag variant='gray'>{item.meta}</ChipTag> }
          : { label: item.meta },
        owner: { label: item.owner },
        updated: timeCell(item.updated),
      },
    }))
  return (
    <Resource>
      <Resource.Header
        icon={Folder}
        breadcrumbs={[
          { label: 'Resources', onClick: () => setSection('resources') },
          { label: config.title, icon: Icon },
        ]}
      />
      <Resource.Options
        trailing={
          config.create ? (
            <Chip variant='primary' leftIcon={Plus}>
              {config.create}
            </Chip>
          ) : undefined
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: `Search ${config.title.toLowerCase()}`,
        }}
      />
      <Resource.Table
        columns={COLUMNS}
        rows={rows}
        onRowClick={
          isPanelKind(section)
            ? (id) => {
                const item = RESOURCES[section].find((candidate) => candidate.id === id)
                if (!item) throw new Error(`Unknown ${section} row ${id}`)
                void setParams({ open: `${section}:${workspace.id}:${id}` })
              }
            : undefined
        }
      />
    </Resource>
  )
}
