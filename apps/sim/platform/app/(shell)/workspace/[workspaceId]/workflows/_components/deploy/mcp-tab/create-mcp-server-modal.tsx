'use client'

import { useState } from 'react'
import { FieldFrame, TextAreaField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { useCreateWorkflowMcpServer } from '@/platform/lib/data/workflow-deploy'

interface CreateMcpServerModalProps {
  workspaceId: string
  /** Only an admin may make a server public. */
  canChangeVisibility: boolean
  onClose: () => void
}

/** A new workflow MCP server for the workspace, private unless an admin opens it up. */
export function CreateMcpServerModal({
  workspaceId,
  canChangeVisibility,
  onClose,
}: CreateMcpServerModalProps) {
  const createServer = useCreateWorkflowMcpServer()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title='Add MCP server'
      confirmLabel={createServer.isPending ? 'Adding…' : 'Add server'}
      confirmDisabled={!name.trim()}
      onConfirm={async () => {
        await createServer.mutateAsync({
          workspaceId,
          name: name.trim(),
          description: description.trim() || undefined,
          isPublic,
        })
      }}
    >
      <TextField
        label='Server name'
        placeholder='e.g., My MCP Server'
        value={name}
        onChange={setName}
        required
        autoComplete='off'
      />
      <TextAreaField
        label='Description'
        placeholder='Describe what this MCP server does'
        value={description}
        onChange={setDescription}
        optional
      />
      <FieldFrame label='Access' hint={isPublic ? 'No authentication required' : undefined}>
        <SegmentedControl
          label='Server access'
          options={[
            { value: 'private', label: 'Private', disabled: !canChangeVisibility },
            { value: 'public', label: 'Public', disabled: !canChangeVisibility },
          ]}
          value={isPublic ? 'public' : 'private'}
          onSelect={(value) => setIsPublic(value === 'public')}
        />
      </FieldFrame>
    </Modal>
  )
}
