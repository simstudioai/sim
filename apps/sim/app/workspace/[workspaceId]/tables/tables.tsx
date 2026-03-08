'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'
import { Columns3, Rows3, Table as TableIcon } from '@/components/emcn/icons'
import type { TableDefinition } from '@/lib/table'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { SchemaModal } from '@/app/workspace/[workspaceId]/tables/[tableId]/components'
import { CreateModal, TablesListContextMenu } from '@/app/workspace/[workspaceId]/tables/components'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useDeleteTable, useTablesList } from '@/hooks/queries/tables'
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

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false)
  const [activeTable, setActiveTable] = useState<TableDefinition | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    menuRef: listMenuRef,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    menuRef: rowMenuRef,
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
      })),
    [filteredTables, members]
  )

  const handleSort = useCallback(() => {}, [])

  const handleFilter = useCallback(() => {}, [])

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

  return (
    <>
      <Resource
        icon={TableIcon}
        title='Tables'
        create={{
          label: 'New table',
          onClick: () => setIsCreateModalOpen(true),
          disabled: userPermissions.canEdit !== true,
        }}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search tables...',
        }}
        onSort={handleSort}
        onFilter={handleFilter}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
      />

      <TablesListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        menuRef={listMenuRef}
        onClose={closeListContextMenu}
        onCreateTable={() => setIsCreateModalOpen(true)}
        disableCreate={userPermissions.canEdit !== true}
      />

      <TableContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        menuRef={rowMenuRef}
        onClose={closeRowContextMenu}
        onViewSchema={() => setIsSchemaModalOpen(true)}
        onCopyId={() => {
          if (activeTable) navigator.clipboard.writeText(activeTable.id)
        }}
        onDelete={() => setIsDeleteDialogOpen(true)}
        disableDelete={userPermissions.canEdit !== true}
      />

      <Modal open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete Table</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{activeTable?.name}</span>?
              This will permanently delete all {activeTable?.rowCount} rows.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
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
            <Button variant='default' onClick={handleDelete} disabled={deleteTable.isPending}>
              {deleteTable.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {activeTable && (
        <SchemaModal
          isOpen={isSchemaModalOpen}
          onClose={() => {
            setIsSchemaModalOpen(false)
            setActiveTable(null)
          }}
          columns={activeTable.schema.columns}
          tableName={activeTable.name}
        />
      )}

      <CreateModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </>
  )
}
