'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import type { ComboboxOption } from '@/components/emcn'
import {
  Button,
  Combobox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  toast,
  Upload,
} from '@/components/emcn'
import { Columns3, Rows3, Table as TableIcon } from '@/components/emcn/icons'
import type { TableDefinition } from '@/lib/table'
import { generateUniqueTableName } from '@/lib/table/constants'
import type {
  FilterTag,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { TablesListContextMenu } from '@/app/workspace/[workspaceId]/tables/components'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useCreateTable,
  useDeleteTable,
  useTablesList,
  useUploadCsvToTable,
} from '@/hooks/queries/tables'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { usePermissionConfig } from '@/hooks/use-permission-config'

const logger = createLogger('Tables')

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

  const { data: tables = [], isLoading, error } = useTablesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  if (error) {
    logger.error('Failed to load tables:', error)
  }
  const deleteTable = useDeleteTable(workspaceId)
  const createTable = useCreateTable(workspaceId)
  const uploadCsv = useUploadCsvToTable()

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearchTerm = useDebounce(searchTerm, 300)
  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const [rowCountFilter, setRowCountFilter] = useState<string[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
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
    const col = activeSort?.column ?? 'created'
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
            icon: <TableIcon className='h-[14px] w-[14px]' />,
            label: table.name,
          },
          columns: {
            icon: <Columns3 className='h-[14px] w-[14px]' />,
            label: String(table.schema.columns.length),
          },
          rows: {
            icon: <Rows3 className='h-[14px] w-[14px]' />,
            label: String(table.rowCount),
          },
          created: timeCell(table.createdAt),
          owner: ownerCell(table.createdBy, members),
          updated: timeCell(table.updatedAt),
        },
      })),
    [processedTables, members]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: searchTerm,
      onChange: setSearchTerm,
      onClearAll: () => setSearchTerm(''),
      placeholder: 'Search tables...',
    }),
    [searchTerm]
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
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
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
            className='h-[14px] w-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex h-[14px] w-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
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
          <Combobox
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
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>Owner</span>
            <Combobox
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
              size='sm'
              className='h-[32px] w-full rounded-md'
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

      try {
        setUploading(true)

        const csvFiles = Array.from(list).filter((f) => {
          const ext = f.name.split('.').pop()?.toLowerCase()
          return ext === 'csv' || ext === 'tsv'
        })

        if (csvFiles.length === 0) {
          toast.error('No CSV or TSV files selected')
          return
        }

        setUploadProgress({ completed: 0, total: csvFiles.length })
        const failed: string[] = []

        for (let i = 0; i < csvFiles.length; i++) {
          try {
            const result = await uploadCsv.mutateAsync({ workspaceId, file: csvFiles[i] })

            if (csvFiles.length === 1) {
              const tableId = result?.data?.table?.id
              if (tableId) {
                router.push(`/workspace/${workspaceId}/tables/${tableId}`)
              }
            }
          } catch (err) {
            failed.push(csvFiles[i].name)
            logger.error('Error uploading CSV:', err)
          } finally {
            setUploadProgress({ completed: i + 1, total: csvFiles.length })
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
        setUploading(false)
        setUploadProgress({ completed: 0, total: 0 })
        if (csvInputRef.current) {
          csvInputRef.current.value = ''
        }
      }
    },
    [workspaceId, router, uploadCsv]
  )

  const handleListUploadCsv = useCallback(() => {
    csvInputRef.current?.click()
    closeListContextMenu()
  }, [closeListContextMenu])

  const uploadButtonLabel =
    uploading && uploadProgress.total > 0
      ? `${uploadProgress.completed}/${uploadProgress.total}`
      : uploading
        ? 'Uploading...'
        : 'Upload CSV'

  const handleCreateTable = useCallback(async () => {
    const existingNames = tables.map((t) => t.name)
    const name = generateUniqueTableName(existingNames)
    try {
      const result = await createTable.mutateAsync({
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
  }, [tables, createTable, router, workspaceId])

  return (
    <>
      <Resource
        icon={TableIcon}
        title='Tables'
        create={{
          label: 'New table',
          onClick: handleCreateTable,
          disabled: uploading || userPermissions.canEdit !== true || createTable.isPending,
        }}
        search={searchConfig}
        sort={sortConfig}
        filter={filterContent}
        filterTags={filterTags}
        headerActions={[
          {
            label: uploadButtonLabel,
            icon: Upload,
            onClick: () => csvInputRef.current?.click(),
            disabled: uploading || userPermissions.canEdit !== true,
          },
        ]}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
      />

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
        disableDelete={userPermissions.canEdit !== true}
        disableRename={userPermissions.canEdit !== true}
      />

      <Modal open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Table</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{activeTable?.name}</span>?{' '}
              <span className='text-[var(--text-error)]'>
                All {activeTable?.rowCount} rows will be removed.
              </span>{' '}
              You can restore it from Recently Deleted in Settings.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setIsDeleteDialogOpen(false)
                setActiveTable(null)
              }}
              disabled={deleteTable.isPending}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDelete} disabled={deleteTable.isPending}>
              {deleteTable.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
