'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@sim/emcn'
import type { ForkSyncController } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import { useCreateForkSecretMapping } from '@/ee/workspace-forking/hooks/workspace-fork'

interface CreateMappedSecretProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  controller: ForkSyncController
  sourceId: string
  onCreated: (name: string) => void
}

/** Creates a secret in the sync's target and maps the source secret to it; drafts survive a failed create. */
export function CreateMappedSecret({
  open,
  onOpenChange,
  controller,
  sourceId,
  onCreated,
}: CreateMappedSecretProps) {
  const [name, setName] = useState(sourceId)
  const [value, setValue] = useState('')
  const create = useCreateForkSecretMapping()
  const canSubmit = !create.isPending && Boolean(name.trim()) && Boolean(value)

  const submit = () => {
    if (!canSubmit || !controller.otherWorkspaceId) return
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
          onOpenChange(false)
          toast.success('Secret created and mapped')
        },
      }
    )
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Create secret'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>
        Create secret in {controller.targetWorkspaceName}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Name'
          value={name}
          onChange={setName}
          maxLength={256}
          mono
          required
        />
        <ChipModalField
          type='input'
          inputType='password'
          title='Value'
          value={value}
          onChange={setValue}
          required
        />
        <ChipModalError>{create.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={create.isPending}
        primaryAction={{
          label: create.isPending ? 'Creating…' : 'Create and map',
          onClick: submit,
          disabled: !canSubmit,
        }}
      />
    </ChipModal>
  )
}
