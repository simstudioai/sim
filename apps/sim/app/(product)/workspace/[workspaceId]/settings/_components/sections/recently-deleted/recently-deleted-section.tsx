'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import type { IconName } from '@sim/emcn/catalog/icon-geometry'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { workspacePath } from '@/lib/navigation/paths'
import {
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { ListEnd } from '@/app/(product)/workspace/[workspaceId]/_components/list-end/list-end'
import { sortActions } from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/list-menus'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import {
  RECENTLY_DELETED_TYPES_BY_FILTER,
  type RecentlyDeletedItem,
  recentlyDeletedParsers,
  recentlyDeletedSortParams,
  recentlyDeletedUrlKeys,
  SEARCH_DEBOUNCE_MS,
  useRecentlyDeletedItems,
  useRestoreFolder,
  useRestoreKnowledgeBase,
  useRestoreTable,
  useRestoreWorkspaceFile,
  useRestoreWorkspaceFileFolder,
  useSearchFilterValue,
  useSettingsSearch,
  useUrlSort,
  type WORKSPACE_RECENTLY_DELETED_FILTERS,
} from '@/platform/lib/data/recently-deleted'
import { useRestoreWorkflow } from '@/platform/lib/data/workflows/records'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'
import { platformHref } from '@/platform/lib/navigation'
import { formatInstantDate } from '@/platform/shared/time'

type WorkspaceFilter = (typeof WORKSPACE_RECENTLY_DELETED_FILTERS)[number]
type DeletedType = Exclude<RecentlyDeletedItem['type'], 'chat'>

interface DeletedResource {
  id: string
  name: string
  type: DeletedType
  deletedAt: string
}

const TABS: readonly { id: WorkspaceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'table', label: 'Tables' },
  { id: 'file', label: 'Files' },
  { id: 'knowledge', label: 'Knowledge Bases' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'folder', label: 'Folders' },
]

const SORT_COLUMNS = [
  { id: 'deleted', label: 'Deleted' },
  { id: 'name', label: 'Name' },
  { id: 'type', label: 'Type' },
] as const

const TYPE_LABEL: Record<DeletedType, string> = {
  workflow: 'Workflow',
  folder: 'Folder',
  workspace_folder: 'File Folder',
  knowledge_folder: 'Knowledge Folder',
  table_folder: 'Table Folder',
  table: 'Table',
  knowledge: 'Knowledge Base',
  file: 'File',
}

const TYPE_ICON: Record<DeletedType, IconName> = {
  workflow: 'I118',
  folder: 'I100',
  workspace_folder: 'I100',
  knowledge_folder: 'I100',
  table_folder: 'I100',
  table: 'I033',
  knowledge: 'I082',
  file: 'I015',
}

/**
 * Restore brings a workflow back without re-enabling its schedules, webhooks or chats: archive
 * overwrote their enabled state without recording it. Restoring anything that carries automations
 * says so, so re-enabling is a known step rather than a surprise.
 */
const PAUSED_AUTOMATION_TYPES = new Set<DeletedType>(['workflow', 'folder'])

/** Where a restored item lives now; a folder opens its list at that folder. */
function resourcePath(workspaceId: string, { type, id }: DeletedResource): string {
  const folder = (list: string) => workspacePath(workspaceId, `${list}?folderId=${id}`)
  switch (type) {
    case 'workflow':
      return workspacePath(workspaceId, `workflows/${id}`)
    case 'table':
      return workspacePath(workspaceId, `tables/${id}`)
    case 'knowledge':
      return workspacePath(workspaceId, `knowledge/${id}`)
    case 'file':
      return workspacePath(workspaceId, `files/${id}`)
    case 'folder':
      return folder('workflows')
    case 'workspace_folder':
      return folder('files')
    case 'knowledge_folder':
      return folder('knowledge')
    case 'table_folder':
      return folder('tables')
  }
}

function isWorkspaceResource(
  item: RecentlyDeletedItem
): item is RecentlyDeletedItem & { type: DeletedType } {
  return item.type !== 'chat'
}

interface RestoredEntry {
  resource: DeletedResource
  displayIndex: number
}

/**
 * What was deleted in this workspace, searched and sorted on the server a page at a time. A
 * restored row stays in place, says so, and links to where it lives now.
 */
