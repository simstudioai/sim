'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComboboxOption } from '@sim/emcn'
import {
  ChipCombobox,
  ChipConfirmModal,
  cellIconNodeClass,
  chipContentGap,
  chipContentLabelClass,
  cn,
  Folder,
  FolderPlus,
  Plus,
  toast,
  Upload,
} from '@sim/emcn'
import { Columns3, Lock, Rows3, Table as TableIcon } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useParams, useRouter } from 'next/navigation'
import { debounce, useQueryState, useQueryStates } from 'nuqs'
import { PinButton } from '@/components/folders/pin-button'
import type { TableDefinition } from '@/lib/table'
import { CSV_ASYNC_IMPORT_THRESHOLD_BYTES, generateUniqueTableName } from '@/lib/table/constants'
import type {
  FilterTag,
  ResourceAction,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  EMPTY_CELL_PLACEHOLDER,
  FloatingOverflowText,
  ownerCell,
  Resource,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  ImportCsvDialog,
  ImportProgressMenu,
  TablesListContextMenu,
} from '@/app/workspace/[workspaceId]/tables/components'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import {
  DEFAULT_TABLE_SORT_COLUMN,
  DEFAULT_TABLE_SORT_DIRECTION,
  TABLE_SORT_COLUMNS,
  type TableSortColumn,
  tableFolderIdParam,
  tableFolderIdUrlKeys,
  tablesParsers,
  tablesUrlKeys,
} from '@/app/workspace/[workspaceId]/tables/search-params'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useCreateFolder,
  useDeleteFolderMutation,
  useFolders,
  useUpdateFolder,
} from '@/hooks/queries/folders'
import { usePinnedIds } from '@/hooks/queries/pinned-items'
import {
  cancelTableJob,
  downloadTableExport,
  useCreateTable,
  useDeleteTable,
  useImportCsvAsync,
  useRenameTable,
  useTablesList,
  useUploadCsvToTable,
} from '@/hooks/queries/tables'
import { isFolderOrAncestorLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderBreadcrumbs } from '@/hooks/use-folder-breadcrumbs'
import { useFolderCreateWithDedup } from '@/hooks/use-folder-create-with-dedup'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import type { Folder as FolderType } from '@/stores/folders/types'
import { useImportTrayStore } from '@/stores/table/import-tray/store'

const logger = createLogger('Tables')

