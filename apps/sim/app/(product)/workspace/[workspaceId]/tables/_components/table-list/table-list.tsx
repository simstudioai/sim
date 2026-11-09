'use client'

import { useCallback, useMemo, useState } from 'react'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { getErrorMessage } from '@sim/utils/errors'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { AccessRequired } from '@/app/(product)/workspace/[workspaceId]/_components/access-required/access-required'
import {
  descendantIndex,
  folderLocation,
  folderPath,
  folderRowId,
  moveDestinations,
  nextFolderName,
  parseRowId,
  reportBulkOutcome,
  type SortEntry,
  scopeItems,
  selectionAction,
  selectionName,
  sortEntries,
  splitRowIds,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/folder-tree'
import {
  filterActions,
  filterSummary,
  folderHref,
  folderTrail,
  type ListPreference,
  noResults,
  sortActions,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/list-menus'
import {
  RenameDialog,
  useMinuteClock,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import {
  OwnerCell,
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/resource-table'
import {
  type RowMove,
  useResourceDrag,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/use-resource-drag'
import { useResourceSelection } from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/use-resource-selection'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import {
  type ResourceFolder,
  SEARCH_DEBOUNCE_MS,
  useCreateFolder,
  useDebouncedSearchSetter,
  useDeleteFolderMutation,
  useFolderParam,
  useFolders,
  useInlineRename,
  useResourceListAccess,
  useResourceListPreferences,
  useSearchFilterValue,
  useUpdateFolder,
  useUrlSort,
  useWorkspaceMembersQuery,
} from '@/platform/lib/data/folders'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/platform/lib/data/pins'
import {
  exportTable,
  generateUniqueTableName,
  MAX_TABLE_BATCH_ITEMS,
  type TableDefinition,
  tablesListPreferenceConfig,
  tablesParsers,
  tablesSortParams,
  tablesUrlKeys,
  useBulkDeleteTables,
  useBulkMoveTables,
  useCreateTable,
  useDeleteTable,
  useRenameTable,
  useTablesList,
  useWorkspaceTablesRoom,
} from '@/platform/lib/data/tables'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatRelativeTime } from '@/platform/shared/time'

const ROOT_LABEL = 'Tables'
const ROW_MIME = 'application/x-sim-workspace-table-rows'
const EMPTY_TABLES: TableDefinition[] = []
const EMPTY_FOLDERS: ResourceFolder[] = []

const COLUMNS: readonly ResourceColumn[] = [
  { id: 'columns', label: 'Columns', numeric: true, width: 'compact', optional: true },
  { id: 'rows', label: 'Rows', numeric: true, width: 'compact' },
  { id: 'created', label: 'Created', optional: true },
  { id: 'owner', label: 'Owner', optional: true },
  { id: 'updated', label: 'Last Updated', narrow: true },
]
const SEARCH_COLUMNS: readonly ResourceColumn[] = [
  ...COLUMNS,
  { id: 'location', label: 'Location', width: 'wide', optional: true },
]
const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'columns', label: 'Columns' },
  { id: 'rows', label: 'Rows' },
  { id: 'created', label: 'Created' },
  { id: 'owner', label: 'Owner' },
  { id: 'updated', label: 'Last Updated' },
] as const
const ROW_COUNTS = [
  { value: 'empty', label: 'Empty' },
  { value: 'small', label: 'Small (1–100)' },
  { value: 'large', label: 'Large (101+)' },
]

type Item = { kind: 'table'; table: TableDefinition } | { kind: 'folder'; folder: ResourceFolder }

type Confirm =
  | { kind: 'table'; table: TableDefinition }
  | { kind: 'folder'; folder: ResourceFolder }
  | { kind: 'bulk'; tableIds: string[]; folderIds: string[]; name: string }

function timeOf(value: Date | string) {
  return new Date(value).getTime()
}

interface TableListProps {
  workspaceId: string
}

/**
 * The workspace's tables and table folders as one list. Folders open in place and tables open
 * their grid; search spans every folder, and filters, sort, pins, moves and deletes work as they do
 * on the legacy page, without its CSV import.
 */
export function TableList({ workspaceId }: TableListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const now = useMinuteClock()
  const access = useResourceListAccess(workspaceId, 'hideTablesTab')
  const canEdit = access.canEdit

  // A `workspace-tables-changed` broadcast refetches the list and its folders, as legacy's does.
  useWorkspaceTablesRoom(workspaceId)
  const tablesQuery = useTablesList(workspaceId)
  const tables = tablesQuery.data ?? EMPTY_TABLES
  const membersQuery = useWorkspaceMembersQuery(workspaceId)
  const foldersQuery = useFolders(workspaceId, { resourceType: 'table' })
  const folders = foldersQuery.data ?? EMPTY_FOLDERS
  const foldersResolved = foldersQuery.isSuccess && !foldersQuery.isPlaceholderData
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const memberById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.userId, member])),
    [membersQuery.data]
  )
  const tableById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables])
  const descendants = useMemo(() => descendantIndex(folders), [folders])
  const [folderId, setFolderId] = useFolderParam(foldersResolved ? folderById : null)
  const pinnedTables = usePinnedIds(workspaceId, 'table')
  const pinnedFolders = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const createTable = useCreateTable(workspaceId)
  const renameTable = useRenameTable(workspaceId)
  const deleteTable = useDeleteTable(workspaceId)
  const bulkMove = useBulkMoveTables(workspaceId)
  const bulkDelete = useBulkDeleteTables(workspaceId)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()

  const [filters, setFilters] = useQueryStates(tablesParsers, tablesUrlKeys)
  const { sort, dir, onSort: applySort } = useUrlSort(tablesSortParams, tablesUrlKeys)
  const preference = useMemo(
    () => ({
      sort: { column: sort, direction: dir },
      filters: { rows: filters.rows, owner: filters.owner },
    }),
    [sort, dir, filters.rows, filters.owner]
  )
  const preferences = useResourceListPreferences({
    workspaceId,
    config: tablesListPreferenceConfig,
    preference,
    applyPreference: useCallback(
      (next: ListPreference) => {
        void setFilters({
          rows: [...(next.filters.rows ?? [])],
          owner: [...(next.filters.owner ?? [])],
        })
        applySort(next.sort.column, next.sort.direction)
      },
      [applySort, setFilters]
    ),
  })
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const search = useSearchFilterValue(filters.search, SEARCH_DEBOUNCE_MS)
  const searching = search.trim().length > 0
  const filtered = filters.rows.length > 0 || filters.owner.length > 0

  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<ResourceFolder | null>(null)

  const openFolder = useCallback(
    (id: string | null) => {
      setSearch('')
      setFolderId(id)
    },
    [setFolderId, setSearch]
  )

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const row = parseRowId(rowId)
      if (row.kind === 'folder')
        return updateFolder
          .mutateAsync({ workspaceId, resourceType: 'table', id: row.id, updates: { name } })
          .catch((error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to rename folder'))
            throw error
          })
      return renameTable.mutateAsync({ tableId: row.id, name })
    },
  })

  const items = useMemo(() => {
    const parentOfTable = (table: TableDefinition) => {
      const parent = table.folderId ?? null
      return !foldersResolved || !parent || folderById.has(parent) ? parent : null
    }
    const shownFolders = scopeItems(folders, {
      folderId,
      search,
      parentOf: (folder) => folder.parentId ?? null,
      searchText: (folder) => [folder.name],
    })
    const shownTables = scopeItems(tables, {
      folderId,
      search,
      parentOf: parentOfTable,
      searchText: (table) => [table.name],
    }).filter(
      (table) =>
        (!filters.rows.length ||
          (filters.rows.includes('empty') && table.rowCount === 0) ||
          (filters.rows.includes('small') && table.rowCount >= 1 && table.rowCount <= 100) ||
          (filters.rows.includes('large') && table.rowCount > 100)) &&
        (!filters.owner.length || filters.owner.includes(table.createdBy))
    )
    const pinsLead = !searching && !filtered
    const ownerName = (userId: string) => memberById.get(userId)?.name ?? null
    const entries: SortEntry<Item>[] = [
      ...shownFolders.map((folder) => ({
        item: { kind: 'folder' as const, folder },
        pinned: pinsLead && pinnedFolders.has(folder.id),
        name: folder.name,
        key:
          sort === 'columns' || sort === 'rows'
            ? null
            : sort === 'created'
              ? timeOf(folder.createdAt)
              : sort === 'updated'
                ? timeOf(folder.updatedAt)
                : sort === 'owner'
                  ? ownerName(folder.userId)
                  : folder.name,
      })),
      ...shownTables.map((table) => ({
        item: { kind: 'table' as const, table },
        pinned: pinsLead && pinnedTables.has(table.id),
        name: table.name,
        key:
          sort === 'columns'
            ? table.schema.columns.length
            : sort === 'rows'
              ? table.rowCount
              : sort === 'created'
                ? timeOf(table.createdAt)
                : sort === 'updated'
                  ? timeOf(table.updatedAt)
                  : sort === 'owner'
                    ? ownerName(table.createdBy)
                    : table.name,
      })),
    ]
    return sortEntries(entries, dir).map((entry) => entry.item)
  }, [
    folders,
    tables,
    folderId,
    search,
    searching,
    filtered,
    filters.rows,
    filters.owner,
    folderById,
    foldersResolved,
    memberById,
    pinnedFolders,
    pinnedTables,
    sort,
    dir,
  ])

  const rowIds = useMemo(
    () =>
      items.map((item) => (item.kind === 'folder' ? folderRowId(item.folder.id) : item.table.id)),
    [items]
  )
  const requestBulkDelete = () => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    if (!folderIds.length && !resourceIds.length) return
    if (folderIds.length + resourceIds.length > MAX_TABLE_BATCH_ITEMS) {
      toast.error(`Select ${MAX_TABLE_BATCH_ITEMS} or fewer items to delete at once`)
      return
    }
    setConfirm({
      kind: 'bulk',
      tableIds: resourceIds,
      folderIds,
      name: selectionName(
        folderIds.length + resourceIds.length,
        resourceIds.length
          ? tableById.get(resourceIds[0])?.name
          : folderById.get(folderIds[0])?.name
      ),
    })
  }
  const selection = useResourceSelection({
    rowIds,
    onDelete: canEdit ? requestBulkDelete : undefined,
    keyboardBlocked: listRename.editingId !== null || confirm !== null,
  })

  const moveRows = (move: RowMove, target: string | null) => {
    const tableIds = move.resourceIds.filter(
      (id) => (tableById.get(id)?.folderId ?? null) !== target
    )
    const folderIds = move.folderIds.filter(
      (id) => (folderById.get(id)?.parentId ?? null) !== target
    )
    if (!tableIds.length && !folderIds.length) return
    if (tableIds.length + folderIds.length > MAX_TABLE_BATCH_ITEMS) {
      toast.error(`Select ${MAX_TABLE_BATCH_ITEMS} or fewer items to move at once`)
      return
    }
    bulkMove.mutate(
      { tableIds, folderIds, targetFolderId: target },
      {
        onSuccess: (result) => {
          selection.clear()
          reportBulkOutcome(result, 'moved')
        },
      }
    )
  }

  const drag = useResourceDrag({
    mime: ROW_MIME,
    enabled: canEdit,
    renamingId: listRename.editingId,
    rowIds,
    selection: canEdit ? selection : undefined,
    parentOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? folderById.get(row.id)?.parentId
        : tableById.get(row.id)?.folderId
    },
    descendants,
    labelOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? (folderById.get(row.id)?.name ?? 'Folder')
        : (tableById.get(row.id)?.name ?? 'Table')
    },
    onMove: moveRows,
    currentFolderId: folderId,
    bodyFolderId: searching ? undefined : folderId,
    onNavigate: (id, options) => setFolderId(id, options),
  })

  const handleCreateTable = async () => {
    try {
      const result = await createTable.mutateAsync({
        name: generateUniqueTableName(tables.map((table) => table.name)),
        folderId,
        schema: { columns: [{ name: 'name', type: 'string' }] },
        initialRowCount: 1,
      })
      const tableId = result?.data?.table?.id
      if (tableId) router.push(tableHref(tableId))
    } catch {
      // The create mutation raises its own failure toast.
    }
  }

  const handleCreateFolder = async () => {
    try {
      const folder = await createFolder.mutateAsync({
        workspaceId,
        resourceType: 'table',
        name: nextFolderName(folders, folderId),
        parentId: folderId ?? undefined,
      })
      setSearch('')
      listRename.startRename(folderRowId(folder.id), folder.name)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create folder'))
    }
  }

  const tableHref = (tableId: string) =>
    platformHref(
      `${workspacePath(workspaceId, 'tables')}/${encodeURIComponent(tableId)}`,
      searchParams
    )

  const togglePin = (resourceType: 'table' | 'folder', id: string, pinned: boolean) =>
    (pinned ? unpinItem : pinItem).mutate({ workspaceId, resourceType, resourceId: id })

  const copyId = (id: string) => {
    void navigator.clipboard.writeText(id).catch(() => toast.error('Failed to copy ID'))
  }

  const exportCsv = async (table: TableDefinition) => {
    try {
      if ((await exportTable(workspaceId, table.id)) === 'processing')
        toast.success('Export started')
    } catch {
      toast.error('Failed to export table')
    }
  }

  const selectionMove = (excludeFolders: readonly string[]): MenuAction => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    return {
      id: 'move',
      label: selectionAction('Move', selection.selected.size, 'Move to'),
      icon: 'I100',
      children: moveDestinations({
        folders,
        rootLabel: ROOT_LABEL,
        exclude: excludeFolders,
        descendants,
        onMove: (target) => moveRows({ folderIds, resourceIds }, target),
      }),
    }
  }

  const multiActions = (): MenuAction[] => {
    const { folderIds } = splitRowIds(selection.selected)
    const count = selection.selected.size
    return [
      selectionMove(folderIds),
      {
        id: 'delete',
        label: selectionAction('Delete', count),
        icon: 'I061',
        destructive: true,
        separatorBefore: true,
        onSelect: requestBulkDelete,
      },
    ]
  }

  const tableActions = (table: TableDefinition): MenuAction[] => {
    if (selection.selected.size > 1 && selection.selected.has(table.id)) return multiActions()
    const pinned = pinnedTables.has(table.id)
    return [
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        disabled: !canEdit,
        onSelect: () => listRename.startRename(table.id, table.name),
      },
      {
        id: 'export',
        label: 'Export CSV',
        icon: 'I049',
        onSelect: () => void exportCsv(table),
      },
      ...(canEdit
        ? [
            {
              id: 'move',
              label: 'Move to',
              icon: 'I100' as const,
              children: moveDestinations({
                folders,
                rootLabel: ROOT_LABEL,
                onMove: (target) => moveRows({ folderIds: [], resourceIds: [table.id] }, target),
              }),
            },
          ]
        : []),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('table', table.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(table.id) },
      {
        id: 'delete',
        label: 'Delete',
        icon: 'I061',
        destructive: true,
        separatorBefore: true,
        disabled: !canEdit,
        onSelect: () => setConfirm({ kind: 'table', table }),
      },
    ]
  }

  const folderActions = (folder: ResourceFolder, inList: boolean): MenuAction[] => {
    if (inList && selection.selected.size > 1 && selection.selected.has(folderRowId(folder.id)))
      return multiActions()
    const pinned = pinnedFolders.has(folder.id)
    return [
      ...(inList
        ? [
            {
              id: 'open',
              label: 'Open',
              icon: 'eye' as const,
              onSelect: () => openFolder(folder.id),
            },
          ]
        : []),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('folder', folder.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(folder.id) },
      ...(canEdit
        ? [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'I036' as const,
              onSelect: () =>
                inList
                  ? listRename.startRename(folderRowId(folder.id), folder.name)
                  : setRenamingFolder(folder),
            },
            ...(inList
              ? [
                  {
                    id: 'move',
                    label: 'Move to',
                    icon: 'I100' as const,
                    children: moveDestinations({
                      folders,
                      rootLabel: ROOT_LABEL,
                      exclude: [folder.id],
                      descendants,
                      onMove: (target) =>
                        moveRows({ folderIds: [folder.id], resourceIds: [] }, target),
                    }),
                  },
                ]
              : []),
            {
              id: 'delete',
              label: 'Delete',
              icon: 'I061' as const,
              destructive: true,
              separatorBefore: true,
              onSelect: () => setConfirm({ kind: 'folder', folder }),
            },
          ]
        : []),
    ]
  }

  const rows: ResourceRow[] = items.map((item) => {
    if (item.kind === 'folder') {
      const { folder } = item
      const owner = memberById.get(folder.userId)
      return {
        id: folderRowId(folder.id),
        name: folder.name,
        icon: 'I100',
        folder: true,
        pinned: pinnedFolders.has(folder.id),
        onOpen: () => openFolder(folder.id),
        cells: {
          created: formatRelativeTime(timeOf(folder.createdAt), now),
          owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
          updated: formatRelativeTime(timeOf(folder.updatedAt), now),
          location: searching && folderLocation(folderById, folder.parentId, ROOT_LABEL),
        },
      }
    }
    const { table } = item
    const owner = memberById.get(table.createdBy)
    return {
      id: table.id,
      name: table.name,
      icon: 'I033',
      pinned: pinnedTables.has(table.id),
      href: tableHref(table.id),
      cells: {
        columns: table.schema.columns.length.toLocaleString(),
        rows: table.rowCount.toLocaleString(),
        created: formatRelativeTime(timeOf(table.createdAt), now),
        owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
        updated: formatRelativeTime(timeOf(table.updatedAt), now),
        location: searching && folderLocation(folderById, table.folderId, ROOT_LABEL),
      },
    }
  })

  const clearFilters = () => {
    preferences.clearFilters()
  }
  const memberOptions = (membersQuery.data ?? []).map((member) => ({
    value: member.userId,
    label: member.name,
  }))
  const currentFolder = folderId ? folderById.get(folderId) : undefined
  const chain = folderPath(folderById, folderId)
  const hrefFor = (id: string | null) => folderHref(pathname, searchParams, id)

  const newFolderAction: MenuAction = {
    id: 'new-folder',
    label: 'New folder',
    icon: 'I100',
    disabled: !canEdit || createFolder.isPending,
    onSelect: () => void handleCreateFolder(),
  }
  const newTableAction: MenuAction = {
    id: 'new-table',
    label: 'New table',
    icon: 'I074',
    disabled: !canEdit || createTable.isPending,
    onSelect: () => void handleCreateTable(),
  }

  usePageCommands(
    canEdit && !access.hidden
      ? [
          {
            id: 'tables-new-table',
            label: 'New table',
            run: () => {
              if (!createTable.isPending) void handleCreateTable()
            },
          },
          {
            id: 'tables-new-folder',
            label: 'New folder',
            run: () => {
              if (!createFolder.isPending) void handleCreateFolder()
            },
          },
        ]
      : []
  )

  const controls = !access.hidden && (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search tables'
          placeholder='Search tables…'
          value={filters.search}
          onValueChange={setSearch}
        />
      }
      trail={
        <Breadcrumbs
          label='Location'
          items={folderTrail({
            rootLabel: ROOT_LABEL,
            chain,
            hrefFor,
            currentActions: currentFolder && folderActions(currentFolder, false),
            drop: drag.crumb,
          })}
        />
      }
    >
      {filtered && (
        <Button variant='quiet' size='compact' onClick={clearFilters}>
          Clear filters
        </Button>
      )}
      <ActionMenu
        label='Row count'
        triggerText={filterSummary(ROW_COUNTS, filters.rows, 'All rows', 'row counts')}
        actions={filterActions({
          choices: ROW_COUNTS,
          selected: filters.rows,
          onChange: (next) => preferences.setFilter('rows', next),
        })}
      />
      {memberOptions.length > 0 && (
        <MultiSelect
          variant='text'
          label='Owner'
          labelHidden
          options={memberOptions}
          value={filters.owner}
          onValueChange={(next) => preferences.setFilter('owner', next)}
          placeholder='All owners'
          searchLabel='Search members'
        />
      )}
      <ActionMenu
        label='Sort tables'
        icon='I050'
        tooltip
        align='end'
        actions={sortActions({ columns: SORTS, sort, dir, onSort: preferences.setSort })}
      />
      <Button
        variant='quiet'
        size='compact'
        icon='I100'
        disabled={!canEdit || createFolder.isPending}
        onClick={() => void handleCreateFolder()}
      >
        New folder
      </Button>
      <Button
        variant='secondary'
        size='compact'
        icon='I074'
        disabled={!canEdit || createTable.isPending}
        onClick={() => void handleCreateTable()}
      >
        New table
      </Button>
    </ControlBar>
  )

  const read: WorkspaceRead = tablesQuery.isError
    ? {
        status: 'error',
        message: 'Tables could not be loaded.',
        retrying: tablesQuery.isFetching,
        onRetry: () => void tablesQuery.refetch(),
      }
    : !access.settled ||
        (!access.hidden && (tablesQuery.isPending || !foldersResolved || !preferences.isReady))
      ? { status: 'pending' }
      : { status: 'ready' }

  const empty =
    searching || filtered ? (
      <WorkspaceEmpty
        title={noResults(search, filtered).title}
        description={noResults(search, filtered).description}
        action={{
          label: noResults(search, filtered).action,
          onClick: () => {
            setSearch('')
            clearFilters()
          },
        }}
      />
    ) : folderId ? (
      <WorkspaceEmpty title='This folder is empty' />
    ) : (
      <WorkspaceEmpty
        title='No tables yet'
        description='Create a table to store structured data your agents can read and write.'
      />
    )

  return (
    <LiveWorkspacePage workspaceId={workspaceId} current='tables' controls={controls} read={read}>
      {access.hidden ? (
        <AccessRequired
          workspaceId={workspaceId}
          gate='hideTablesTab'
          refreshing={access.refreshing}
          onRefresh={access.refresh}
        />
      ) : (
        <ResourceTable
          label='Tables'
          columns={searching ? SEARCH_COLUMNS : COLUMNS}
          rows={rows}
          rowActions={(row) => {
            const parsed = parseRowId(row.id)
            if (parsed.kind === 'folder') {
              const folder = folderById.get(parsed.id)
              return folder ? folderActions(folder, true) : []
            }
            const table = tableById.get(parsed.id)
            return table ? tableActions(table) : []
          }}
          backgroundActions={[newFolderAction, newTableAction]}
          selection={canEdit ? selection : undefined}
          bulkActions={
            canEdit
              ? [
                  selectionMove(splitRowIds(selection.selected).folderIds),
                  {
                    id: 'delete',
                    label: 'Delete',
                    icon: 'I061',
                    destructive: true,
                    disabled: bulkMove.isPending || bulkDelete.isPending,
                    onSelect: requestBulkDelete,
                  },
                ]
              : undefined
          }
          bulkLimit={MAX_TABLE_BATCH_ITEMS}
          rename={
            listRename.editingId
              ? {
                  rowId: listRename.editingId,
                  value: listRename.editValue,
                  saving: listRename.isSaving,
                  onChange: listRename.setEditValue,
                  onSubmit: () => void listRename.submitRename(),
                  onCancel: listRename.cancelRename,
                }
              : null
          }
          drag={drag}
          empty={empty}
        />
      )}
      <ConfirmDialog
        target={confirm}
        onClose={() => setConfirm(null)}
        title={(target) =>
          target.kind === 'table'
            ? 'Delete table'
            : target.kind === 'folder'
              ? 'Delete folder'
              : 'Delete selected'
        }
        description={(target) =>
          target.kind === 'table'
            ? `Are you sure you want to delete ${target.table.name}? All ${target.table.rowCount.toLocaleString()} rows will be removed. You can restore it from Recently Deleted in Settings.`
            : target.kind === 'folder'
              ? `Are you sure you want to delete ${target.folder.name}? Every table and subfolder inside it will be deleted too. You can restore those tables from Recently Deleted in Settings.`
              : `Are you sure you want to delete ${target.name}? ${
                  target.folderIds.length
                    ? 'Every table and subfolder inside the selected folders will be deleted too.'
                    : 'All of their rows will be removed.'
                } You can restore those tables from Recently Deleted in Settings.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          if (target.kind === 'table') {
            await deleteTable.mutateAsync(target.table.id)
            return
          }
          if (target.kind === 'folder') {
            await deleteFolder.mutateAsync({
              workspaceId,
              resourceType: 'table',
              id: target.folder.id,
            })
            if (folderId === target.folder.id)
              setFolderId(target.folder.parentId, { history: 'replace' })
            return
          }
          const result = await bulkDelete.mutateAsync({
            tableIds: target.tableIds,
            folderIds: target.folderIds,
          })
          selection.clear()
          reportBulkOutcome(result, 'deleted')
        }}
      />
      <RenameDialog
        target={renamingFolder}
        noun='folder'
        onClose={() => setRenamingFolder(null)}
        onRename={(id, name) =>
          updateFolder.mutateAsync({ workspaceId, resourceType: 'table', id, updates: { name } })
        }
      />
    </LiveWorkspacePage>
  )
}
