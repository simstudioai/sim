'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'

interface CreateWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => Promise<void>
  isCreating: boolean
}

/**
 * Modal for naming a new workspace before creation.
 */
export function CreateWorkspaceModal({
  open,
  onOpenChange,
  onConfirm,
  isCreating,
}: CreateWorkspaceModalProps) {
  const t = useTranslations('auto')
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || isCreating) return
    await onConfirm(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create workspace'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{t('create_workspace')}</ChipModalHeader>
      <ChipModalBody onKeyDown={handleKeyDown}>
        <ChipModalField
          type='input'
          title={t('name')}
          value={name}
          onChange={setName}
          placeholder={t('workspace_name')}
          maxLength={100}
          autoComplete='off'
          disabled={isCreating}
          required
        />
        <ChipModalError>{undefined}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isCreating}
        primaryAction={{
          label: isCreating ? 'Creating...' : 'Create',
          onClick: () => void handleSubmit(),
          disabled: !name.trim() || isCreating,
        }}
      />
    </ChipModal>
  )
}