/** Debounce window for `search` URL writes; the input itself stays instant. */
const SEARCH_DEBOUNCE_MS = 300 as const

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'columns', header: 'Columns' },
  { id: 'rows', header: 'Rows' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const EMPTY_TABLE_FOLDERS: FolderType[] = []

const tableRowId = (id: string) => `table:${id}`
const folderRowId = (id: string) => `folder:${id}`
const parseRowId = (rowId: string): { kind: 'table' | 'folder'; id: string } => {
  if (rowId.startsWith('folder:')) return { kind: 'folder', id: rowId.slice('folder:'.length) }
  if (rowId.startsWith('table:')) return { kind: 'table', id: rowId.slice('table:'.length) }
  return { kind: 'table', id: rowId }
}

interface NameCellContentProps {
  icon: ReactNode
  label: string
  workspaceId: string
  resourceType: 'table' | 'folder'
  resourceId: string
  pinned: boolean
  locked?: boolean
}

/**
 * Reproduces the default name-cell layout (icon + truncating label) plus a
 * trailing hover-revealed {@link PinButton} — used instead of the default
 * icon/label cell rendering so pinning doesn't need a dedicated column (which
 * would shift `buildGridTemplateColumns` width math). Renders a small lock
 * indicator when the resource is directly locked (mirrors the workflow
 * sidebar's row lock icon — inherited-from-folder lock is not iconified here).
 */
function NameCellContent({
  icon,
  label,
  workspaceId,
  resourceType,
  resourceId,
  pinned,
  locked = false,
}: NameCellContentProps) {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center justify-between', chipContentGap)}>
      <span className={cn('flex min-w-0 items-center', chipContentGap)}>
        <span className={cellIconNodeClass}>{icon}</span>
        <FloatingOverflowText label={label} className={cn('block', chipContentLabelClass)} />
      </span>
      <span className='flex items-center gap-0.5'>
        {locked && (
          <span
            role='img'
            aria-label={`${resourceType === 'folder' ? 'Folder' : 'Table'} is locked`}
          >
            <Lock className='size-[14px] text-[var(--text-icon)]' aria-hidden='true' />
          </span>
        )}
        <PinButton
          workspaceId={workspaceId}
          resourceType={resourceType}
          resourceId={resourceId}
          pinned={pinned}
          className='ml-2'
        />
      </span>
    </span>
  )
}

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

  const { data: tables = [], error } = useTablesList(workspaceId)
  const { data: folders = EMPTY_TABLE_FOLDERS } = useFolders(workspaceId, { resourceType: 'table' })
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) map.set(member.userId, member)
    return map
  }, [members])
  const pinnedTableIds = usePinnedIds(workspaceId, 'table')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')

  if (error) {
    logger.error('Failed to load tables:', error)
  }
  const deleteTable = useDeleteTable(workspaceId)
  const renameTable = useRenameTable(workspaceId)
  const createTable = useCreateTable(workspaceId)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()
  const uploadCsv = useUploadCsvToTable()
  const importCsvAsync = useImportCsvAsync()

  const [currentFolderId, setTableFolderId] = useQueryState(tableFolderIdParam.key, {
    ...tableFolderIdParam.parser,
    ...tableFolderIdUrlKeys,
  })

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        return updateFolder.mutateAsync({
          workspaceId,
          resourceType: 'table',
          id: parsed.id,
          updates: { name },
        })
      }
      return renameTable.mutateAsync({ tableId: parsed.id, name })
    },
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) =>
      updateFolder.mutateAsync({
        workspaceId,
        resourceType: 'table',
        id: folderId,
        updates: { name },
      }),
  })

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)

  const [
    {
      search: urlSearchTerm,
      sort: sortColumn,
      dir: sortDirection,
      rows: rowCountFilter,
      owner: ownerFilter,
    },
    setTableFilters,
  ] = useQueryStates(tablesParsers, tablesUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below still reads a debounced value
   * so it doesn't recompute on every keystroke.
   */
  const setSearchTerm = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      const next = trimmed.length > 0 ? trimmed : null
      setTableFilters(
        { search: next },
        next === null ? undefined : { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) }
      )
    },
    [setTableFilters]
  )
  const debouncedSearchTerm = useDebounce(urlSearchTerm, 300)

  /**
   * The resolved sort is exposed to the sort menu only when it differs from the
   * default, mirroring the prior `null`-means-default semantics.
   */
  const activeSort = useMemo(
    () =>
      sortColumn === DEFAULT_TABLE_SORT_COLUMN && sortDirection === DEFAULT_TABLE_SORT_DIRECTION
        ? null
        : { column: sortColumn, direction: sortDirection },
    [sortColumn, sortDirection]
  )

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

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])

  const activeFolder = activeFolderId ? (folderById.get(activeFolderId) ?? null) : null

  const visibleFolders = useMemo(() => {
    const siblings = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
    const searched = debouncedSearchTerm
      ? siblings.filter((folder) =>
          folder.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        )
      : siblings
    const col =
      activeSort?.column === 'created' || activeSort?.column === 'updated'
        ? activeSort.column
        : 'name'
    const dir = activeSort?.direction ?? 'asc'
    return [...searched].sort((a, b) => {
      let cmp = 0
      if (col === 'updated') {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      } else if (col === 'created') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      } else {
        cmp = a.name.localeCompare(b.name)
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [folders, currentFolderId, debouncedSearchTerm, activeSort])

  const processedTables = useMemo(() => {
    let result = tables.filter((t) => (t.folderId ?? null) === currentFolderId)
    if (debouncedSearchTerm) {
      result = result.filter((t) =>
        t.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
      )
    }

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
    const col = activeSort?.column ?? 'updated'
    const dir = activeSort?.direction ?? 'desc'
    return [...result].sort((a, b) => {
      let cmp = 0
      switch (col) {
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
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    tables,
    currentFolderId,
    debouncedSearchTerm,
    rowCountFilter,
    ownerFilter,
    activeSort,
    membersById,
  ])

  const baseRows: ResourceRow[] = useMemo(() => {
    const folderRows = visibleFolders.map((folder) => ({
      id: folderRowId(folder.id),
      cells: {
        name: {
          content: (
            <NameCellContent
              icon={<Folder className='size-[14px]' />}
              label={folder.name}
              workspaceId={workspaceId}
              resourceType='folder'
              resourceId={folder.id}
              pinned={pinnedFolderIds.has(folder.id)}
              locked={folder.locked}
            />
          ),
        },
        columns: { label: EMPTY_CELL_PLACEHOLDER },
        rows: { label: EMPTY_CELL_PLACEHOLDER },
        created: timeCell(folder.createdAt),
        owner: ownerCell(folder.userId, membersById),
        updated: timeCell(folder.updatedAt),
      },
    }))

    const tableRows = processedTables.map((table) => ({
      id: tableRowId(table.id),
      cells: {
        name: {
          content: (
            <NameCellContent
              icon={<TableIcon className='size-[14px]' />}
              label={table.name}
              workspaceId={workspaceId}
              resourceType='table'
              resourceId={table.id}
              pinned={pinnedTableIds.has(table.id)}
              locked={table.locked}
            />
          ),
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
    }))

    return [...folderRows, ...tableRows]
  }, [visibleFolders, processedTables, membersById, workspaceId, pinnedFolderIds, pinnedTableIds])

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
  }, [baseRows, listRename.editingId, listRename.editValue, listRename.isSaving])

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
      onSort: (column, direction) => {
        const sort = (TABLE_SORT_COLUMNS as readonly string[]).includes(column)
          ? (column as TableSortColumn)
          : DEFAULT_TABLE_SORT_COLUMN
        setTableFilters({ sort, dir: direction })
      },
      onClear: () =>
        setTableFilters({
          sort: DEFAULT_TABLE_SORT_COLUMN,
          dir: DEFAULT_TABLE_SORT_DIRECTION,
        }),
    }),
    [activeSort, setTableFilters]
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
    if (ownerFilter.length === 1)
      return members?.find((m) => m.userId === ownerFilter[0])?.name ?? '1 member'
    return `${ownerFilter.length} members`
  }, [ownerFilter, members])

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
          ? `Owner: ${members?.find((m) => m.userId === ownerFilter[0])?.name ?? '1 member'}`
          : `Owner: ${ownerFilter.length} members`
      tags.push({ label, onRemove: () => setOwnerFilter([]) })
    }
    return tags
  }, [rowCountFilter, ownerFilter, members])

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
      if (isRowContextMenuOpen) return
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        void setTableFolderId(parsed.id)
        return
      }
      router.push(`/workspace/${workspaceId}/tables/${parsed.id}`)
    },
    [isRowContextMenuOpen, router, workspaceId, setTableFolderId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        setActiveFolderId(parsed.id)
        setActiveTable(null)
      } else {
        setActiveTable(tables.find((t) => t.id === parsed.id) ?? null)
        setActiveFolderId(null)
      }
      handleRowCtxMenu(e)
    },
    [tables, handleRowCtxMenu]
  )

  const activeResourceLocked = activeFolder?.locked ?? activeTable?.locked ?? false
  const activeResourceInheritedLocked = isFolderOrAncestorLocked(
    activeFolder ? activeFolder.parentId : (activeTable?.folderId ?? null),
    Object.fromEntries(folderById)
  )

  const handleToggleLock = useCallback(() => {
    if (activeResourceInheritedLocked) return
    if (activeFolder) {
      updateFolder.mutate({
        workspaceId,
        resourceType: 'table',
        id: activeFolder.id,
        updates: { locked: !activeFolder.locked },
      })
    } else if (activeTable) {
      renameTable.mutate({
        tableId: activeTable.id,
        name: activeTable.name,
        locked: !activeTable.locked,
      })
    }
  }, [
    activeFolder,
    activeTable,
    activeResourceInheritedLocked,
    updateFolder,
    renameTable,
    workspaceId,
  ])

  const handleDelete = async () => {
    try {
      if (activeFolderId) {
        await deleteFolder.mutateAsync({ workspaceId, resourceType: 'table', id: activeFolderId })
      } else if (activeTable) {
        await deleteTable.mutateAsync(activeTable.id)
      } else {
        return
      }
      setIsDeleteDialogOpen(false)
      setActiveTable(null)
      setActiveFolderId(null)
    } catch (err) {
      logger.error('Failed to delete:', err)
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
            const result = await uploadCsv.mutateAsync({ workspaceId, file })

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
    [workspaceId, router]
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
        schema: {
          columns: [{ name: 'name', type: 'string' }],
        },
        initialRowCount: 1,
        folderId: currentFolderId,
      })
      const tableId = result?.data?.table?.id
      if (tableId) {
        router.push(`/workspace/${workspaceId}/tables/${tableId}`)
      }
    } catch (err) {
      logger.error('Failed to create table:', err)
    }
  }, [tables, router, workspaceId, createTableAsync, currentFolderId])

  const handleFolderCreated = useCallback(
    (folder: FolderType) => {
      listRename.startRename(folderRowId(folder.id), folder.name)
    },
    [listRename.startRename]
  )

  const handleCreateFolder = useFolderCreateWithDedup({
    workspaceId,
    resourceType: 'table',
    folders,
    currentFolderId,
    createFolder,
    onCreated: handleFolderCreated,
  })

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
        disabled: createFolder.isPending || !canEdit,
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
      createFolder.isPending,
      handleCreateTable,
      createTable.isPending,
    ]
  )

  const handleNavigateToTables = useCallback(() => {
    void setTableFolderId(null)
  }, [setTableFolderId])

  const handleNavigateToFolder = useCallback(
    (folderId: string) => {
      void setTableFolderId(folderId)
    },
    [setTableFolderId]
  )

  const listBreadcrumbs = useFolderBreadcrumbs({
    folderById,
    currentFolderId,
    rootLabel: 'Tables',
    onNavigateRoot: handleNavigateToTables,
    onNavigateFolder: handleNavigateToFolder,
    breadcrumbRename,
    canEdit,
    canEditLoading: userPermissions.isLoading,
  })

  // Stable identities so the memoized Resource.Header / Resource.Options can
  // actually bail — inline object/element props would defeat their memo.
  const headerAside = useMemo(() => <ImportProgressMenu workspaceId={workspaceId} />, [workspaceId])
  const filterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  const isDeletingFolder = activeFolder != null
  const deleteTitle = isDeletingFolder ? 'Delete Folder' : 'Delete Table'

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={TableIcon}
          title='Tables'
          breadcrumbs={listBreadcrumbs}
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
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onCopyId={activeTable ? () => navigator.clipboard.writeText(activeTable.id) : undefined}
        onDelete={() => setIsDeleteDialogOpen(true)}
        onRename={() => {
          if (activeTable) listRename.startRename(tableRowId(activeTable.id), activeTable.name)
          if (activeFolder) listRename.startRename(folderRowId(activeFolder.id), activeFolder.name)
        }}
        onImportCsv={activeTable ? () => setIsImportDialogOpen(true) : undefined}
        onExportCsv={
          activeTable
            ? async () => {
                if (!activeTable) return
                try {
                  await downloadTableExport(activeTable.id, activeTable.name)
                } catch (err) {
                  logger.error('Failed to export table:', err)
                  toast.error('Failed to export table')
                }
              }
            : undefined
        }
        disableDelete={!canEdit}
        disableRename={!canEdit}
        disableImport={!canEdit}
        onToggleLock={handleToggleLock}
        showLock={Boolean(activeFolder || activeTable)}
        disableLock={!userPermissions.canAdmin || activeResourceInheritedLocked}
        isLocked={activeResourceLocked}
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
          if (!open) {
            setActiveTable(null)
            setActiveFolderId(null)
          }
        }}
        srTitle={deleteTitle}
        title={deleteTitle}
        text={
          isDeletingFolder
            ? [
                'Are you sure you want to delete ',
                { text: activeFolder?.name ?? 'this folder', bold: true },
                '? ',
                { text: 'This will also delete tables inside it.', error: true },
                ' You can restore it from Recently Deleted in Settings.',
              ]
            : [
                'Are you sure you want to delete ',
                { text: activeTable?.name ?? 'this table', bold: true },
                '? ',
                { text: `All ${activeTable?.rowCount ?? 0} rows will be removed.`, error: true },
                ' You can restore it from Recently Deleted in Settings.',
              ]
        }
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteTable.isPending || deleteFolder.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
