'use client'

import { useEffect, useState } from 'react'
import {
  Chip,
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
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create Workspace'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Create Workspace</ChipModalHeader>
      <ChipModalBody onKeyDown={handleKeyDown}>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='Workspace name'
          maxLength={100}
          autoComplete='off'
          disabled={isCreating}
          required
        />
        <ChipModalError>{undefined}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter>
        <Chip variant='filled' flush onClick={() => onOpenChange(false)} disabled={isCreating}>
          Cancel
        </Chip>
        <Chip
          variant='primary'
          flush
          onClick={() => void handleSubmit()}
          disabled={!name.trim() || isCreating}
        >
          {isCreating ? 'Creating...' : 'Create'}
        </Chip>
      </ChipModalFooter>
    </ChipModal>
  )
}
