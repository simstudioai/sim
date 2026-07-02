'use client'

import { memo, useRef, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH } from '@/lib/knowledge/constants'
import type { ChunkingConfig } from '@/lib/knowledge/types'

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
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
    }
  }

  const validate = (): string | null => {
    if (!name.trim()) return 'Name is required'
    if (name.trim().length > 100) return 'Name must be less than 100 characters'
    if (description.length > KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH) {
      return `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
    }
    return null
  }

  const handleSubmit = async () => {
    const validationError = validate()
    if (validationError) {
      toast.error(validationError)
      return
    }

    setIsSubmitting(true)

    try {
      await onSave(knowledgeBaseId, name.trim(), description.trim())
      onOpenChange(false)
    } catch (err) {
      logger.error('Error updating knowledge base:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length > 0
  const isDirty = name !== initialName || description !== initialDescription

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Edit Knowledge Base'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Edit Knowledge Base</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='Enter knowledge base name'
          required
          autoComplete='off'
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='Describe this knowledge base (optional)'
          rows={4}
        />
        {chunkingConfig && (
          <ChipModalField type='custom' title='Chunking Configuration'>
            <div className='grid grid-cols-3 gap-2'>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>Max Size</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.maxSize.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    tokens
                  </span>
                </p>
              </div>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>Min Size</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.minSize.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    chars
                  </span>
                </p>
              </div>
              <div className='rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] px-2.5 py-2'>
                <p className='text-[11px] text-[var(--text-tertiary)] leading-tight'>Overlap</p>
                <p className='font-medium text-[var(--text-primary)] text-sm'>
                  {chunkingConfig.overlap.toLocaleString()}
                  <span className='ml-0.5 font-normal text-[11px] text-[var(--text-tertiary)]'>
                    tokens
                  </span>
                </p>
              </div>
            </div>
          </ChipModalField>
        )}
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