export default function RecentlyDeletedSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate: canRestore } = useWorkspaceSettingsSection(workspaceId, 'recently-deleted')
  const search = useSearchParams()
  const [{ tab }, setFilters] = useQueryStates(recentlyDeletedParsers, recentlyDeletedUrlKeys)
  const { sort, dir, onSort } = useUrlSort(recentlyDeletedSortParams, recentlyDeletedUrlKeys)
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const debouncedSearch = useSearchFilterValue(searchTerm, SEARCH_DEBOUNCE_MS).trim()
  const [restoringIds, setRestoringIds] = useState<ReadonlySet<string>>(new Set())
  const [restored, setRestored] = useState<ReadonlyMap<string, RestoredEntry>>(new Map())

  const deleted = useRecentlyDeletedItems({
    workspaceId,
    filter: tab,
    search: debouncedSearch,
    sortBy: sort,
    sortOrder: dir,
  })
  const restoreWorkflow = useRestoreWorkflow()
  const restoreFolder = useRestoreFolder()
  const restoreTable = useRestoreTable()
  const restoreKnowledgeBase = useRestoreKnowledgeBase()
  const restoreWorkspaceFile = useRestoreWorkspaceFile()
  const restoreWorkspaceFileFolder = useRestoreWorkspaceFileFolder()

  const items: DeletedResource[] = (deleted.data?.pages ?? []).flatMap((page) =>
    page.items.filter(isWorkspaceResource).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      deletedAt: item.deletedAt,
    }))
  )
  const normalized = debouncedSearch.toLowerCase()
  const listed = new Set(items.map((item) => item.id))
  for (const [id, entry] of restored) {
    if (listed.has(id)) continue
    if (!RECENTLY_DELETED_TYPES_BY_FILTER[tab].includes(entry.resource.type)) continue
    if (normalized && !entry.resource.name.toLowerCase().includes(normalized)) continue
    items.splice(Math.min(entry.displayIndex, items.length), 0, entry.resource)
  }

  const restore = async (resource: DeletedResource) => {
    const displayIndex = Math.max(
      0,
      items.findIndex((item) => item.id === resource.id)
    )
    setRestoringIds((previous) => new Set(previous).add(resource.id))
    try {
      switch (resource.type) {
        case 'workflow':
          await restoreWorkflow.mutateAsync({ workflowId: resource.id, workspaceId })
          break
        case 'folder':
          await restoreFolder.mutateAsync({ folderId: resource.id, workspaceId })
          break
        case 'table':
          await restoreTable.mutateAsync(resource.id)
          break
        case 'knowledge':
          await restoreKnowledgeBase.mutateAsync(resource.id)
          break
        case 'file':
          await restoreWorkspaceFile.mutateAsync({ workspaceId, fileId: resource.id })
          break
        case 'workspace_folder':
          await restoreWorkspaceFileFolder.mutateAsync({ workspaceId, folderId: resource.id })
          break
        case 'knowledge_folder':
          await restoreFolder.mutateAsync({
            folderId: resource.id,
            workspaceId,
            resourceType: 'knowledge_base',
          })
          break
        case 'table_folder':
          await restoreFolder.mutateAsync({
            folderId: resource.id,
            workspaceId,
            resourceType: 'table',
          })
          break
      }
      setRestored((previous) => new Map(previous).set(resource.id, { resource, displayIndex }))
    } catch {
      return
    } finally {
      setRestoringIds((previous) => {
        const next = new Set(previous)
        next.delete(resource.id)
        return next
      })
    }
  }

  const list =
    deleted.error && !deleted.data ? (
      <FailureNotice
        message={getErrorMessage(deleted.error, 'Failed to load deleted items')}
        retrying={deleted.isFetching}
        onRetry={() => void deleted.refetch()}
      />
    ) : deleted.isLoading && items.length === 0 ? null : items.length === 0 ? (
      <EmptyState
        title={
          debouncedSearch ? `No items found matching “${debouncedSearch}”` : 'No deleted items'
        }
      />
    ) : (
      <SettingsSection title='Deleted items'>
        {items.map((resource) => {
          const isRestored = restored.has(resource.id)
          return (
            <SettingsRow
              key={resource.id}
              label={resource.name}
              leading={<Icon name={TYPE_ICON[resource.type]} />}
              description={`${TYPE_LABEL[resource.type]} · Deleted ${formatInstantDate(resource.deletedAt)}${
                canRestore && isRestored
                  ? PAUSED_AUTOMATION_TYPES.has(resource.type)
                    ? ' · Restored · schedules and webhooks stay paused'
                    : ' · Restored'
                  : ''
              }`}
            >
              {!canRestore ? null : restoringIds.has(resource.id) ? (
                <Button size='compact' disabled>
                  Restoring…
                </Button>
              ) : isRestored ? (
                <Button
                  size='compact'
                  render={<Link href={platformHref(resourcePath(workspaceId, resource), search)} />}
                >
                  View
                </Button>
              ) : (
                <Button
                  size='compact'
                  disabled={deleted.isPlaceholderData}
                  onClick={() => void restore(resource)}
                >
                  Restore
                </Button>
              )}
            </SettingsRow>
          )
        })}
        {deleted.isFetchNextPageError ? (
          <FailureNotice
            message={getErrorMessage(deleted.error, 'Failed to load more deleted items')}
            retrying={deleted.isFetchingNextPage}
            onRetry={() => void deleted.fetchNextPage()}
          />
        ) : (
          <ListEnd
            hasMore={
              deleted.hasNextPage && !deleted.isFetchingNextPage && !deleted.isPlaceholderData
            }
            onLoadMore={() => void deleted.fetchNextPage()}
          />
        )}
      </SettingsSection>
    )

  return (
    <SectionStack>
      <SectionToolbar
        grow={
          <SearchField
            label='Search deleted items'
            placeholder='Search deleted items...'
            value={searchTerm}
            onValueChange={setSearchTerm}
          />
        }
      >
        <ActionMenu
          label='Sort deleted items'
          icon='I050'
          tooltip
          align='end'
          actions={sortActions({ columns: SORT_COLUMNS, sort, dir, onSort })}
        />
      </SectionToolbar>
      <ContentTabs
        label='Deleted item types'
        current={tab}
        onSelect={(next) => {
          const selected = TABS.find((candidate) => candidate.id === next)
          if (selected) void setFilters({ tab: selected.id })
        }}
        items={TABS.map((candidate) => ({
          id: candidate.id,
          label: candidate.label,
          content: candidate.id === tab ? list : null,
        }))}
      />
    </SectionStack>
  )
}
