/**
 * Modal for viewing cell details.
 */

import { Copy, X } from 'lucide-react'
import { Badge, Button, Modal, ModalBody, ModalContent } from '@/components/emcn'
import type { CellViewerData } from '../types'

interface CellViewerModalProps {
  cellViewer: CellViewerData | null
  onClose: () => void
  onCopy: () => void
  copied: boolean
}

/**
 * Displays cell value details in a modal.
 *
 * @param props - Component props
 * @returns Cell viewer modal or null if no cell is selected
 */
export function CellViewerModal({ cellViewer, onClose, onCopy, copied }: CellViewerModalProps) {
  if (!cellViewer) return null

  return (
    <Modal open={!!cellViewer} onOpenChange={(open) => !open && onClose()}>
      <ModalContent className='w-[640px] duration-100'>
        <div className='flex items-center justify-between gap-[8px] px-[16px] py-[10px]'>
          <div className='flex min-w-0 items-center gap-[8px]'>
            <span className='truncate font-medium text-[14px] text-[var(--text-primary)]'>
              {cellViewer.columnName}
            </span>
            <Badge
              variant={
                cellViewer.type === 'json' ? 'blue' : cellViewer.type === 'date' ? 'purple' : 'gray'
              }
              size='sm'
            >
              {cellViewer.type === 'json' ? 'JSON' : cellViewer.type === 'date' ? 'Date' : 'Text'}
            </Badge>
          </div>
          <div className='flex shrink-0 items-center gap-[8px]'>
            <Button variant={copied ? 'tertiary' : 'default'} size='sm' onClick={onCopy}>
              <Copy className='mr-[4px] h-[12px] w-[12px]' />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
            <Button variant='ghost' size='sm' onClick={onClose}>
              <X className='h-[14px] w-[14px]' />
            </Button>
          </div>
        </div>
        <ModalBody className='p-0'>
          {cellViewer.type === 'json' ? (
            <pre className='m-[16px] max-h-[450px] overflow-auto rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] font-mono text-[12px] text-[var(--text-primary)] leading-[1.6]'>
              {JSON.stringify(cellViewer.value, null, 2)}
            </pre>
          ) : cellViewer.type === 'date' ? (
            <div className='m-[16px] space-y-[12px]'>
              <div className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px]'>
                <div className='mb-[6px] font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                  Formatted
                </div>
                <div className='text-[14px] text-[var(--text-primary)]'>
                  {new Date(String(cellViewer.value)).toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'short',
                  })}
                </div>
              </div>
              <div className='rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px]'>
                <div className='mb-[6px] font-medium text-[11px] text-[var(--text-tertiary)] uppercase tracking-wide'>
                  ISO Format
                </div>
                <div className='font-mono text-[13px] text-[var(--text-secondary)]'>
                  {String(cellViewer.value)}
                </div>
              </div>
            </div>
          ) : (
            <div className='m-[16px] max-h-[450px] overflow-auto whitespace-pre-wrap break-words rounded-[6px] border border-[var(--border)] bg-[var(--surface-4)] p-[16px] text-[13px] text-[var(--text-primary)] leading-[1.7]'>
              {String(cellViewer.value)}
            </div>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
