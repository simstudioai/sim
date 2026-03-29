'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
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
import { cn } from '@/lib/utils'
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

const logger = createLogger('Tables')

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'columns', header: 'Columns' },
  { id: 'rows', header: 'Rows' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const COLUMN_TYPE_LABELS: Record<string, string> = {
  string: 'Text',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  json: 'JSON',
}

export function Tables() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
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
  const [rowCountFilter, setRowCountFilter] = useState<'all' | 'empty' | 'small' | 'large'>('all')
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])
  const [columnTypeFilter, setColumnTypeFilter] = useState<string[]>([])
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

    if (rowCountFilter !== 'all') {
      result = result.filter((t) => {
        if (rowCountFilter === 'empty') return t.rowCount === 0
        if (rowCountFilter === 'small') return t.rowCount >= 1 && t.rowCount <= 100
        return t.rowCount > 100 // large
      })
    }
    if (ownerFilter.length > 0) {
      result = result.filter((t) => ownerFilter.includes(t.createdBy))
    }
    if (columnTypeFilter.length > 0) {
      result = result.filter((t) =>
        t.schema.columns.some((col) => columnTypeFilter.includes(col.type))
      )
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
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [tables, debouncedSearchTerm, activeSort, rowCountFilter, ownerFilter, columnTypeFilter])

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
        { id: 'updated', label: 'Last Updated' },
      ],
      active: activeSort,
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
  )

  const filterContent = (
    <div className='w-[200px]'>
      <div className='border-[var(--border-1)] border-b px-3 py-2'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Row Count</span>
      </div>
      <div className='flex flex-col gap-0.5 px-3 py-2'>
        {(
          [
            { value: 'all', label: 'All' },
            { value: 'empty', label: 'Empty' },
            { value: 'small', label: 'Small (1–100 rows)' },
            { value: 'large', label: 'Large (100+ rows)' },
          ] as const
        ).map(({ value, label }) => (
          <button
            key={value}
            type='button'
            className={cn(
              'flex w-full cursor-pointer select-none items-center rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
              rowCountFilter === value && 'bg-[var(--surface-active)]'
            )}
            onClick={() => setRowCountFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className='border-[var(--border-1)] border-t border-b px-3 py-2'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Column Types</span>
      </div>
      <div className='flex flex-col gap-0.5 px-3 py-2'>
        <button
          type='button'
          className={cn(
            'flex w-full cursor-pointer select-none items-center rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
            columnTypeFilter.length === 0 && 'bg-[var(--surface-active)]'
          )}
          onClick={() => setColumnTypeFilter([])}
        >
          All
        </button>
        {(['string', 'number', 'boolean', 'date', 'json'] as const).map((type) => (
          <button
            key={type}
            type='button'
            className={cn(
              'flex w-full cursor-pointer select-none items-center rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
              columnTypeFilter.includes(type) && 'bg-[var(--surface-active)]'
            )}
            onClick={() =>
              setColumnTypeFilter((prev) =>
                prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
              )
            }
          >
            {COLUMN_TYPE_LABELS[type]}
          </button>
        ))}
      </div>
      {members && members.length > 0 && (
        <>
          <div className='border-[var(--border-1)] border-t border-b px-3 py-2'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>Owner</span>
          </div>
          <div className='flex flex-col gap-0.5 px-3 py-2'>
            <button
              type='button'
              className={cn(
                'flex w-full cursor-pointer select-none items-center rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
                ownerFilter.length === 0 && 'bg-[var(--surface-active)]'
              )}
              onClick={() => setOwnerFilter([])}
            >
              All
            </button>
            {members.map((member) => (
              <button
                key={member.userId}
                type='button'
                className={cn(
                  'flex w-full cursor-pointer select-none items-center gap-1.5 rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
                  ownerFilter.includes(member.userId) && 'bg-[var(--surface-active)]'
                )}
                onClick={() =>
                  setOwnerFilter((prev) =>
                    prev.includes(member.userId)
                      ? prev.filter((id) => id !== member.userId)
                      : [...prev, member.userId]
                  )
                }
              >
                {member.image ? (
                  <img
                    src={member.image}
                    alt={member.name}
                    referrerPolicy='no-referrer'
                    className='h-[14px] w-[14px] shrink-0 rounded-full border border-[var(--border)] object-cover'
                  />
                ) : (
                  <span className='flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
                    {member.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className='truncate'>{member.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (rowCountFilter !== 'all') {
      const labels = { empty: 'Rows: Empty', small: 'Rows: Small', large: 'Rows: Large' }
      tags.push({ label: labels[rowCountFilter], onRemove: () => setRowCountFilter('all') })
    }
    if (columnTypeFilter.length > 0) {
      const label =
        columnTypeFilter.length === 1
          ? `Type: ${COLUMN_TYPE_LABELS[columnTypeFilter[0]]}`
          : `Types: ${columnTypeFilter.length} selected`
      tags.push({ label, onRemove: () => setColumnTypeFilter([]) })
    }
    if (ownerFilter.length > 0) {
      const label =
        ownerFilter.length === 1
          ? `Owner: ${members?.find((m) => m.userId === ownerFilter[0])?.name ?? '1 member'}`
          : `Owner: ${ownerFilter.length} members`
      tags.push({ label, onRemove: () => setOwnerFilter([]) })
    }
    return tags
  }, [rowCountFilter, columnTypeFilter, ownerFilter, members])

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
    [workspaceId, router]
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
              <span className='text-[var(--text-tertiary)]'>
                You can restore it from Recently Deleted in Settings.
              </span>
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
