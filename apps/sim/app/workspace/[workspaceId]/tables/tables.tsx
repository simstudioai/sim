'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComboboxOption } from '@sim/emcn'
import { ChipCombobox, ChipConfirmModal, Plus, toast, Upload } from '@sim/emcn'
import { Columns3, FolderPlus, Rows3, Table as TableIcon } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { TableDefinition } from '@/lib/table'
import { CSV_ASYNC_IMPORT_THRESHOLD_BYTES, generateUniqueTableName } from '@/lib/table/constants'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type {
  DropdownOption,
  FilterTag,
  ResourceAction,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  EMPTY_CELL_PLACEHOLDER,
  ownerCell,
  Resource,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import {
  buildDescendantIndex,
  buildMoveOptions,
  FolderContextMenu,
  folderBreadcrumbItems,
  folderRow,
  folderRowId,
  nextUntitledFolderName,
  parseFolderedRowId,
  parseMoveOptionValue,
  useFolderNavigation,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  ImportCsvDialog,
  ImportProgressMenu,
  TablesListContextMenu,
} from '@/app/workspace/[workspaceId]/tables/components'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import {
  tablesParsers,
  tablesSortParams,
  tablesUrlKeys,
} from '@/app/workspace/[workspaceId]/tables/search-params'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useCreateFolder, useDeleteFolderMutation, useUpdateFolder } from '@/hooks/queries/folders'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/hooks/queries/pinned-items'
import {
  cancelTableJob,
  downloadTableExport,
  useCreateTable,
  useDeleteTable,
  useImportCsvAsync,
  useMoveTable,
  useRenameTable,
  useTablesList,
  useUploadCsvToTable,
} from '@/hooks/queries/tables'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useUrlSort } from '@/hooks/use-url-sort'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const logger = createLogger('Tables')

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'columns', header: 'Columns' },
  { id: 'rows', header: 'Rows' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

/** Root label for breadcrumbs and the "move to workspace root" destination. */
const ROOT_LABEL = 'Tables'

const EMPTY_TABLES: TableDefinition[] = []

/** The right-clicked row, resolved to the entity it refers to. */
type TableResourceItem =
  | { kind: 'table'; table: TableDefinition }
  | { kind: 'folder'; folder: WorkflowFolder }

export function Tables() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { config: permissionConfig } = usePermissionConfig()
  useEffect(() => {
    if (permissionConfig.hideTablesTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideTablesTab, router, workspaceId])

  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true

  const { data: tables = EMPTY_TABLES, error } = useTablesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const pinnedTableIds = usePinnedIds(workspaceId, 'table')
  // Folder pins live in their own `resourceType` namespace, so a page listing
  // folders alongside tables resolves two sets.
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const {
    currentFolderId,
    setCurrentFolderId,
    breadcrumbs: folderChain,
    folders,
    folderById,
    isLoading: foldersLoading,
  } = useFolderNavigation({
    resourceType: 'table',
    workspaceId,
  })

  if (error) {
    logger.error('Failed to load tables:', error)
  }
  const deleteTable = useDeleteTable(workspaceId)
  const renameTable = useRenameTable(workspaceId)
  const createTable = useCreateTable(workspaceId)
  const moveTable = useMoveTable(workspaceId)
  const uploadCsv = useUploadCsvToTable()
  const importCsvAsync = useImportCsvAsync()
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()

  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) map.set(member.userId, member)
    return map
  }, [members])

  /**
   * One rename session multiplexed over both row kinds — the shared `Resource`
   * table has a single editing cell, so the id it carries has to resolve to
   * either a folder or a table. Both mutations toast their own failure; the hook
   * restores the original name and keeps the field open.
   */
  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        return updateFolder
          .mutateAsync({
            workspaceId,
            resourceType: 'table',
            id: parsed.id,
            updates: { name },
          })
          .catch((err: unknown) => {
            toast.error(getErrorMessage(err, 'Failed to rename folder'), { duration: 5000 })
            throw err
          })
      }
      return renameTable.mutateAsync({ tableId: parsed.id, name })
    },
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) =>
      updateFolder
        .mutateAsync({ workspaceId, resourceType: 'table', id: folderId, updates: { name } })
        .catch((err: unknown) => {
          toast.error(getErrorMessage(err, 'Failed to rename folder'), { duration: 5000 })
          throw err
        }),
  })

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleteFolderDialogOpen, setIsDeleteFolderDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)
  const [activeFolder, setActiveFolder] = useState<WorkflowFolder | null>(null)

  const [{ search: urlSearchTerm, rows: rowCountFilter, owner: ownerFilter }, setTableFilters] =
    useQueryStates(tablesParsers, tablesUrlKeys)

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort,
    onClear,
  } = useUrlSort(tablesSortParams, tablesUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below still reads a debounced value
   * so it doesn't recompute on every keystroke.
   */
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setTableFilters({ search: value }, options)
  )
  const debouncedSearchTerm = useDebounce(urlSearchTerm, SEARCH_DEBOUNCE_MS)

  const setRowCountFilter = useCallback(
    (next: string[]) => setTableFilters({ rows: next }),
    [setTableFilters]
  )
  const setOwnerFilter = useCallback(
    (next: string[]) => setTableFilters({ owner: next }),
    [setTableFilters]
  )

  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const uploading = uploadProgress.total > 0
  const csvInputRef = useRef<HTMLInputElement>(null)

  const tablesRef = useRef(tables)
  tablesRef.current = tables

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const [contextMenuKind, setContextMenuKind] = useState<'table' | 'folder'>('table')

  /**
   * Descendants of every folder, so a move destination that sits inside the moved folder can
   * be excluded — reparenting a folder under its own child would close a cycle (the server
   * rejects it; this keeps it out of the menu, and out of a valid drop target, entirely).
   */
  const descendantFolderIds = useMemo(() => buildDescendantIndex(folders), [folders])

  const visibleFolders = useMemo(() => {
    const siblings = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
    const needle = debouncedSearchTerm.trim().toLowerCase()
    const searched = needle
      ? siblings.filter((folder) => folder.name.toLowerCase().includes(needle))
      : siblings

    return [...searched].sort((a, b) => {
      // Pinned folders float to the top of every sort/direction — pinning is a
      // user-declared priority, not another sort key to be inverted by `desc`.
      const aPinned = pinnedFolderIds.has(a.id)
      const bPinned = pinnedFolderIds.has(b.id)
      if (aPinned !== bPinned) return aPinned ? -1 : 1

      // Folders carry none of the table-specific columns, so `columns`/`rows`/
      // `owner` fall back to name rather than producing an arbitrary order.
      let cmp = 0
      if (sortColumn === 'created') {
        cmp = a.createdAt.getTime() - b.createdAt.getTime()
      } else if (sortColumn === 'updated') {
        cmp = a.updatedAt.getTime() - b.updatedAt.getTime()
      } else {
        cmp = a.name.localeCompare(b.name)
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [folders, currentFolderId, debouncedSearchTerm, sortColumn, sortDirection, pinnedFolderIds])

  const processedTables = useMemo(() => {
    const query = debouncedSearchTerm.trim().toLowerCase()
    /**
     * A `folderId` that no longer names an active folder — restored on its own out
     * of Recently Deleted while its folder stayed archived — would otherwise match
     * no level at all and leave the table unreachable from every view. Fall it back
     * to the root instead. Skipped while the folder list is still loading, when an
     * empty index would transiently drag every table to the root.
     */
    let result = tables.filter((t) => {
      const folderId = t.folderId ?? null
      const effectiveFolderId =
        foldersLoading || !folderId || folderById.has(folderId) ? folderId : null
      return effectiveFolderId === currentFolderId
    })
    if (query) result = result.filter((t) => t.name.toLowerCase().includes(query))

    if (rowCountFilter.length > 0) {
      result = result.filter((t) => {
        if (rowCountFilter.includes('empty') && t.rowCount === 0) return true
        if (rowCountFilter.includes('small') && t.rowCount >= 1 && t.rowCount <= 100) return true
        if (rowCountFilter.includes('large') && t.rowCount > 100) return true
        return false
      })
    }
    if (ownerFilter.length > 0) {
      result = result.filter((t) => ownerFilter.includes(t.createdBy))
    }
    return [...result].sort((a, b) => {
      // Pinned tables float to the top of every sort/direction — pinning is a
      // user-declared priority, not another sort key to be inverted by `desc`.
      const aPinned = pinnedTableIds.has(a.id)
      const bPinned = pinnedTableIds.has(b.id)
      if (aPinned !== bPinned) return aPinned ? -1 : 1

      let cmp = 0
      switch (sortColumn) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'columns':
          cmp = a.schema.columns.length - b.schema.columns.length
          break
        case 'rows':
          cmp = a.rowCount - b.rowCount
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'owner': {
          const aName = membersById.get(a.createdBy)?.name ?? ''
          const bName = membersById.get(b.createdBy)?.name ?? ''
          cmp = aName.localeCompare(bName)
          break
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [
    tables,
    currentFolderId,
    folderById,
    foldersLoading,
    debouncedSearchTerm,
    rowCountFilter,
    ownerFilter,
    sortColumn,
    sortDirection,
    membersById,
    pinnedTableIds,
  ])

  /**
   * Folders first, then tables — folders are containers, so keeping them above
   * the leaves survives every sort column and direction.
   */
  const baseRows: ResourceRow[] = useMemo(() => {
    const folderRows = visibleFolders.map((folder) =>
      folderRow(folder, {
        pinned: pinnedFolderIds.has(folder.id),
        cells: {
          columns: { label: EMPTY_CELL_PLACEHOLDER },
          rows: { label: EMPTY_CELL_PLACEHOLDER },
          created: timeCell(folder.createdAt),
          owner: ownerCell(folder.userId, membersById),
          updated: timeCell(folder.updatedAt),
        },
      })
    )

    const tableRows = processedTables.map(
      (table): ResourceRow => ({
        id: table.id,
        cells: {
          name: {
            icon: <TableIcon className='size-[14px]' />,
            label: table.name,
            pinned: pinnedTableIds.has(table.id),
          },
          columns: {
            icon: <Columns3 className='size-[14px]' />,
            label: String(table.schema.columns.length),
          },
          rows: {
            icon: <Rows3 className='size-[14px]' />,
            label: String(table.rowCount),
          },
          created: timeCell(table.createdAt),
          owner: ownerCell(table.createdBy, membersById),
          updated: timeCell(table.updatedAt),
        },
      })
    )

    return [...folderRows, ...tableRows]
  }, [visibleFolders, processedTables, membersById, pinnedFolderIds, pinnedTableIds])

  /**
   * Layered on top of {@link baseRows} rather than folded into it so a keystroke
   * in the rename field rebuilds one cell instead of every row's cells.
   */
  const rows: ResourceRow[] = useMemo(() => {
    if (!listRename.editingId) return baseRows
    return baseRows.map((row) => {
      if (row.id !== listRename.editingId) return row
      return {
        ...row,
        cells: {
          ...row.cells,
          name: {
            ...row.cells.name,
            editing: {
              value: listRename.editValue,
              onChange: listRename.setEditValue,
              onSubmit: listRename.submitRename,
              onCancel: listRename.cancelRename,
              disabled: listRename.isSaving,
            },
          },
        },
      }
    })
  }, [
    baseRows,
    listRename.editingId,
    listRename.editValue,
    listRename.isSaving,
    listRename.setEditValue,
    listRename.submitRename,
    listRename.cancelRename,
  ])

  const startFolderRename = useCallback(
    (folder: WorkflowFolder) => listRename.startRename(folderRowId(folder.id), folder.name),
    [listRename.startRename]
  )

  const currentFolderActions: DropdownOption[] | undefined = useMemo(() => {
    if (!currentFolderId) return undefined
    const folder = folderById.get(currentFolderId)
    if (!folder) return undefined
    return [
      {
        label: 'Rename',
        disabled: !canEdit,
        onClick: () => breadcrumbRename.startRename(folder.id, folder.name),
      },
    ]
  }, [currentFolderId, folderById, canEdit, breadcrumbRename.startRename])

  const currentFolderEditing = useMemo(() => {
    if (!currentFolderId || breadcrumbRename.editingId !== currentFolderId) return undefined
    return {
      isEditing: true,
      value: breadcrumbRename.editValue,
      onChange: breadcrumbRename.setEditValue,
      onSubmit: breadcrumbRename.submitRename,
      onCancel: breadcrumbRename.cancelRename,
      disabled: breadcrumbRename.isSaving,
    }
  }, [
    currentFolderId,
    breadcrumbRename.editingId,
    breadcrumbRename.editValue,
    breadcrumbRename.isSaving,
    breadcrumbRename.setEditValue,
    breadcrumbRename.submitRename,
    breadcrumbRename.cancelRename,
  ])

  const breadcrumbs = useMemo(
    () =>
      folderBreadcrumbItems({
        breadcrumbs: folderChain,
        rootLabel: ROOT_LABEL,
        onNavigate: setCurrentFolderId,
        currentFolderActions,
        currentFolderEditing,
      }),
    [folderChain, setCurrentFolderId, currentFolderActions, currentFolderEditing]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: urlSearchTerm,
      onChange: setSearchTerm,
      onClearAll: () => setSearchTerm(''),
      placeholder: 'Search tables...',
    }),
    [urlSearchTerm, setSearchTerm]
  )

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'name', label: 'Name' },
        { id: 'columns', label: 'Columns' },
        { id: 'rows', label: 'Rows' },
        { id: 'created', label: 'Created' },
        { id: 'owner', label: 'Owner' },
        { id: 'updated', label: 'Last Updated' },
      ],
      active: activeSort,
      onSort,
      onClear,
    }),
    [activeSort, onSort, onClear]
  )

  const rowCountDisplayLabel = useMemo(() => {
    if (rowCountFilter.length === 0) return 'All'
    if (rowCountFilter.length === 1) {
      const labels: Record<string, string> = {
        empty: 'Empty',
        small: 'Small (1–100)',
        large: 'Large (101+)',
      }
      return labels[rowCountFilter[0]] ?? rowCountFilter[0]
    }
    return `${rowCountFilter.length} selected`
  }, [rowCountFilter])

  const ownerDisplayLabel = useMemo(() => {
    if (ownerFilter.length === 0) return 'All'
    if (ownerFilter.length === 1) return membersById.get(ownerFilter[0])?.name ?? '1 member'
    return `${ownerFilter.length} members`
  }, [ownerFilter, membersById])

  const memberOptions: ComboboxOption[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.name,
        iconElement: m.image ? (
          <img
            src={m.image}
            alt={m.name}
            referrerPolicy='no-referrer'
            className='size-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex size-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
            {m.name.charAt(0).toUpperCase()}
          </span>
        ),
      })),
    [members]
  )

  const hasActiveFilters = rowCountFilter.length > 0 || ownerFilter.length > 0

  const filterContent = useMemo(
    () => (
      <div className='flex w-[240px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>Row Count</span>
          <ChipCombobox
            options={[
              { value: 'empty', label: 'Empty' },
              { value: 'small', label: 'Small (1–100 rows)' },
              { value: 'large', label: 'Large (101+ rows)' },
            ]}
            multiSelect
            multiSelectValues={rowCountFilter}
            onMultiSelectChange={setRowCountFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{rowCountDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All'
            className='w-full'
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>Owner</span>
            <ChipCombobox
              options={memberOptions}
              multiSelect
              multiSelectValues={ownerFilter}
              onMultiSelectChange={setOwnerFilter}
              overlayContent={
                <span className='truncate text-[var(--text-primary)]'>{ownerDisplayLabel}</span>
              }
              searchable
              searchPlaceholder='Search members...'
              showAllOption
              allOptionLabel='All'
              className='w-full'
            />
          </div>
        )}
        {hasActiveFilters && (
          <button
            type='button'
            onClick={() => {
              setRowCountFilter([])
              setOwnerFilter([])
            }}
            className='flex h-[32px] w-full items-center justify-center rounded-md text-[var(--text-secondary)] text-caption transition-colors hover-hover:bg-[var(--surface-active)]'
          >
            Clear all filters
          </button>
        )}
      </div>
    ),
    [
      rowCountFilter,
      ownerFilter,
      memberOptions,
      rowCountDisplayLabel,
      ownerDisplayLabel,
      hasActiveFilters,
      setRowCountFilter,
      setOwnerFilter,
    ]
  )

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (rowCountFilter.length > 0) {
      const rowLabels: Record<string, string> = { empty: 'Empty', small: 'Small', large: 'Large' }
      const label =
        rowCountFilter.length === 1
          ? `Rows: ${rowLabels[rowCountFilter[0]]}`
          : `Rows: ${rowCountFilter.length} selected`
      tags.push({ label, onRemove: () => setRowCountFilter([]) })
    }
    if (ownerFilter.length > 0) {
      const label =
        ownerFilter.length === 1
          ? `Owner: ${membersById.get(ownerFilter[0])?.name ?? '1 member'}`
          : `Owner: ${ownerFilter.length} members`
      tags.push({ label, onRemove: () => setOwnerFilter([]) })
    }
    return tags
  }, [rowCountFilter, ownerFilter, membersById, setRowCountFilter, setOwnerFilter])

  const handleContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-resource-row]') ||
        target.closest('button, input, a, [role="button"]')
      ) {
        return
      }
      handleListContextMenu(e)
    },
    [handleListContextMenu]
  )

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpen || listRename.editingId === rowId) return
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        setCurrentFolderId(parsed.id)
        return
      }
      router.push(`/workspace/${workspaceId}/tables/${parsed.id}`)
    },
    [isRowContextMenuOpen, listRename.editingId, router, workspaceId, setCurrentFolderId]
  )

  const resolveRowItem = useCallback(
    (rowId: string): TableResourceItem | null => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        const folder = folderById.get(parsed.id)
        return folder ? { kind: 'folder', folder } : null
      }
      const table = tables.find((t) => t.id === parsed.id)
      return table ? { kind: 'table', table } : null
    },
    [folderById, tables]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const item = resolveRowItem(rowId)
      if (!item) return
      if (item.kind === 'folder') {
        setActiveFolder(item.folder)
        setActiveTable(null)
        setContextMenuKind('folder')
      } else {
        setActiveTable(item.table)
        setActiveFolder(null)
        setContextMenuKind('table')
      }
      handleRowCtxMenu(e)
    },
    [resolveRowItem, handleRowCtxMenu]
  )

  const tableMoveOptions: MoveOptionNode[] = useMemo(
    () => buildMoveOptions({ folders, rootLabel: ROOT_LABEL }),
    [folders]
  )

  const folderMoveOptions: MoveOptionNode[] = useMemo(() => {
    if (!activeFolder) return []
    const excluded = new Set<string>([activeFolder.id])
    for (const id of descendantFolderIds.get(activeFolder.id) ?? []) excluded.add(id)
    return buildMoveOptions({ folders, rootLabel: ROOT_LABEL, excludedFolderIds: excluded })
  }, [activeFolder, folders, descendantFolderIds])

  const handleMoveTable = useCallback(
    (optionValue: string) => {
      if (!activeTable) return
      const folderId = parseMoveOptionValue(optionValue)
      if ((activeTable.folderId ?? null) === folderId) return
      moveTable.mutate({ tableId: activeTable.id, folderId })
      closeRowContextMenu()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
    [activeTable, closeRowContextMenu]
  )

  /** Shared by the "Move to" submenu and by dropping a folder row onto another folder. */
  const moveFolderTo = useCallback(
    (folderId: string, parentId: string | null) => {
      updateFolder.mutate(
        { workspaceId, resourceType: 'table', id: folderId, updates: { parentId } },
        {
          onError: (err) =>
            toast.error(getErrorMessage(err, 'Failed to move folder'), { duration: 5000 }),
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
    [workspaceId]
  )

  const handleMoveFolder = useCallback(
    (optionValue: string) => {
      if (!activeFolder) return
      const parentId = parseMoveOptionValue(optionValue)
      if ((activeFolder.parentId ?? null) === parentId) return
      moveFolderTo(activeFolder.id, parentId)
      closeRowContextMenu()
    },
    [activeFolder, moveFolderTo, closeRowContextMenu]
  )

  const rowDragDropConfig = useFolderRowDragDrop({
    canEdit,
    editingRowId: listRename.editingId,
    descendantsByFolderId: descendantFolderIds,
    getFolderParentId: (folderId) => folderById.get(folderId)?.parentId ?? null,
    getResourceFolderId: (tableId) =>
      tablesRef.current.find((table) => table.id === tableId)?.folderId ?? null,
    getRowLabel: (rowId) => {
      const parsed = parseFolderedRowId(rowId)
      return parsed.kind === 'folder'
        ? (folderById.get(parsed.id)?.name ?? 'Folder')
        : (tablesRef.current.find((table) => table.id === parsed.id)?.name ?? 'Table')
    },
    onMoveFolder: (folderId, targetFolderId) => moveFolderTo(folderId, targetFolderId),
    onMoveResource: (tableId, targetFolderId) =>
      moveTable.mutate({ tableId, folderId: targetFolderId }),
  })

  const handleDelete = async () => {
    if (!activeTable) return
    try {
      await deleteTable.mutateAsync(activeTable.id)
      setIsDeleteDialogOpen(false)
      setActiveTable(null)
    } catch (err) {
      logger.error('Failed to delete table:', err)
    }
  }

  const handleTogglePin = useCallback(() => {
    const target =
      contextMenuKind === 'folder'
        ? activeFolder && { resourceType: 'folder' as const, id: activeFolder.id }
        : activeTable && { resourceType: 'table' as const, id: activeTable.id }
    if (!target) return
    const pinned =
      target.resourceType === 'folder'
        ? pinnedFolderIds.has(target.id)
        : pinnedTableIds.has(target.id)
    const mutation = pinned ? unpinItem : pinItem
    mutation.mutate({ workspaceId, resourceType: target.resourceType, resourceId: target.id })
    closeRowContextMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
  }, [
    workspaceId,
    contextMenuKind,
    activeFolder,
    activeTable,
    pinnedFolderIds,
    pinnedTableIds,
    closeRowContextMenu,
  ])

  const handleDeleteFolder = async () => {
    if (!activeFolder) return
    try {
      await deleteFolder.mutateAsync({
        workspaceId,
        resourceType: 'table',
        id: activeFolder.id,
      })
      // The open folder just disappeared — fall back to its parent rather than
      // leaving a `?folderId=` pointing at an archived folder.
      if (currentFolderId === activeFolder.id) {
        setCurrentFolderId(activeFolder.parentId)
      }
      setIsDeleteFolderDialogOpen(false)
      setActiveFolder(null)
    } catch (err) {
      logger.error('Failed to delete folder:', err)
      toast.error(getErrorMessage(err, 'Failed to delete folder'), { duration: 5000 })
    }
  }

  const handleCsvChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      if (!list || list.length === 0 || !workspaceId) return

      const csvFiles = Array.from(list).filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase()
        return ext === 'csv' || ext === 'tsv'
      })

      if (csvFiles.length === 0) {
        toast.error('No CSV or TSV files selected')
        if (csvInputRef.current) csvInputRef.current.value = ''
        return
      }

      // Large files can't be POSTed through the server (request-body cap) — upload them
      // straight to storage and import in the background. These are tracked by the import
      // tray, never the header upload button, so don't touch uploading/uploadProgress here.
      const asyncFiles = csvFiles.filter((f) => f.size >= CSV_ASYNC_IMPORT_THRESHOLD_BYTES)
      const syncFiles = csvFiles.filter((f) => f.size < CSV_ASYNC_IMPORT_THRESHOLD_BYTES)

      try {
        for (const file of asyncFiles) {
          // Show the indicator immediately under a temporary id (the real table id doesn't
          // exist until kickoff returns), then let the tray track it. Don't redirect — the
          // table is still empty/importing, so stay on the list.
          const pendingId = `pending_${generateId()}`
          useImportTrayStore
            .getState()
            .startUpload({ uploadId: pendingId, workspaceId, title: file.name })
          toast.success(`Importing "${file.name}" in the background`)
          try {
            const result = await importCsvAsync.mutateAsync({
              workspaceId,
              folderId: currentFolderId,
              file,
              onProgress: (percent) => {
                useImportTrayStore.getState().setUploadPercent(pendingId, percent)
              },
            })
            useImportTrayStore.getState().endUpload(pendingId)
            // The server row drives the tray once the list refetches (mutation invalidates it).
            // If canceled mid-upload, flag the real id so it's not shown and cancel server-side.
            if (
              result?.tableId &&
              result.importId &&
              useImportTrayStore.getState().consumeCanceled(pendingId)
            ) {
              useImportTrayStore.getState().cancel(result.tableId)
              void cancelTableJob(workspaceId, result.tableId, result.importId).catch(() => {})
            }
          } catch {
            // The hook's onError surfaces the toast; just clear the tray indicator here.
            useImportTrayStore.getState().endUpload(pendingId)
          }
        }

        if (syncFiles.length === 0) return

        setUploadProgress({ completed: 0, total: syncFiles.length })
        const failed: string[] = []

        for (let i = 0; i < syncFiles.length; i++) {
          const file = syncFiles[i]
          try {
            const result = await uploadCsv.mutateAsync({
              workspaceId,
              folderId: currentFolderId,
              file,
            })

            if (syncFiles.length === 1 && asyncFiles.length === 0) {
              const tableId = result?.data?.table?.id
              if (tableId) {
                router.push(`/workspace/${workspaceId}/tables/${tableId}`)
              }
            }
          } catch (err) {
            failed.push(file.name)
            logger.error('Error uploading CSV:', err)
          } finally {
            setUploadProgress({ completed: i + 1, total: syncFiles.length })
          }
        }

        if (failed.length > 0) {
          toast.error(
            failed.length === 1
              ? `Failed to import ${failed[0]}`
              : `Failed to import ${failed.length} file${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}`
          )
        }
      } catch (err) {
        logger.error('Error uploading CSV:', err)
        toast.error('Failed to import CSV')
      } finally {
        setUploadProgress({ completed: 0, total: 0 })
        if (csvInputRef.current) {
          csvInputRef.current.value = ''
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutateAsync is stable in v5
    [workspaceId, currentFolderId, router]
  )

  const handleListUploadCsv = useCallback(() => {
    csvInputRef.current?.click()
    closeListContextMenu()
  }, [closeListContextMenu])

  const uploadButtonLabel = uploading
    ? `${uploadProgress.completed}/${uploadProgress.total}`
    : 'Import CSV'

  // `mutateAsync` is stable in TanStack Query v5 — extract it so the callback
  // can list it as a dep instead of the unstable mutation object.
  const createTableAsync = createTable.mutateAsync
  const handleCreateTable = useCallback(async () => {
    const existingNames = tables.map((t) => t.name)
    const name = generateUniqueTableName(existingNames)
    try {
      const result = await createTableAsync({
        name,
        folderId: currentFolderId,
        schema: {
          columns: [{ name: 'name', type: 'string' }],
        },
        initialRowCount: 1,
      })
      const tableId = result?.data?.table?.id
      if (tableId) {
        router.push(`/workspace/${workspaceId}/tables/${tableId}`)
      }
    } catch (err) {
      logger.error('Failed to create table:', err)
    }
  }, [tables, router, workspaceId, currentFolderId, createTableAsync])

  const createFolderAsync = createFolder.mutateAsync
  const handleCreateFolder = useCallback(async () => {
    try {
      const folder = await createFolderAsync({
        workspaceId,
        resourceType: 'table',
        name: nextUntitledFolderName(folders, currentFolderId),
        parentId: currentFolderId ?? undefined,
      })
      startFolderRename(folder)
    } catch (err) {
      logger.error('Failed to create folder:', err)
      toast.error(getErrorMessage(err, 'Failed to create folder'), { duration: 5000 })
    }
  }, [workspaceId, folders, currentFolderId, createFolderAsync, startFolderRename])

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: uploadButtonLabel,
        icon: Upload,
        onSelect: () => csvInputRef.current?.click(),
        disabled: uploading || !canEdit,
      },
      {
        text: 'New folder',
        icon: FolderPlus,
        onSelect: handleCreateFolder,
        disabled: !canEdit || createFolder.isPending,
      },
      {
        text: 'New table',
        icon: Plus,
        onSelect: handleCreateTable,
        disabled: uploading || !canEdit || createTable.isPending,
        variant: 'primary',
      },
    ],
    [
      uploadButtonLabel,
      uploading,
      canEdit,
      handleCreateFolder,
      handleCreateTable,
      createFolder.isPending,
      createTable.isPending,
    ]
  )

  // Stable identities so the memoized Resource.Header / Resource.Options can
  // actually bail — inline object/element props would defeat their memo.
  const headerAside = useMemo(() => <ImportProgressMenu workspaceId={workspaceId} />, [workspaceId])
  const filterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={TableIcon}
          title={ROOT_LABEL}
          breadcrumbs={breadcrumbs}
          actions={headerActions}
          aside={headerAside}
        />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={filterConfig}
        />
        <Resource.Table
          columns={COLUMNS}
          rows={rows}
          rowDragDrop={rowDragDropConfig}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <input
        ref={csvInputRef}
        type='file'
        className='hidden'
        onChange={handleCsvChange}
        disabled={uploading}
        accept='.csv,.tsv'
        multiple
      />

      <TablesListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateTable={handleCreateTable}
        onCreateFolder={handleCreateFolder}
        onUploadCsv={handleListUploadCsv}
        disableCreate={!canEdit || createTable.isPending}
        disableCreateFolder={!canEdit || createFolder.isPending}
        disableUpload={uploading || !canEdit}
      />

      <TableContextMenu
        isOpen={isRowContextMenuOpen && contextMenuKind === 'table'}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onCopyId={() => {
          if (activeTable) navigator.clipboard.writeText(activeTable.id)
        }}
        onDelete={() => setIsDeleteDialogOpen(true)}
        onRename={() => {
          if (activeTable) listRename.startRename(activeTable.id, activeTable.name)
        }}
        onImportCsv={() => setIsImportDialogOpen(true)}
        onExportCsv={async () => {
          if (!activeTable) return
          try {
            await downloadTableExport(activeTable.id, activeTable.name)
          } catch (err) {
            logger.error('Failed to export table:', err)
            toast.error('Failed to export table')
          }
        }}
        onTogglePin={handleTogglePin}
        pinned={activeTable ? pinnedTableIds.has(activeTable.id) : false}
        onMove={canEdit ? handleMoveTable : undefined}
        moveOptions={canEdit ? tableMoveOptions : undefined}
        disableDelete={!canEdit}
        disableRename={!canEdit}
        disableImport={!canEdit}
      />

      <FolderContextMenu
        isOpen={isRowContextMenuOpen && contextMenuKind === 'folder'}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onOpen={() => {
          if (activeFolder) setCurrentFolderId(activeFolder.id)
          closeRowContextMenu()
        }}
        onRename={() => {
          if (activeFolder) startFolderRename(activeFolder)
        }}
        onCopyId={() => {
          if (activeFolder) navigator.clipboard.writeText(activeFolder.id)
        }}
        onDelete={() => setIsDeleteFolderDialogOpen(true)}
        onTogglePin={handleTogglePin}
        pinned={activeFolder ? pinnedFolderIds.has(activeFolder.id) : false}
        onMove={canEdit ? handleMoveFolder : undefined}
        moveOptions={canEdit ? folderMoveOptions : undefined}
        canEdit={canEdit}
      />

      {activeTable && (
        <ImportCsvDialog
          open={isImportDialogOpen}
          onOpenChange={(open) => {
            setIsImportDialogOpen(open)
            if (!open) setActiveTable(null)
          }}
          workspaceId={workspaceId}
          table={activeTable}
        />
      )}

      <ChipConfirmModal
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open)
          if (!open) setActiveTable(null)
        }}
        srTitle='Delete Table'
        title='Delete Table'
        text={[
          'Are you sure you want to delete ',
          { text: activeTable?.name ?? 'this table', bold: true },
          '? ',
          { text: `All ${activeTable?.rowCount ?? 0} rows will be removed.`, error: true },
          ' You can restore it from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteTable.isPending,
          pendingLabel: 'Deleting...',
        }}
      />

      <ChipConfirmModal
        open={isDeleteFolderDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteFolderDialogOpen(open)
          if (!open) setActiveFolder(null)
        }}
        srTitle='Delete Folder'
        title='Delete Folder'
        text={[
          'Are you sure you want to delete ',
          { text: activeFolder?.name ?? 'this folder', bold: true },
          '? ',
          { text: 'Every table and subfolder inside it will be deleted too.', error: true },
          ' You can restore those tables from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDeleteFolder,
          pending: deleteFolder.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
