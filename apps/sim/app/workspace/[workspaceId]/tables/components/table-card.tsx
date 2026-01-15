'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { Columns, Info, Rows3, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Badge,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
} from '@/components/emcn'
import { useDeleteTable } from '@/hooks/queries/use-tables'
import type { TableDefinition } from '@/tools/table/types'

const logger = createLogger('TableCard')

/**
 * Props for the TableCard component.
 */
interface TableCardProps {
  /** The table definition to display */
  table: TableDefinition
  /** ID of the workspace containing this table */
  workspaceId: string
}

/**
 * Formats a date to relative time (e.g., "2h ago", "3d ago").
 *
 * @param dateValue - Date string or Date object to format
 * @returns Human-readable relative time string
 */
function formatRelativeTime(dateValue: string | Date): string {
  const dateString = typeof dateValue === 'string' ? dateValue : dateValue.toISOString()
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 604800)}w ago`
  if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)}mo ago`
  return `${Math.floor(diffInSeconds / 31536000)}y ago`
}

/**
 * Formats a date to absolute format for tooltip display.
 *
 * @param dateValue - Date string or Date object to format
 * @returns Formatted date string (e.g., "Jan 15, 2024, 10:30 AM")
 */
function formatAbsoluteDate(dateValue: string | Date): string {
  const dateString = typeof dateValue === 'string' ? dateValue : dateValue.toISOString()
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Gets the badge variant for a column type.
 *
 * @param type - The column type
 * @returns Badge variant name
 */
function getTypeBadgeVariant(
  type: string
): 'green' | 'blue' | 'purple' | 'orange' | 'teal' | 'gray' {
  switch (type) {
    case 'string':
      return 'green'
    case 'number':
      return 'blue'
    case 'boolean':
      return 'purple'
    case 'json':
      return 'orange'
    case 'date':
      return 'teal'
    default:
      return 'gray'
  }
}

/**
 * Card component for displaying a table summary.
 *
 * @remarks
 * Shows table name, column/row counts, description, and provides
 * actions for viewing schema and deleting the table.
 *
 * @example
 * ```tsx
 * <TableCard table={tableData} workspaceId="ws_123" />
 * ```
 */
export function TableCard({ table, workspaceId }: TableCardProps) {
  const router = useRouter()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isSchemaModalOpen, setIsSchemaModalOpen] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const deleteTable = useDeleteTable(workspaceId)

  /**
   * Handles table deletion.
   */
  const handleDelete = async () => {
    try {
      await deleteTable.mutateAsync(table.id)
      setIsDeleteDialogOpen(false)
    } catch (error) {
      logger.error('Failed to delete table:', error)
    }
  }

  /**
   * Navigates to the table detail page.
   */
  const navigateToTable = () => {
    router.push(`/workspace/${workspaceId}/tables/${table.id}`)
  }

  const columnCount = table.schema.columns.length

  return (
    <>
      <div
        role='button'
        tabIndex={0}
        data-table-card
        className='h-full cursor-pointer'
        onClick={navigateToTable}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            navigateToTable()
          }
        }}
      >
        <div className='group flex h-full flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
          <div className='flex items-center justify-between gap-[8px]'>
            <h3 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {table.name}
            </h3>
            <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='h-[20px] w-[20px] p-0 text-[var(--text-tertiary)]'
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className='h-[14px] w-[14px]' viewBox='0 0 16 16' fill='currentColor'>
                    <circle cx='8' cy='3' r='1.5' />
                    <circle cx='8' cy='8' r='1.5' />
                    <circle cx='8' cy='13' r='1.5' />
                  </svg>
                </Button>
              </PopoverTrigger>
              <PopoverContent align='end' className='w-[160px]'>
                <PopoverItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsMenuOpen(false)
                    setIsSchemaModalOpen(true)
                  }}
                >
                  <Info className='mr-[8px] h-[14px] w-[14px]' />
                  View Schema
                </PopoverItem>
                <PopoverItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsMenuOpen(false)
                    setIsDeleteDialogOpen(true)
                  }}
                  className='text-[var(--text-error)] hover:text-[var(--text-error)]'
                >
                  <Trash2 className='mr-[8px] h-[14px] w-[14px]' />
                  Delete
                </PopoverItem>
              </PopoverContent>
            </Popover>
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

      {/* Schema Viewer Modal */}
      <Modal open={isSchemaModalOpen} onOpenChange={setIsSchemaModalOpen}>
        <ModalContent className='w-[500px] duration-100'>
          <ModalHeader>
            <div className='flex items-center gap-[8px]'>
              <Info className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
              <span>{table.name}</span>
              <Badge variant='gray' size='sm'>
                {columnCount} columns
              </Badge>
            </div>
          </ModalHeader>
          <ModalBody className='p-0'>
            <div className='max-h-[400px] overflow-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[180px]'>Column</TableHead>
                    <TableHead className='w-[100px]'>Type</TableHead>
                    <TableHead>Constraints</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.schema.columns.map((column) => (
                    <TableRow key={column.name}>
                      <TableCell className='font-mono text-[12px] text-[var(--text-primary)]'>
                        {column.name}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getTypeBadgeVariant(column.type)} size='sm'>
                          {column.type}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-[12px]'>
                        <div className='flex gap-[6px]'>
                          {column.required && (
                            <Badge variant='red' size='sm'>
                              required
                            </Badge>
                          )}
                          {column.unique && (
                            <Badge variant='purple' size='sm'>
                              unique
                            </Badge>
                          )}
                          {!column.required && !column.unique && (
                            <span className='text-[var(--text-muted)]'>—</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}
