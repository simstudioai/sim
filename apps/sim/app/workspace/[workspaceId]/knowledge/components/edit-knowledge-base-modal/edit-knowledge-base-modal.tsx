'use client'

import { memo, useRef, useState } from 'react'
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
import type { ChunkingConfig } from '@/lib/knowledge/types'
import { useTranslations } from 'next-intl'

const logger = createLogger('EditKnowledgeBaseModal')

interface EditKnowledgeBaseModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  initialName: string
  initialDescription: string
  chunkingConfig?: ChunkingConfig
  onSave: (id: string, name: string, description: string) => Promise<void>
}

/**
 * Modal for editing knowledge base name and description
 */
export const EditKnowledgeBaseModal = memo(function EditKnowledgeBaseModal({
  open,
  onOpenChange,
  knowledgeBaseId,
  initialName,
  initialDescription,
  chunkingConfig,
  onSave,
}: EditKnowledgeBaseModalProps) {
  const t = useTranslations('auto')
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [nameError, setNameError] = useState<string | null>(null)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Seed the fields only on the closed → open transition (render-phase reset),
   * so a prop change while the modal is open never clobbers in-progress edits.
   */
  const prevOpenRef = useRef(open)
  if (prevOpenRef.current !== open) {
    prevOpenRef.current = open
    if (open) {
      setName(initialName)
      setDescription(initialDescription)
      setNameError(null)
      setDescriptionError(null)
      setError(null)
    }
  }

  const validate = (): boolean => {
    let valid = true

    if (!name.trim()) {
      setNameError('Name is required')
      valid = false
    } else if (name.trim().length > 100) {
      setNameError('Name must be less than 100 characters')
      valid = false
    } else {
      setNameError(null)
    }

    if (description.length > 500) {
      setDescriptionError('Description must be less than 500 characters')
      valid = false
    } else {
      setDescriptionError(null)
    }

    return valid
  }

  const handleSubmit = async () => {
    if (!validate()) return

    setIsSubmitting(true)
    setError(null)

    try {
      await onSave(knowledgeBaseId, name.trim(), description.trim())
      onOpenChange(false)
    } catch (err) {
      logger.error('Error updating knowledge base:', err)
      setError(getErrorMessage(err, 'Failed to update knowledge base'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length > 0
  const isDirty = name !== initialName || description !== initialDescription

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Edit Knowledge Base'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{t('edit_knowledge_base')}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title={t('name')}
          value={name}
          onChange={setName}
          placeholder={t('enter_knowledge_base_name')}
          required
          error={nameError ?? undefined}
          autoComplete='off'
        />
        <ChipModalField
          type='textarea'
          title={t('description')}
          value={description}
          onChange={setDescription}
          placeholder={t('describe_this_knowledge_base_optional')}
          rows={4}
          error={descriptionError ?? undefined}
        />
        {chunkingConfig && (
          <ChipModalField type='custom' title={t('chunking_configuration')}>
            <div className='grid grid-cols-3 gap-2'>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>{t('max_size')}</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.maxSize.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    {t('tokens')}
                  </span>
                </p>
              </div>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>{t('min_size')}</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.minSize.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    {t('chars')}
                  </span>
                </p>
              </div>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>{t('overlap')}</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.overlap.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    {t('tokens')}
                  </span>
                </p>
              </div>
            </div>
          </ChipModalField>
        )}
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isSubmitting}
        primaryAction={{
          label: isSubmitting ? 'Saving...' : 'Save',
          onClick: handleSubmit,
          disabled: !isValid || !isDirty || isSubmitting,
        }}
      />
    </ChipModal>
  )
})
