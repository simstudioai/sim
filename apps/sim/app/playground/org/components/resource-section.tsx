'use client'

import { useState } from 'react'
import { Chip, ChipTag } from '@sim/emcn'
import { Database, Files, Integration, Library, Plus, Table, Workflow } from '@sim/emcn/icons'
import { RESOURCES } from '@/app/playground/org/lib/mock-data'
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

/** The existing Resource list over static rows; the section chip is the title, so no header bar. */
export function ResourceSection({ section }: { section: ResourceSectionId }) {
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
      <Resource.Table columns={COLUMNS} rows={rows} />
    </Resource>
  )
}
