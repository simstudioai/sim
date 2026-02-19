'use client'

import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Columns, Rows3 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
} from '@/components/emcn'
import type { TableDefinition } from '@/lib/table'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { TableContextMenu } from '@/app/workspace/[workspaceId]/tables/components/table-context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useDeleteTable } from '@/hooks/queries/tables'
import { SchemaModal } from '../[tableId]/components/schema-modal'
import { formatAbsoluteDate, formatRelativeTime } from '../lib/utils'

const logger = createLogger('TableCard')

interface TableCardProps {
  table: TableDefinition
  workspaceId: string
}

export function TableCard({ table, workspaceId }: TableCardProps) {
  const router = useRouter()
  const userPermissions = useUserPermissionsContext()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false)

  const deleteTable = useDeleteTable(workspaceId)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const handleDelete = async () => {
    try {
      await deleteTable.mutateAsync(table.id)
      setIsDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Failed to delete table:', error)
    }
  }

  const navigateToTable = useCallback(() => {
    router.push(`/workspace/${workspaceId}/tables/${table.id}`)
  }, [router, workspaceId, table.id])

  const columnCount = table.schema.columns.length
  const shortId = `tb-${table.id.slice(0, 8)}`

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        data-table-card
        className='h-full cursor-pointer'
        onClick={(e) => {
          if (isContextMenuOpen) {
            e.preventDefault()
            return
          }
          navigateToTable()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            navigateToTable()
          }
        }}
        onContextMenu={handleContextMenu}
      >
        <div className='group flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
          <div className='flex items-center justify-between gap-[8px]'>
            <h3 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {table.name}
            </h3>
            <Badge className='flex-shrink-0 rounded-[4px] text-[12px]'>{shortId}</Badge>
          </div>

          <div className='flex flex-1 flex-col gap-[8px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[12px] text-[12px] text-[var(--text-tertiary)]'>
                <span className='flex items-center gap-[4px]'>
                  <Columns className='h-[12px] w-[12px]' />
                  {columnCount} {columnCount === 1 ? 'col' : 'cols'}
                </span>
                <span className='flex items-center gap-[4px]'>
                  <Rows3 className='h-[12px] w-[12px]' />
                  {table.rowCount} {table.rowCount === 1 ? 'row' : 'rows'}
                </span>
              </div>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='text-[12px] text-[var(--text-tertiary)]'>
                    {formatRelativeTime(table.updatedAt)}
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content>{formatAbsoluteDate(table.updatedAt)}</Tooltip.Content>
              </Tooltip.Root>
            </div>

            <div className='h-0 w-full border-[var(--divider)] border-t' />

            <p className='line-clamp-2 h-[36px] text-[12px] text-[var(--text-tertiary)] leading-[18px]'>
              {table.description || 'No description'}
            </p>
          </div>
        </div>
      </div>

      <TableContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={menuRef}
        onClose={closeContextMenu}
        onViewSchema={() => setIsSchemaModalOpen(true)}
        onCopyId={() => navigator.clipboard.writeText(table.id)}
        onDelete={() => setIsDeleteDialogOpen(true)}
        disableDelete={userPermissions.canEdit !== true}
      />

      {/* Delete Confirmation Modal */}
      <Modal open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete Table</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{table.name}</span>? This
              will permanently delete all {table.rowCount} rows.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsDeleteDialogOpen(false)}
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

      {/* Schema Viewer Modal */}
      <SchemaModal
        isOpen={isSchemaModalOpen}
        onClose={() => setIsSchemaModalOpen(false)}
        columns={table.schema.columns}
        tableName={table.name}
      />
    </>
  )
}
