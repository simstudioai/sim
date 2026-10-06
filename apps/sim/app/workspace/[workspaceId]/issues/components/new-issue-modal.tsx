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
import { useRouter } from 'next/navigation'
import { useCreateIssue } from '@/hooks/queries/issues'

interface NewIssueModalProps {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Files an issue from a title and what is going wrong; the body starts as that description. */
export function NewIssueModal({ workspaceId, open, onOpenChange }: NewIssueModalProps) {
  const router = useRouter()
  const createIssue = useCreateIssue(workspaceId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  function close() {
    onOpenChange(false)
    setTitle('')
    setDescription('')
    createIssue.reset()
  }

  function create() {
    createIssue.mutate(
      { title, body: description.trim() ? `${description.trim()}\n` : '' },
      {
        onSuccess: ({ issue }) => {
          close()
          router.push(`/workspace/${workspaceId}/issues/${issue.key}`)
        },
      }
    )
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      srTitle='New issue'
      dismissDisabled={createIssue.isPending}
    >
      <ChipModalHeader onClose={close}>New issue</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField
          type='input'
          title='Title'
          value={title}
          onChange={setTitle}
          placeholder='Order-status escalations spiked this week'
          maxLength={200}
          autoComplete='off'
          required
          disabled={createIssue.isPending}
        />
        <ChipModalField
          type='textarea'
          title='What is going wrong'
          value={description}
          onChange={setDescription}
          placeholder='What you are seeing, where, and since when.'
          rows={6}
          disabled={createIssue.isPending}
        />
        <ChipModalError>{createIssue.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={createIssue.isPending}
        primaryAction={{
          label: createIssue.isPending ? 'Creating...' : 'Create',
          onClick: create,
          disabled: createIssue.isPending || title.trim().length === 0,
        }}
      />
    </ChipModal>
  )
}
