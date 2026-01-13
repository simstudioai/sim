'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Database, MoreVertical, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
} from '@/components/emcn'
import { useDeleteTable } from '@/hooks/queries/use-tables'
import type { TableDefinition } from '@/tools/table/types'

const logger = createLogger('TableCard')

interface TableCardProps {
  table: TableDefinition
  workspaceId: string
}

export function TableCard({ table, workspaceId }: TableCardProps) {
  const router = useRouter()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const deleteTable = useDeleteTable(workspaceId)

  const handleDelete = async () => {
    try {
      await deleteTable.mutateAsync(table.id)
      setIsDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Failed to delete table:', error)
    }
  }

  const columnCount = table.schema.columns.length

  return (
    <>
      <div
        data-table-card
        className='group relative cursor-pointer rounded-[8px] border border-[var(--border-muted)] bg-[var(--surface-1)] p-[16px] transition-colors hover:border-[var(--border-color)]'
        onClick={() => router.push(`/workspace/${workspaceId}/tables/${table.id}`)}
      >
        <div className='flex items-start justify-between gap-[8px]'>
          <div className='flex min-w-0 flex-1 items-start gap-[12px]'>
            <div className='mt-[2px] flex-shrink-0'>
              <div className='flex h-[40px] w-[40px] items-center justify-center rounded-[8px] border border-[#3B82F6] bg-[#EFF6FF] dark:border-[#1E40AF] dark:bg-[#1E3A5F]'>
                <Database className='h-[20px] w-[20px] text-[#3B82F6] dark:text-[#60A5FA]' />
              </div>
            </div>

            <div className='min-w-0 flex-1'>
              <h3 className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
                {table.name}
              </h3>

              {table.description && (
                <p className='mt-[4px] line-clamp-2 text-[12px] text-[var(--text-tertiary)]'>
                  {table.description}
                </p>
              )}

              <div className='mt-[12px] flex items-center gap-[16px] text-[11px] text-[var(--text-subtle)]'>
                <span>{columnCount} columns</span>
                <span>{table.rowCount} rows</span>
              </div>

              <div className='mt-[8px] text-[11px] text-[var(--text-muted)]'>
                Updated {new Date(table.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </div>

          <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant='ghost'
                size='sm'
                className='h-[24px] w-[24px] p-0 opacity-0 group-hover:opacity-100'
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className='h-[14px] w-[14px]' />
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' className='w-[160px]'>
              <PopoverItem
                onClick={(e) => {
                  e.stopPropagation()
                  setIsMenuOpen(false)
                  setIsDeleteDialogOpen(true)
                }}
              >
                <Trash2 className='mr-[8px] h-[14px] w-[14px]' />
                Delete
              </PopoverItem>
            </PopoverContent>
          </Popover>
        </div>
      </div>

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
            <Button
              variant='ghost'
              onClick={handleDelete}
              disabled={deleteTable.isPending}
              className='text-[var(--text-error)] hover:text-[var(--text-error)]'
            >
              {deleteTable.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
