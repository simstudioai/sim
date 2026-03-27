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
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
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

  const filteredTables = useMemo(() => {
    if (!searchTerm) return tables
    const term = searchTerm.toLowerCase()
    return tables.filter((table) => table.name.toLowerCase().includes(term))
  }, [tables, searchTerm])

  const rows: ResourceRow[] = useMemo(
    () =>
      filteredTables.map((table) => ({
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
        sortValues: {
          columns: table.schema.columns.length,
          rows: table.rowCount,
          created: -new Date(table.createdAt).getTime(),
          updated: -new Date(table.updatedAt).getTime(),
        },
      })),
    [filteredTables, members]
  )

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
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search tables...',
        }}
        defaultSort='created'
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
