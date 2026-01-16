/**
 * Modal for viewing table schema.
 */

import { Info, X } from 'lucide-react'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/emcn'
import type { ColumnDefinition } from '@/lib/table'
import { getTypeBadgeVariant } from '../utils'

interface SchemaViewerModalProps {
  isOpen: boolean
  onClose: () => void
  columns: ColumnDefinition[]
}

/**
 * Displays the table schema in a modal.
 *
 * @param props - Component props
 * @returns Schema viewer modal
 */
export function SchemaViewerModal({ isOpen, onClose, columns }: SchemaViewerModalProps) {
  return (
    <Modal open={isOpen} onOpenChange={onClose}>
      <ModalContent className='w-[500px] duration-100'>
        <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
          <div className='flex min-w-0 items-center gap-[8px]'>
            <Info className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
            <span className='font-medium text-[14px] text-[var(--text-primary)]'>Table Schema</span>
            <Badge variant='gray' size='sm'>
              {columns.length} columns
            </Badge>
          </div>
          <Button variant='ghost' size='sm' onClick={onClose}>
            <X className='h-[14px] w-[14px]' />
          </Button>
        </div>
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
                {columns.map((column) => (
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
  )
}
