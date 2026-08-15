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
import { useCreateCredentialGroup } from '@/hooks/queries/credential-groups'

interface CredentialGroupCreateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (groupId: string) => void
  workspaceId: string
}

export function CredentialGroupCreateModal({
  open,
  onOpenChange,
  onCreated,
  workspaceId,
}: CredentialGroupCreateModalProps) {
  const createGroup = useCreateCredentialGroup()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const reset = () => {
    setName('')
    setDescription('')
    createGroup.reset()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (createGroup.isPending) return
    onOpenChange(nextOpen)
    if (!nextOpen) reset()
  }

  const handleCreate = async () => {
    if (!name.trim() || createGroup.isPending) return
    try {
      const result = await createGroup.mutateAsync({
        workspaceId,
        body: {
          name: name.trim(),
          description: description.trim() || undefined,
          options: [],
        },
      })
      onCreated(result.credentialGroup.id)
      handleOpenChange(false)
    } catch {
      return
    }
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      srTitle='Create credential group'
      size='md'
      dismissDisabled={createGroup.isPending}
    >
      <ChipModalHeader onClose={() => handleOpenChange(false)}>
        Create credential group
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          placeholder='Customer support accounts'
          required
        />
        <ChipModalField
          type='textarea'
          title='Description'
          value={description}
          onChange={setDescription}
          placeholder='What these accounts will be used for'
        />
        <ChipModalError>
          {createGroup.error ? getErrorMessage(createGroup.error) : null}
        </ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => handleOpenChange(false)}
        cancelDisabled={createGroup.isPending}
        primaryAction={{
          label: createGroup.isPending ? 'Creating...' : 'Create',
          onClick: handleCreate,
          disabled: !name.trim() || createGroup.isPending,
        }}
      />
    </ChipModal>
  )
}
