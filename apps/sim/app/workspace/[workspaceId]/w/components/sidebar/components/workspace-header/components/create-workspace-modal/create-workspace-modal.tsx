'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'

export type CreateWorkspaceTarget =
  | { type: 'personal' }
  | { type: 'organization'; organizationName: string }

export function getCreateWorkspaceCopy(target: CreateWorkspaceTarget) {
  if (target.type === 'organization') {
    return {
      title: `Create workspace in ${target.organizationName}`,
      description: `This workspace will belong to ${target.organizationName} and use its workspace policy.`,
    }
  }

  return {
    title: 'Create personal workspace',
    description: 'This workspace will belong to your personal account.',
  }
}

interface CreateWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (name: string) => Promise<void>
  isCreating: boolean
  target: CreateWorkspaceTarget
}

/**
 * Modal for naming a new workspace before creation.
 */
export function CreateWorkspaceModal({
  open,
  onOpenChange,
  onConfirm,
  isCreating,
  target,
}: CreateWorkspaceModalProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setName('')
      setError(null)
    }
  }

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || isCreating) return
    try {
      await onConfirm(trimmed)
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create workspace'))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const handleNameChange = (value: string) => {
    setName(value)
    setError(null)
  }

  const copy = getCreateWorkspaceCopy(target)

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle={copy.title}>
      <ChipModalHeader onClose={() => onOpenChange(false)}>{copy.title}</ChipModalHeader>
      <ChipModalBody onKeyDown={handleKeyDown}>
        <p className='px-2 text-[var(--text-muted)] text-sm'>{copy.description}</p>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={handleNameChange}
          placeholder='Workspace name'
          maxLength={100}
          autoComplete='off'
          disabled={isCreating}
          required
        />
        <ChipModalError>{error ?? undefined}</ChipModalError>
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
