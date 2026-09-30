'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { Chip, ChipLink, ChipTag } from '@sim/emcn'
import { Database, Files, Integration, Library, Plus, Table, Workflow } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { DASHBOARD_CONTENT_TYPE } from '@/lib/dashboards/file'
import { RESOURCES } from '@/app/playground/org/lib/mock-data'
import { type Project, realWorkspaceId } from '@/app/playground/org/lib/project'
import { workspaceRoutes } from '@/app/playground/org/lib/routes'
import {
  type ProjectResources,
  useProjectResources,
} from '@/app/playground/org/lib/use-project-resources'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { type LogFilters, useLogsList } from '@/hooks/queries/logs'

export type ResourceSectionId =
  | 'workflows'
  | 'logs'
  | 'tables'
  | 'files'
  | 'knowledge'
  | 'credentials'

interface SectionConfig {
  title: string
  icon: React.ComponentType<{ className?: string }>
  /** Label of the create chip, which opens the real list page where the action lives. */
  create?: string
  createHref: (workspaceId: string) => string
  meta: string
}

const CONFIG: Record<ResourceSectionId, SectionConfig> = {
  workflows: {
    title: 'Workflows',
    icon: Workflow,
    create: 'New workflow',
    createHref: workspaceRoutes.workflows,
    meta: 'Status',
  },
  logs: { title: 'Logs', icon: Library, createHref: workspaceRoutes.logs, meta: 'Result' },
  tables: {
    title: 'Tables',
    icon: Table,
    create: 'New table',
    createHref: workspaceRoutes.tables,
    meta: 'Rows',
  },
  files: {
    title: 'Files',
    icon: Files,
    create: 'Upload',
    createHref: workspaceRoutes.files,
    meta: 'Type',
  },
  knowledge: {
    title: 'Knowledge',
    icon: Database,
    create: 'New base',
    createHref: workspaceRoutes.knowledge,
    meta: 'Documents',
  },
  credentials: {
    title: 'Integrations',
    icon: Integration,
    create: 'Connect',
    createHref: workspaceRoutes.integrations,
    meta: 'Status',
  },
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 2 },
  { id: 'meta', header: 'Detail' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Updated' },
]

/** Runs shown in the project's Logs section: newest first, every level. */
const LOG_FILTERS: LogFilters = {
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: '',
  limit: 50,
  sortBy: 'date',
  sortOrder: 'desc',
}

interface SectionItem {
  id: string
  name: string
  meta: string
  /** Render the detail as a tag: an error, a failed run, an expired credential. */
  flagged?: boolean
  owner: string
  updated: string | Date | null | undefined
  href: string
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

function fileKind(type: string): string {
  if (type === DASHBOARD_CONTENT_TYPE) return 'Dashboard'
  if (type.startsWith('text/markdown')) return 'Markdown'
  if (type.startsWith('image/')) return 'Image'
  if (type === 'application/pdf') return 'PDF'
  if (type === 'text/csv') return 'CSV'
  return type.split('/').pop() ?? type
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

function resourceItems(
  section: Exclude<ResourceSectionId, 'logs' | 'credentials'>,
  workspaceId: string,
  resources: ProjectResources
): SectionItem[] {
  const owner = (userId: string | null | undefined) =>
    (userId && resources.memberNames.get(userId)) || '—'
  switch (section) {
    case 'workflows':
      return resources.workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        meta: workflow.isDeployed ? 'Deployed' : 'Draft',
        owner: (workflow.folderId && resources.folders[workflow.folderId]?.name) || '—',
        updated: workflow.lastModified,
        href: workspaceRoutes.workflow(workspaceId, workflow.id),
      }))
    case 'tables':
      return resources.tables.map((table) => ({
        id: table.id,
        name: table.name,
        meta: plural(table.rowCount, 'row'),
        owner: owner(table.createdBy),
        updated: table.updatedAt,
        href: workspaceRoutes.table(workspaceId, table.id),
      }))
    case 'knowledge':
      return resources.knowledgeBases.map((base) => ({
        id: base.id,
        name: base.name,
        meta: plural(base.docCount ?? 0, 'doc'),
        owner: owner(base.userId),
        updated: base.updatedAt,
        href: workspaceRoutes.knowledgeBase(workspaceId, base.id),
      }))
    case 'files':
      return resources.files.map((file) => ({
        id: file.id,
        name: file.name,
        meta: fileKind(file.type),
        owner: owner(file.uploadedBy),
        updated: file.updatedAt,
        href: workspaceRoutes.file(workspaceId, file.id),
      }))
  }
}

