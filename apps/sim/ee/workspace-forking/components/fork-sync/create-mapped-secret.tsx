'use client'

import { useState } from 'react'
import { Chip, ChipInput, Label, toast } from '@sim/emcn'
import { SecretValueField } from '@/app/workspace/[workspaceId]/settings/components/secrets/components/secret-value-field/secret-value-field'
import type { ForkSyncController } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { useCreateForkSecretMapping } from '@/ee/workspace-forking/hooks/workspace-fork'

interface CreateMappedSecretProps {
  controller: ForkSyncController
  sourceId: string
  onCreated: (name: string) => void
  onCancel: () => void
}

/** Inline creation keeps an unresolved mapping in context and retains drafts after failure. */
export function CreateMappedSecret({
  controller,
  sourceId,
  onCreated,
  onCancel,
}: CreateMappedSecretProps) {
  const [name, setName] = useState(sourceId)
  const [value, setValue] = useState('')
  const create = useCreateForkSecretMapping()
  return (
    <form
      className='flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3'
      onSubmit={(event) => {
        event.preventDefault()
        if (create.isPending || !name.trim() || !value || !controller.otherWorkspaceId) return
        create.mutate(
          {
            workspaceId: controller.workspaceId,
            body: {
              otherWorkspaceId: controller.otherWorkspaceId,
              direction: controller.direction,
              sourceId,
              name: name.trim(),
              value,
            },
          },
          {
            onSuccess: (result) => {
              onCreated(result.name)
              toast.success('Secret created and mapped')
            },
          }
        )
      }}
    >
      <span className='text-[var(--text-body)] text-small'>
        Create secret in {controller.targetWorkspaceName}
      </span>
      <Label>Secret name</Label>
      <ChipInput
        aria-label='New secret name'
        value={name}
        onChange={(event) => setName(event.target.value)}
        autoFocus
        maxLength={256}
        disabled={create.isPending}
      />
      <Label>Value</Label>
      <SecretValueField
        aria-label='New secret value'
        value={value}
        onChange={setValue}
        canEdit
        disabled={create.isPending}
      />
      {create.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {create.error.message}
        </p>
      )}
      <div className='flex gap-2'>
        <Chip type='submit' variant='primary' disabled={create.isPending || !name.trim() || !value}>
          {create.isPending ? 'Creating…' : 'Create and map'}
        </Chip>
        <Chip type='button' disabled={create.isPending} onClick={onCancel}>
          Cancel
        </Chip>
      </div>
    </form>
  )
}
