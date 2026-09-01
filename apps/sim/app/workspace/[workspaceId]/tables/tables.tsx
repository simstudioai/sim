'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComboboxOption } from '@sim/emcn'
import { ChipCombobox, ChipConfirmModal, Plus, toast, Upload } from '@sim/emcn'
import { Columns3, FolderPlus, Pencil, Rows3, Table as TableIcon, Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { TableDefinition } from '@/lib/table'
import { generateUniqueTableName, MAX_TABLE_BATCH_ITEMS } from '@/lib/table/constants'
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
  FILTER_SECTION_LABEL_CLASS,
  OwnerAvatar,
  ownerCell,
  Resource,
  reportBulkOutcome,
  resourceListState,
  selectionLabel,
  timeCell,
  useResourceRowSelection,
} from '@/app/workspace/[workspaceId]/components'
import type {
  MoveOptionNode,
  SortableResource,
} from '@/app/workspace/[workspaceId]/components/folders'
import {
  buildDescendantIndex,
  buildMoveOptions,
  buildMoveOptionsExcludingSubtrees,
  EMPTY_LOCATION_CELL,
  FOLDER_LOCATION_COLUMN,
  FOLDERED_RESOURCE_HEADERS,
  FolderContextMenu,
  folderBreadcrumbItems,
  folderLocationLabel,
  folderRow,
  folderRowId,
  isSearchingResources,
  nextUntitledFolderName,
  parseFolderedRowId,
  parseMoveOptionValue,
  scopeFolderedItems,
  sortResources,
  splitFolderedRowIds,
  useFolderNavigation,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceActionBar } from '@/app/workspace/[workspaceId]/components/resource/components/action-bar'
import {
  ResourceNoResults,
  TablesEmptyState,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  ImportCsvDialog,
  ImportProgressMenu,
  TablesListContextMenu,
} from '@/app/workspace/[workspaceId]/tables/components'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import { useWorkspaceTablesRoom } from '@/app/workspace/[workspaceId]/tables/hooks/use-workspace-tables-room'
import TablesLoading from '@/app/workspace/[workspaceId]/tables/loading'
import {
  tablesListPreferenceConfig,
  tablesParsers,
  tablesSortParams,
  tablesUrlKeys,
} from '@/app/workspace/[workspaceId]/tables/search-params'
import { useCreateFolder, useDeleteFolderMutation, useUpdateFolder } from '@/hooks/queries/folders'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/hooks/queries/pinned-items'
import {
  exportTable,
  useBulkDeleteTables,
  useBulkMoveTables,
  useCreateTable,
  useDeleteTable,
  useImportCsv,
  useMoveTable,
  useRenameTable,
  useTablesList,
} from '@/hooks/queries/tables'
import { getCanonicalFolderPath } from '@/hooks/queries/utils/folder-tree'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useResourceListPreferences } from '@/hooks/use-resource-list-preferences'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import type { WorkflowFolder } from '@/stores/folders/types'
import type { ResourceListPreference } from '@/stores/resource-list-preferences'
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

const SEARCH_COLUMNS: ResourceColumn[] = [...COLUMNS, FOLDER_LOCATION_COLUMN]

/** This list's private drag MIME, so a drag started on another list is never mistaken for one
 *  of these rows. */
const TABLE_ROW_DRAG_MIME = 'application/x-sim-workspace-table-rows'

/** Root label for breadcrumbs and the "move to workspace root" destination. */
const ROOT_LABEL = FOLDERED_RESOURCE_HEADERS.table.rootLabel

const EMPTY_TABLES: TableDefinition[] = []