interface ResourceSectionProps {
  project: Project
  section: ResourceSectionId
}

/** The existing Resource list over the workspace's real rows; a row opens the real page. */
export function ResourceSection({ project, section }: ResourceSectionProps) {
  const config = CONFIG[section]
  const router = useRouter()
  const [search, setSearch] = useState('')
  const workspaceId = realWorkspaceId(project)
  const resources = useProjectResources(workspaceId)
  const logs = useLogsList(workspaceId || undefined, LOG_FILTERS, {
    enabled: section === 'logs' && Boolean(workspaceId),
  })
  const credentials = useWorkspaceCredentials({
    workspaceId: workspaceId || undefined,
    type: 'oauth',
    enabled: section === 'credentials' && Boolean(workspaceId),
  })
  const Icon = config.icon

  const items = useMemo<SectionItem[]>(() => {
    /** A mock project keeps the prototype's static rows; they open nothing. */
    if (project.isMock)
      return RESOURCES[section].map((item) => ({
        id: item.id,
        name: item.name,
        meta: item.meta,
        flagged: /expired|error|failing/i.test(item.meta),
        owner: item.owner,
        updated: item.updated,
        href: '',
      }))
    if (section === 'logs')
      return (logs.data?.pages.flatMap((page) => page.logs) ?? []).map((log) => {
        const status = capitalize(log.status ?? log.level)
        return {
          id: log.id,
          name: log.workflow?.name ?? log.jobTitle ?? 'Run',
          meta: log.duration ? `${status} · ${log.duration}` : status,
          flagged: /error|fail/i.test(`${log.status ?? ''} ${log.level}`),
          owner: capitalize(log.trigger ?? '—'),
          updated: log.createdAt,
          href: workspaceRoutes.logs(project.id, log.executionId),
        }
      })
    if (section === 'credentials')
      return (credentials.data ?? []).map((credential) => ({
        id: credential.id,
        name: credential.displayName,
        meta: credential.status ? capitalize(credential.status) : 'Connected',
        flagged: /expired|error|invalid|revoked/i.test(credential.status ?? ''),
        owner: resources.memberNames.get(credential.createdBy) ?? '—',
        updated: credential.updatedAt,
        href: workspaceRoutes.credential(project.id, credential.id),
      }))
    return resourceItems(section, project.id, resources)
  }, [section, project.id, project.isMock, resources, logs.data, credentials.data])

  const hrefById = useMemo(() => new Map(items.map((item) => [item.id, item.href])), [items])
  const rows: ResourceRow[] = items
    .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
    .map((item) => ({
      id: item.id,
      cells: {
        name: { icon: <Icon className='size-[14px] text-[var(--text-icon)]' />, label: item.name },
        meta: item.flagged
          ? { content: <ChipTag variant='gray'>{item.meta}</ChipTag> }
          : { label: item.meta },
        owner: { label: item.owner },
        updated: timeCell(item.updated),
      },
    }))

  const pending = project.isMock
    ? false
    : section === 'logs'
      ? logs.isPending
      : section === 'credentials'
        ? credentials.isPending
        : resources.isPending

  return (
    <Resource>
      <Resource.Options
        trailing={
          !config.create ? undefined : project.isMock ? (
            <Chip variant='primary' leftIcon={Plus}>
              {config.create}
            </Chip>
          ) : (
            <ChipLink href={config.createHref(project.id)} variant='primary' leftIcon={Plus}>
              {config.create}
            </ChipLink>
          )
        }
        search={{
          value: search,
          onChange: setSearch,
          placeholder: `Search ${config.title.toLowerCase()}`,
        }}
      />
      {pending && rows.length === 0 ? (
        <Empty>Loading {config.title.toLowerCase()}…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No {config.title.toLowerCase()} yet.</Empty>
      ) : (
        <Resource.Table
          columns={COLUMNS}
          rows={rows}
          onRowClick={(rowId) => {
            const href = hrefById.get(rowId)
            if (href) router.push(href)
          }}
        />
      )}
    </Resource>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className='px-6 py-10 text-[var(--text-muted)] text-small'>{children}</p>
}
