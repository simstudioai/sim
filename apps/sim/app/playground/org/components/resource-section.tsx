'use client'

import { type ReactNode, useState } from 'react'
import { Chip, ChipTag } from '@sim/emcn'
import { Database, Files, Integration, Library, Plus, Table, Workflow } from '@sim/emcn/icons'
import { RESOURCES } from '@/app/playground/org/fixtures'
import type { BuildSection } from '@/app/playground/org/lib/routes'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'

export type ResourceSectionId = Exclude<BuildSection, 'settings'>

interface SectionConfig {
  title: string
  icon: React.ComponentType<{ className?: string }>
  /** Label of the create chip; a mock project's chip opens nothing. */
  create?: string
}

const CONFIG: Record<ResourceSectionId, SectionConfig> = {
  workflows: { title: 'Workflows', icon: Workflow, create: 'New workflow' },
  logs: { title: 'Logs', icon: Library },
  tables: { title: 'Tables', icon: Table, create: 'New table' },
  files: { title: 'Files', icon: Files, create: 'Upload' },
  knowledge: { title: 'Knowledge', icon: Database, create: 'New base' },
  credentials: { title: 'Integrations', icon: Integration, create: 'Connect' },
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'meta', header: 'Detail' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Updated' },
]

interface ResourceSectionProps {
  section: ResourceSectionId
}

/**
 * A mock project's Build section: the static rows of its pack in the workspace Resource list.
 * A real project's Build sections are its workspace pages, so nothing real renders here.
 */
export function ResourceSection({ section }: ResourceSectionProps) {
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
      {rows.length === 0 ? (
        <Empty>No {config.title.toLowerCase()} yet.</Empty>
      ) : (
        <Resource.Table columns={COLUMNS} rows={rows} />
      )}
    </Resource>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className='px-6 py-10 text-[var(--text-muted)] text-small'>{children}</p>
}
