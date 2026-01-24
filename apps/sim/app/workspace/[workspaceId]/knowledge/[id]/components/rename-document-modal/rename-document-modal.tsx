'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

const logger = createLogger('RenameDocumentModal')

interface RenameDocumentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentId: string
  initialName: string
  onSave: (documentId: string, newName: string) => Promise<void>
}

/**
 * Modal for renaming a document.
 * Only changes the display name, not the underlying storage key.
 */
export function RenameDocumentModal({
  open,
  onOpenChange,
  documentId,
  initialName,
  onSave,
}: RenameDocumentModalProps) {
  const [name, setName] = useState(initialName)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setError(null)
    }
  }, [open, initialName])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedName = name.trim()

    if (!trimmedName) {
      setError('Name is required')
      return
    }

    if (trimmedName === initialName) {
      onOpenChange(false)
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await onSave(documentId, trimmedName)
      onOpenChange(false)
    } catch (err) {
      logger.error('Error renaming document:', err)
      setError(err instanceof Error ? err.message : 'Failed to rename document')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>Rename Document</ModalHeader>
        <form onSubmit={handleSubmit} className='flex min-h-0 flex-1 flex-col'>
          <ModalBody className='!pb-[16px]'>
            <div className='space-y-[12px]'>
              <div className='flex flex-col gap-[8px]'>
                <Label htmlFor='document-name'>Name</Label>
                <Input
                  id='document-name'
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    setError(null)
                  }}
                  placeholder='Enter document name'
                  className={cn(error && 'border-[var(--text-error)]')}
                  disabled={isSubmitting}
                  autoFocus
                  maxLength={255}
                  autoComplete='off'
                  autoCorrect='off'
                  autoCapitalize='off'
                  data-lpignore='true'
                  data-form-type='other'
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <div className='flex w-full items-center justify-between gap-[12px]'>
              {error ? (
                <p className='min-w-0 flex-1 truncate text-[12px] text-[var(--text-error)] leading-tight'>
                  {error}
                </p>
              ) : (
                <div />
              )}
              <div className='flex flex-shrink-0 gap-[8px]'>
                <Button
                  variant='default'
                  onClick={() => onOpenChange(false)}
                  type='button'
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant='tertiary'
                  type='submit'
                  disabled={isSubmitting || !name?.trim() || name.trim() === initialName}
                >
                  {isSubmitting ? 'Renaming...' : 'Rename'}
                </Button>
              </div>
            </div>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
