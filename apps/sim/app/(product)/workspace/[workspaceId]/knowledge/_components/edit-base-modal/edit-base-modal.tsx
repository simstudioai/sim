'use client'

import { useState } from 'react'
import { TextAreaField, TextField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { Modal } from '@sim/emcn/modal'
import {
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
  type KnowledgeBaseData,
  useUpdateKnowledgeBase,
} from '@/platform/lib/data/knowledge'
import { LOCALE } from '@/platform/shared/time'

interface EditBaseModalProps {
  /** The base being edited; the dialog is open while it is set. */
  base: KnowledgeBaseData | null
  onClose: () => void
}

/** A knowledge base's name and description, beside the chunking it was created with. */
export function EditBaseModal({ base, onClose }: EditBaseModalProps) {
  const update = useUpdateKnowledgeBase()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ name?: string; description?: string }>({})
  const [shownId, setShownId] = useState<string | null>(null)
  if ((base?.id ?? null) !== shownId) {
    setShownId(base?.id ?? null)
    if (base) {
      setName(base.name)
      setDescription(base.description ?? '')
      setErrors({})
    }
  }
  const config = base?.chunkingConfig
  const dirty = Boolean(base) && (name !== base?.name || description !== (base?.description ?? ''))
  return (
    <Modal
      open={base !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Edit knowledge base'
      confirmLabel='Save'
      confirmDisabled={!name.trim() || !dirty}
      onConfirm={async () => {
        if (!base) return
        const found = {
          name: !name.trim()
            ? 'Name is required'
            : name.trim().length > 100
              ? 'Name must be less than 100 characters'
              : undefined,
          description:
            description.length > KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH
              ? `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
              : undefined,
        }
        setErrors(found)
        if (found.name || found.description) return false
        await update.mutateAsync({
          knowledgeBaseId: base.id,
          updates: { name: name.trim(), description: description.trim() },
        })
      }}
    >
      <TextField
        label='Name'
        placeholder='Enter knowledge base name'
        value={name}
        onChange={setName}
        error={errors.name}
        autoComplete='off'
        required
      />
      <TextAreaField
        label='Description'
        optional
        placeholder='Describe this knowledge base'
        value={description}
        onChange={setDescription}
        error={errors.description}
      />
      {config && (
        <DetailsField label='Chunking configuration'>
          {`Max size ${config.maxSize.toLocaleString(LOCALE)} tokens · Min size ${config.minSize.toLocaleString(LOCALE)} characters · Overlap ${config.overlap.toLocaleString(LOCALE)} tokens`}
        </DetailsField>
      )}
    </Modal>
  )
}
