'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComboboxOption } from '@sim/emcn'
import { ChipCombobox, ChipConfirmModal, Plus, toast, Upload } from '@sim/emcn'
import { Columns3, Rows3, Table as TableIcon } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useParams, useRouter } from 'next/navigation'
import { debounce, useQueryStates } from 'nuqs'
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
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
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
  tablesParsers,
  tablesUrlKeys,
} from '@/app/workspace/[workspaceId]/tables/search-params'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
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
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
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

  const { data: tables = [], error } = useTablesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  if (error) {
    logger.error('Failed to load tables:', error)
  }
  const deleteTable = useDeleteTable(workspaceId)
  const renameTable = useRenameTable(workspaceId)
  const createTable = useCreateTable(workspaceId)
  const uploadCsv = useUploadCsvToTable()
  const importCsvAsync = useImportCsvAsync()

  const tableRename = useInlineRename({
    onSave: (tableId, name) => renameTable.mutateAsync({ tableId, name }),
  })

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)

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

  const processedTables = useMemo(() => {
    let result = debouncedSearchTerm
      ? tables.filter((t) => t.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
      : tables

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
          const aName = members?.find((m) => m.userId === a.createdBy)?.name ?? ''
          const bName = members?.find((m) => m.userId === b.createdBy)?.name ?? ''
          cmp = aName.localeCompare(bName)
          break
        }
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [tables, debouncedSearchTerm, rowCountFilter, ownerFilter, activeSort, members])

  const rows: ResourceRow[] = useMemo(
    () =>
      processedTables.map((table) => ({
        id: table.id,
        cells: {
          name: {
            icon: <TableIcon className='size-[14px]' />,
            label: table.name,
            editing:
              tableRename.editingId === table.id
                ? {
                    value: tableRename.editValue,
                    onChange: tableRename.setEditValue,
                    onSubmit: tableRename.submitRename,
                    onCancel: tableRename.cancelRename,
                  }
                : undefined,
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
          owner: ownerCell(table.createdBy, members),
          updated: timeCell(table.updatedAt),
        },
      })),
    [
      processedTables,
      members,
      tableRename.editingId,
      tableRename.editValue,
      tableRename.setEditValue,
      tableRename.submitRename,
      tableRename.cancelRename,
    ]
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
      if (!isRowContextMenuOpen) {
        router.push(`/workspace/${workspaceId}/tables/${rowId}`)
      }
    },
    [isRowContextMenuOpen, router, workspaceId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const table = tables.find((t) => t.id === rowId) ?? null
      setActiveTable(table)
      handleRowCtxMenu(e)
    },
    [tables, handleRowCtxMenu]
  )

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
      })
      const tableId = result?.data?.table?.id
      if (tableId) {
        router.push(`/workspace/${workspaceId}/tables/${tableId}`)
      }
    } catch (err) {
      logger.error('Failed to create table:', err)
    }
  }, [tables, router, workspaceId, createTableAsync])

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: uploadButtonLabel,
        icon: Upload,
        onSelect: () => csvInputRef.current?.click(),
        disabled: uploading || userPermissions.canEdit !== true,
      },
      {
        text: 'New table',
        icon: Plus,
        onSelect: handleCreateTable,
        disabled: uploading || userPermissions.canEdit !== true || createTable.isPending,
        variant: 'primary',
      },
    ],
    [
      uploadButtonLabel,
      uploading,
      userPermissions.canEdit,
      handleCreateTable,
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
          title='Tables'
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
        onUploadCsv={handleListUploadCsv}
        disableCreate={userPermissions.canEdit !== true || createTable.isPending}
        disableUpload={uploading || userPermissions.canEdit !== true}
      />

      <TableContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onCopyId={() => {
          if (activeTable) navigator.clipboard.writeText(activeTable.id)
        }}
        onDelete={() => setIsDeleteDialogOpen(true)}
        onRename={() => {
          if (activeTable) tableRename.startRename(activeTable.id, activeTable.name)
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
        disableDelete={userPermissions.canEdit !== true}
        disableRename={userPermissions.canEdit !== true}
        disableImport={userPermissions.canEdit !== true}
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
    </>
  )
}