/** A list row (and the right-clicked row), resolved to the entity it refers to. */
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

  // Joined for the live tables list: a `workspace-tables-changed` broadcast (fanned out by the table
  // mutation service) invalidates the list so this view refetches without waiting for staleness.
  useWorkspaceTablesRoom(workspaceId)

  const {
    data: tables = EMPTY_TABLES,
    isLoading,
    isPlaceholderData,
    error,
  } = useTablesList(workspaceId)
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
    openFolder,
    ancestors: folderChain,
    folders,
    folderById,
    foldersResolved,
  } = useFolderNavigation({
    resourceType: 'table',
    workspaceId,
    /** Declared below; only ever called from a click, long after this render initializes it. */
    onBeforeOpenFolder: () => setSearchTerm(''),
  })

  /**
   * Logged from an effect, not the render body: a render-phase log fires again on every
   * re-render while the error persists, and on each of React's double renders in dev.
   */
  useEffect(() => {
    if (error) logger.error('Failed to load tables:', error)
  }, [error])

  const deleteTable = useDeleteTable(workspaceId)
  const renameTable = useRenameTable(workspaceId)
  const createTable = useCreateTable(workspaceId)
  const moveTable = useMoveTable(workspaceId)
  const bulkMoveTables = useBulkMoveTables(workspaceId)
  const bulkDeleteTables = useBulkDeleteTables(workspaceId)
  const importCsv = useImportCsv()
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
  const [isBulkDeleteDialogOpen, setIsBulkDeleteDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)
  const [activeFolder, setActiveFolder] = useState<WorkflowFolder | null>(null)

  const [{ search: urlSearchTerm, rows: rowCountFilter, owner: ownerFilter }, setTableFilters] =
    useQueryStates(tablesParsers, tablesUrlKeys)

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort: applyUrlSort,
    onClear: clearUrlSort,
  } = useUrlSort(tablesSortParams, tablesUrlKeys)

  const currentListPreference = useMemo<ResourceListPreference>(
    () => ({
      sort: { column: sortColumn, direction: sortDirection },
      filters: { rows: rowCountFilter, owner: ownerFilter },
    }),
    [sortColumn, sortDirection, rowCountFilter, ownerFilter]
  )

  const applyListPreference = useCallback(
    (preference: ResourceListPreference) => {
      void setTableFilters({
        rows: [...preference.filters.rows],
        owner: [...preference.filters.owner],
      })
      const defaultSort = tablesListPreferenceConfig.defaultPreference.sort
      if (
        preference.sort.column === defaultSort.column &&
        preference.sort.direction === defaultSort.direction
      ) {
        clearUrlSort()
      } else {
        applyUrlSort(preference.sort.column, preference.sort.direction)
      }
    },
    [applyUrlSort, clearUrlSort, setTableFilters]
  )

  const {
    isReady: isListPreferenceReady,
    setFilter: setListFilter,
    clearFilters: clearTableFilters,
    setSort: setListSort,
    clearSort: clearListSort,
  } = useResourceListPreferences({
    workspaceId,
    config: tablesListPreferenceConfig,
    preference: currentListPreference,
    applyPreference: applyListPreference,
  })

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below still reads a debounced value
   * so it doesn't recompute on every keystroke.
   */
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setTableFilters({ search: value }, options)
  )
  const debouncedSearchTerm = useSearchFilterValue(urlSearchTerm, SEARCH_DEBOUNCE_MS)

  const setRowCountFilter = useCallback(
    (next: string[]) => setListFilter('rows', next),
    [setListFilter]
  )
  const setOwnerFilter = useCallback(
    (next: string[]) => setListFilter('owner', next),
    [setListFilter]
  )

  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const uploading = uploadProgress.total > 0
  const csvInputRef = useRef<HTMLInputElement>(null)

  /**
   * Indexed once. These resolve a dragged row's current placement and run per dragged row inside
   * `dragover`, which fires continuously — a linear scan there is O(selection x resources) per
   * event, and the worst case (hesitating over the folder the selection already lives in) does
   * not short-circuit.
   */
  const tableById = useMemo(() => {
    const byId = new Map<string, TableDefinition>()
    for (const table of tables) byId.set(table.id, table)
    return byId
  }, [tables])
  const tableByIdRef = useRef(tableById)
  tableByIdRef.current = tableById

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

  /** Which row kind the row context menu acts on — whichever active slot the handler filled. */
  const contextMenuKind: 'table' | 'folder' = activeFolder ? 'folder' : 'table'

  /**
   * Descendants of every folder, so a move destination that sits inside the moved folder can
   * be excluded — reparenting a folder under its own child would close a cycle (the server
   * rejects it; this keeps it out of the menu, and out of a valid drop target, entirely).
   */
  const descendantFolderIds = useMemo(() => buildDescendantIndex(folders), [folders])

  /** A query stops scoping the list to the open folder — see {@link scopeFolderedItems}. */
  const isSearching = isSearchingResources(debouncedSearchTerm)

  const visibleFolders = useMemo(
    () =>
      scopeFolderedItems(folders, {
        currentFolderId,
        search: debouncedSearchTerm,
        getParentId: (folder) => folder.parentId ?? null,
        getSearchText: (folder) => [folder.name],
      }),
    [folders, currentFolderId, debouncedSearchTerm]
  )

  const processedTables = useMemo(() => {
    let result = scopeFolderedItems(tables, {
      currentFolderId,
      search: debouncedSearchTerm,
      /**
       * A `folderId` that no longer names an active folder — restored on its own out
       * of Recently Deleted while its folder stayed archived — would otherwise match
       * no level at all and leave the table unreachable from every view. Fall it back
       * to the root instead — but only once `foldersResolved` says the index is the complete
       * set for THIS workspace. Gating on a loading flag instead would treat an errored fetch,
       * a disabled query, or the previous workspace's cached folders as "no such folder" and
       * drag every foldered table to the root.
       */
      getParentId: (t) => {
        const folderId = t.folderId ?? null
        return !foldersResolved || !folderId || folderById.has(folderId) ? folderId : null
      },
      getSearchText: (t) => [t.name],
    })

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
    return result
  }, [
    tables,
    currentFolderId,
    folderById,
    foldersResolved,
    debouncedSearchTerm,
    rowCountFilter,
    ownerFilter,
  ])

  /**
   * Folders and tables sort as ONE list — a folder never outranks a table it ties with, so a
   * pinned table reaches the top of the list rather than the top of the table section.
   *
   * Decorate-sort: each row's key + pinned flag is computed ONCE (O(N)) so the comparator
   * never re-runs Date parsing or member lookups per comparison. Folders carry no column or
   * row count, so those keys are `null` and land the folders last in both directions —
   * matching the em-dash they show in those cells.
   */
  const sortedEntries = useMemo(() => {
    const entries: SortableResource<TableResourceItem>[] = []

    for (const folder of visibleFolders) {
      entries.push({
        item: { kind: 'folder', folder },
        pinned: pinnedFolderIds.has(folder.id),
        name: folder.name,
        key:
          sortColumn === 'columns' || sortColumn === 'rows'
            ? null
            : sortColumn === 'created'
              ? new Date(folder.createdAt).getTime()
              : sortColumn === 'updated'
                ? new Date(folder.updatedAt).getTime()
                : sortColumn === 'owner'
                  ? (membersById.get(folder.userId)?.name ?? null)
                  : folder.name,
      })
    }

    for (const table of processedTables) {
      entries.push({
        item: { kind: 'table', table },
        pinned: pinnedTableIds.has(table.id),
        name: table.name,
        key:
          sortColumn === 'columns'
            ? table.schema.columns.length
            : sortColumn === 'rows'
              ? table.rowCount
              : sortColumn === 'created'
                ? new Date(table.createdAt).getTime()
                : sortColumn === 'updated'
                  ? new Date(table.updatedAt).getTime()
                  : sortColumn === 'owner'
                    ? (membersById.get(table.createdBy)?.name ?? null)
                    : table.name,
      })
    }

    return sortResources(entries, sortDirection)
  }, [
    visibleFolders,
    processedTables,
    sortColumn,
    sortDirection,
    membersById,
    pinnedFolderIds,
    pinnedTableIds,
  ])

  const baseRows: ResourceRow[] = useMemo(
    () =>
      sortedEntries.map(({ item, pinned }): ResourceRow => {
        if (item.kind === 'folder') {
          return folderRow(item.folder, {
            pinned,
            cells: {
              columns: { label: EMPTY_CELL_PLACEHOLDER },
              rows: { label: EMPTY_CELL_PLACEHOLDER },
              created: timeCell(item.folder.createdAt),
              owner: ownerCell(item.folder.userId, membersById),
              updated: timeCell(item.folder.updatedAt),
              /** A folder's location is its parent's path, not its own. */
              location: isSearching
                ? { label: folderLocationLabel(item.folder.parentId, folderById, ROOT_LABEL) }
                : EMPTY_LOCATION_CELL,
            },
          })
        }

        const { table } = item
        return {
          id: table.id,
          cells: {
            name: {
              icon: <TableIcon className='size-[14px]' />,
              label: table.name,
              pinned,
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
            location: isSearching
              ? { label: folderLocationLabel(table.folderId, folderById, ROOT_LABEL) }
              : EMPTY_LOCATION_CELL,
          },
        }
      }),
    [sortedEntries, membersById, folderById, isSearching]
  )

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

  /**
   * A dialog owns the keyboard while it is open. Without this, Escape closes the dialog AND
   * clears the selection behind it, so a bulk-delete confirm submits against a selection the
   * user just emptied; Delete and Cmd/Ctrl+A leak through the same way.
   */
  const isAnyDialogOpen = () =>
    isDeleteDialogOpen || isDeleteFolderDialogOpen || isBulkDeleteDialogOpen || isImportDialogOpen

  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows])

  const {
    selectedRowIds,
    selectable: selectableConfig,
    replaceSelection,
    clearSelection,
  } = useResourceRowSelection({
    visibleRowIds,
    isKeyboardBlocked: () => !canEdit || listRename.editingId !== null || isAnyDialogOpen(),
    onDeleteSelected: () => handleBulkDelete(),
  })

  const { folderIds: selectedFolderIds, resourceIds: selectedTableIds } = useMemo(
    () => splitFolderedRowIds(selectedRowIds),
    [selectedRowIds]
  )

  const bulkDeleteLabel = useMemo(() => {
    const count = selectedTableIds.length + selectedFolderIds.length
    const firstName =
      selectedTableIds.length > 0
        ? tables.find((table) => table.id === selectedTableIds[0])?.name
        : folderById.get(selectedFolderIds[0])?.name
    return selectionLabel(count, firstName)
  }, [selectedTableIds, selectedFolderIds, tables, folderById])

  const currentFolderActions: DropdownOption[] | undefined = useMemo(() => {
    if (!currentFolderId) return undefined
    const folder = folderById.get(currentFolderId)
    if (!folder) return undefined
    return [
      {
        label: 'Rename',
        icon: Pencil,
        disabled: !canEdit,
        onClick: () => breadcrumbRename.startRename(folder.id, folder.name),
      },
      {
        label: 'Delete',
        icon: Trash,
        disabled: !canEdit,
        /**
         * The only way to delete the folder you are inside — its own row is not in the list.
         * This is what makes the step-out in `handleDeleteFolder` reachable.
         */
        onClick: () => {
          setActiveFolder(folder)
          setIsDeleteFolderDialogOpen(true)
        },
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
        rootIcon: FOLDERED_RESOURCE_HEADERS.table.rootIcon,
        onNavigate: openFolder,
        currentFolderActions,
        currentFolderEditing,
      }),
    [folderChain, openFolder, currentFolderActions, currentFolderEditing]
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
      onSort: setListSort,
      onClear: clearListSort,
    }),
    [activeSort, setListSort, clearListSort]
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
        iconElement: <OwnerAvatar name={m.name} image={m.image} />,
      })),
    [members]
  )

  const hasActiveFilters = rowCountFilter.length > 0 || ownerFilter.length > 0

  const filterContent = useMemo(
    () => (
      <div className='flex w-[240px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <span className={FILTER_SECTION_LABEL_CLASS}>Row Count</span>
          <ChipCombobox
            options={[
              { value: 'empty', label: 'Empty' },
              { value: 'small', label: 'Small (1–100 rows)' },
              { value: 'large', label: 'Large (101+ rows)' },
            ]}
            multiSelect
            multiSelectValues={rowCountFilter}
            onMultiSelectChange={setRowCountFilter}
            overlayLabel={rowCountDisplayLabel}
            overlayContent={rowCountDisplayLabel}
            showAllOption
            allOptionLabel='All'
            className='w-full'
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Owner</span>
            <ChipCombobox
              options={memberOptions}
              multiSelect
              multiSelectValues={ownerFilter}
              onMultiSelectChange={setOwnerFilter}
              overlayLabel={ownerDisplayLabel}
              overlayContent={ownerDisplayLabel}
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
            onClick={clearTableFilters}
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
      clearTableFilters,
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

  const listState = resourceListState({
    rowCount: rows.length,
    isLoading,
    isPlaceholderData,
    error,
    search: debouncedSearchTerm,
    filterCount: filterTags.length,
    folderId: currentFolderId,
    foldersResolved,
  })

  const clearSearchAndFilters = () => {
    setSearchTerm('')
    clearTableFilters()
  }

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
        openFolder(parsed.id)
        return
      }
      router.push(`/workspace/${workspaceId}/tables/${parsed.id}`)
    },
    [isRowContextMenuOpen, listRename.editingId, router, workspaceId, openFolder]
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
      /**
       * Right-clicking outside the selection retargets it, so the menu always acts on what is
       * highlighted. Right-clicking inside it leaves the selection alone and the menu switches
       * its move/delete entries to the bulk handlers.
       */
      if (canEdit && !selectedRowIds.has(rowId)) replaceSelection([rowId])
      if (item.kind === 'folder') {
        setActiveFolder(item.folder)
        setActiveTable(null)
      } else {
        setActiveTable(item.table)
        setActiveFolder(null)
      }
      handleRowCtxMenu(e)
    },
    [resolveRowItem, handleRowCtxMenu, canEdit, selectedRowIds, replaceSelection]
  )

  /** Move targets for a table: every folder, since a table has no subtree. */
  const tableMoveOptions: MoveOptionNode[] = useMemo(
    () => buildMoveOptions({ folders, rootLabel: ROOT_LABEL }),
    [folders]
  )

  const folderMoveOptions: MoveOptionNode[] = useMemo(
    () =>
      activeFolder
        ? buildMoveOptionsExcludingSubtrees({
            folders,
            rootLabel: ROOT_LABEL,
            excludeFolderIds: [activeFolder.id],
            descendantsByFolderId: descendantFolderIds,
          })
        : [],
    [activeFolder, folders, descendantFolderIds]
  )

  /**
   * Destinations for the action bar's move menu. Every selected folder — and everything beneath
   * it — is excluded, since a folder cannot be filed into itself or its own subtree.
   */
  const bulkMoveOptions: MoveOptionNode[] = useMemo(
    () =>
      buildMoveOptionsExcludingSubtrees({
        folders,
        rootLabel: ROOT_LABEL,
        excludeFolderIds: selectedFolderIds,
        descendantsByFolderId: descendantFolderIds,
      }),
    [selectedFolderIds, folders, descendantFolderIds]
  )

  const handleMoveTable = useCallback(
    (optionValue: string) => {
      if (!activeTable) return
      const folderId = parseMoveOptionValue(optionValue)
      /**
       * Placement is re-read from the live list rather than trusted from `activeTable`, which
       * is a snapshot taken when the menu opened. A refetch or a concurrent move since then
       * would make the no-op check compare against a stale location and skip a write the user
       * asked for.
       */
      const current = tablesRef.current.find((table) => table.id === activeTable.id) ?? activeTable
      if ((current.folderId ?? null) === folderId) {
        closeRowContextMenu()
        return
      }
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
      // Same reasoning as `handleMoveTable`: compare against the live row, not the snapshot.
      const current = folderById.get(activeFolder.id) ?? activeFolder
      if ((current.parentId ?? null) !== parentId) moveFolderTo(activeFolder.id, parentId)
      closeRowContextMenu()
    },
    [activeFolder, folderById, moveFolderTo, closeRowContextMenu]
  )

  /**
   * The one move path for every multi-row gesture — dropping a selection onto a folder row and
   * the action bar's "Move to" menu both land here, so a mixed selection of tables and folders
   * commits as a single operation instead of one request per row.
   */
  const moveRowsTo = useCallback(
    (rows: { tableIds: string[]; folderIds: string[] }, targetFolderId: string | null) => {
      if (rows.tableIds.length === 0 && rows.folderIds.length === 0) return
      if (rows.tableIds.length + rows.folderIds.length > MAX_TABLE_BATCH_ITEMS) {
        toast.error(`Select ${MAX_TABLE_BATCH_ITEMS} or fewer items to move at once`)
        return
      }
      bulkMoveTables.mutate(
        { ...rows, targetFolderId },
        {
          onSuccess: (result) => {
            clearSelection()
            reportBulkOutcome(result, 'moved')
          },
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
    [clearSelection]
  )

  const handleBulkMove = useCallback(
    (optionValue: string) => {
      moveRowsTo(
        { tableIds: selectedTableIds, folderIds: selectedFolderIds },
        parseMoveOptionValue(optionValue)
      )
    },
    [moveRowsTo, selectedTableIds, selectedFolderIds]
  )

  /**
   * Enforced here rather than only on the action bar: the row context menu and the Delete key
   * reach the same operation, and the server rejects an over-cap request outright — so without
   * this the user confirms a delete that cannot succeed.
   */
  const exceedsBatchCap = selectedTableIds.length + selectedFolderIds.length > MAX_TABLE_BATCH_ITEMS

  const handleBulkDelete = useCallback(() => {
    if (selectedTableIds.length === 0 && selectedFolderIds.length === 0) return
    if (exceedsBatchCap) {
      toast.error(`Select ${MAX_TABLE_BATCH_ITEMS} or fewer items to delete at once`)
      return
    }
    setIsBulkDeleteDialogOpen(true)
  }, [selectedTableIds, selectedFolderIds, exceedsBatchCap])

  const confirmBulkDelete = useCallback(async () => {
    try {
      const result = await bulkDeleteTables.mutateAsync({
        tableIds: selectedTableIds,
        folderIds: selectedFolderIds,
      })
      setIsBulkDeleteDialogOpen(false)
      clearSelection()
      reportBulkOutcome(result, 'deleted')
    } catch (err) {
      // The mutation toasts the request failure itself; the modal stays open to allow a retry.
      logger.error('Failed to delete selected items:', err)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutateAsync is stable in v5
  }, [selectedTableIds, selectedFolderIds, clearSelection])

  /**
   * A context menu opened on a multi-row selection acts on the whole selection. Resolved inside
   * these handlers rather than at each menu prop, so the menus stay unaware selection exists.
   */
  const hasMultiSelection = selectedRowIds.size > 1
  const hasMultiSelectionRef = useRef(hasMultiSelection)
  hasMultiSelectionRef.current = hasMultiSelection

  const activeMoveOptions = hasMultiSelection ? bulkMoveOptions : tableMoveOptions
  const activeFolderMoveOptions = hasMultiSelection ? bulkMoveOptions : folderMoveOptions

  const handleMoveTableFromMenu = useCallback(
    (optionValue: string) => {
      if (hasMultiSelectionRef.current) return handleBulkMove(optionValue)
      return handleMoveTable(optionValue)
    },
    [handleBulkMove, handleMoveTable]
  )

  const handleMoveFolderFromMenu = useCallback(
    (optionValue: string) => {
      if (hasMultiSelectionRef.current) return handleBulkMove(optionValue)
      return handleMoveFolder(optionValue)
    },
    [handleBulkMove, handleMoveFolder]
  )

  const handleDeleteTableFromMenu = useCallback(() => {
    if (hasMultiSelectionRef.current) {
      handleBulkDelete()
      return
    }
    setIsDeleteDialogOpen(true)
  }, [handleBulkDelete])

  const handleDeleteFolderFromMenu = useCallback(() => {
    if (hasMultiSelectionRef.current) {
      handleBulkDelete()
      return
    }
    setIsDeleteFolderDialogOpen(true)
  }, [handleBulkDelete])

  const rowDragDropConfig = useFolderRowDragDrop({
    dragMime: TABLE_ROW_DRAG_MIME,
    canEdit,
    editingRowId: listRename.editingId,
    descendantsByFolderId: descendantFolderIds,
    getFolderParentId: (folderId) => folderById.get(folderId)?.parentId ?? null,
    getResourceFolderId: (tableId) => tableByIdRef.current.get(tableId)?.folderId ?? null,
    getRowLabel: (rowId) => {
      const parsed = parseFolderedRowId(rowId)
      return parsed.kind === 'folder'
        ? (folderById.get(parsed.id)?.name ?? 'Folder')
        : (tableByIdRef.current.get(parsed.id)?.name ?? 'Table')
    },
    onMoveRows: ({ folderIds, resourceIds }, targetFolderId) =>
      moveRowsTo({ folderIds, tableIds: resourceIds }, targetFolderId),
    selection: { selectedRowIds, visibleRowIds, replaceSelection },
    onSpringOpenFolder: setCurrentFolderId,
    currentFolderId,
    bodyDropFolderId: isSearching ? undefined : currentFolderId,
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
      // leaving a `?folderId=` pointing at an archived folder. Not `openFolder`:
      // this is a forced correction, so it must neither clear an active search nor
      // push a back-stack entry aimed at the folder that was just deleted.
      if (currentFolderId === activeFolder.id) {
        setCurrentFolderId(activeFolder.parentId, { history: 'replace' })
      }
      setIsDeleteFolderDialogOpen(false)
      setActiveFolder(null)
    } catch (err) {
      logger.error('Failed to delete folder:', err)
      toast.error(getErrorMessage(err, 'Failed to delete folder'), { duration: 5000 })
    }
  }

  const handleCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    try {
      setUploadProgress({ completed: 0, total: csvFiles.length })
      for (let index = 0; index < csvFiles.length; index++) {
        const file = csvFiles[index]
        let importId: string | null = null
        toast.success(`Importing "${file.name}" in the background`)
        try {
          await importCsv.mutateAsync({
            workspaceId,
            folderPath: getCanonicalFolderPath(currentFolderId, folderById),
            file,
            onCreated: (createdImportId) => {
              importId = createdImportId
              useImportTrayStore.getState().startUpload({
                uploadId: createdImportId,
                workspaceId,
                title: file.name,
              })
            },
            onProgress: (percent) => {
              if (importId) useImportTrayStore.getState().setUploadPercent(importId, percent)
            },
          })
          if (importId) {
            useImportTrayStore.getState().endUpload(importId)
            useImportTrayStore.getState().consumeCanceled(importId)
          }
        } catch {
          if (importId) useImportTrayStore.getState().endUpload(importId)
        } finally {
          setUploadProgress({ completed: index + 1, total: csvFiles.length })
        }
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
  }

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
      /**
       * A live search term filters the folder list too, so a brand-new "New folder" would not
       * match it — the row never renders, the rename field never appears, and the create reads
       * as a no-op even though it succeeded. Clear the search so the thing just created is on
       * screen to be named.
       */
      setSearchTerm('')
      startFolderRename(folder)
    } catch (err) {
      logger.error('Failed to create folder:', err)
      toast.error(getErrorMessage(err, 'Failed to create folder'), { duration: 5000 })
    }
  }, [workspaceId, folders, currentFolderId, createFolderAsync, setSearchTerm, startFolderRename])

  useRegisterGlobalCommands(() => [
    { id: 'tables-new-table', handler: () => void handleCreateTable() },
    { id: 'tables-new-folder', handler: () => void handleCreateFolder() },
    {
      id: 'tables-import-csv',
      handler: () => {
        if (!uploading) csvInputRef.current?.click()
      },
    },
  ])

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

  // Stable identities so the memoized Resource.Header / Resource.Options / Resource.Table can
  // actually bail — inline object/element props would defeat their memo.
  const headerAside = useMemo(() => <ImportProgressMenu workspaceId={workspaceId} />, [workspaceId])

  const actionBar = useMemo(
    () => (
      <ResourceActionBar
        selectedCount={selectedRowIds.size}
        onMove={canEdit ? handleBulkMove : undefined}
        moveOptions={canEdit ? bulkMoveOptions : undefined}
        onDelete={canEdit ? handleBulkDelete : undefined}
        isLoading={bulkMoveTables.isPending || bulkDeleteTables.isPending}
        maxSelectable={MAX_TABLE_BATCH_ITEMS}
      />
    ),
    [
      selectedRowIds.size,
      canEdit,
      handleBulkMove,
      bulkMoveOptions,
      handleBulkDelete,
      bulkMoveTables.isPending,
      bulkDeleteTables.isPending,
    ]
  )
  const filterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  if (!isListPreferenceReady) return <TablesLoading />

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={FOLDERED_RESOURCE_HEADERS.table.rootIcon}
          title={ROOT_LABEL}
          breadcrumbs={breadcrumbs}
          actions={headerActions}
          aside={headerAside}
          breadcrumbDrop={rowDragDropConfig.breadcrumb}
        />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={filterConfig}
        />
        <Resource.Table
          columns={isSearching ? SEARCH_COLUMNS : COLUMNS}
          rows={rows}
          emptyState={
            listState === 'empty' ? (
              <TablesEmptyState
                onCreate={handleCreateTable}
                createDisabled={uploading || !canEdit || createTable.isPending}
              />
            ) : listState === 'no-results' ? (
              <ResourceNoResults
                search={debouncedSearchTerm}
                filterCount={filterTags.length}
                onClear={clearSearchAndFilters}
              />
            ) : undefined
          }
          selectable={canEdit ? selectableConfig : undefined}
          rowDragDrop={rowDragDropConfig}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
          overlay={actionBar}
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
        onDelete={handleDeleteTableFromMenu}
        onRename={() => {
          if (activeTable) listRename.startRename(activeTable.id, activeTable.name)
        }}
        onImportCsv={() => setIsImportDialogOpen(true)}
        onExportCsv={async () => {
          if (!activeTable) return
          try {
            const status = await exportTable(workspaceId, activeTable.id)
            if (status === 'processing') toast.success('Export started')
          } catch (err) {
            logger.error('Failed to export table:', err)
            toast.error('Failed to export table')
          }
        }}
        onTogglePin={handleTogglePin}
        pinned={activeTable ? pinnedTableIds.has(activeTable.id) : false}
        onMove={canEdit ? handleMoveTableFromMenu : undefined}
        moveOptions={canEdit ? activeMoveOptions : undefined}
        disableDelete={!canEdit}
        disableRename={!canEdit}
        disableImport={!canEdit}
        selectedCount={selectedRowIds.size}
      />

      <FolderContextMenu
        isOpen={isRowContextMenuOpen && contextMenuKind === 'folder'}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onOpen={() => {
          if (activeFolder) openFolder(activeFolder.id)
          closeRowContextMenu()
        }}
        onRename={() => {
          if (activeFolder) startFolderRename(activeFolder)
        }}
        onCopyId={() => {
          if (activeFolder) navigator.clipboard.writeText(activeFolder.id)
        }}
        onDelete={handleDeleteFolderFromMenu}
        onTogglePin={handleTogglePin}
        pinned={activeFolder ? pinnedFolderIds.has(activeFolder.id) : false}
        onMove={canEdit ? handleMoveFolderFromMenu : undefined}
        moveOptions={canEdit ? activeFolderMoveOptions : undefined}
        canEdit={canEdit}
        selectedCount={selectedRowIds.size}
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
        defaultAction='dismiss'
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

      <ChipConfirmModal
        open={isBulkDeleteDialogOpen}
        onOpenChange={setIsBulkDeleteDialogOpen}
        srTitle='Delete Selected'
        title='Delete Selected'
        text={[
          'Are you sure you want to delete ',
          { text: bulkDeleteLabel, bold: true },
          '? ',
          {
            text:
              selectedFolderIds.length > 0
                ? 'Every table and subfolder inside the selected folders will be deleted too.'
                : 'All of their rows will be removed.',
            error: true,
          },
          ' You can restore those tables from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: confirmBulkDelete,
          pending: bulkDeleteTables.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
