'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import { useTranslations } from 'next-intl'

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
  const t = useTranslations('auto')
  const [name, setName] = useState(initialName)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form fields when the modal opens (open transitions false → true).
  const prevOpenRef = useRef(open)
  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open
    if (open) {
      setName(initialName)
      setError(null)
    }
  }

  const handleSubmit = async () => {
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
      setError(getErrorMessage(err, 'Failed to rename document'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Rename Document'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{t('rename_document')}</ChipModalHeader>
      <ChipModalBody onKeyDown={handleKeyDown}>
        <ChipModalField
          type='input'
          title={t('name')}
          value={name}
          onChange={(value) => {
            setName(value)
            setError(null)
          }}
          placeholder={t('enter_document_name')}
          maxLength={255}
          autoComplete='off'
          disabled={isSubmitting}
          required
        />
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Renaming...' : 'Rename',
          onClick: () => void handleSubmit(),
          disabled: isSubmitting || !name?.trim() || name.trim() === initialName,
        }}
      />
    </ChipModal>
  )
}
