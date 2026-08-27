'use client'

import { useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
} from '@sim/emcn'
import type { CredentialGroupAccessResponse } from '@/lib/api/contracts/credential-groups'

type CredentialGroupWorkflow = CredentialGroupAccessResponse['workflows'][number]

interface CredentialGroupAddWorkflowModalProps {
  workflows: readonly CredentialGroupWorkflow[]
  disabled: boolean
  onAdd: (workflowId: string) => void
  onClose: () => void
}

export function CredentialGroupAddWorkflowModal({
  workflows,
  disabled,
  onAdd,
  onClose,
}: CredentialGroupAddWorkflowModalProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('')

  const handleAdd = () => {
    if (!selectedWorkflowId) throw new Error('Select a workflow before granting access')
    if (!workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      throw new Error(`Workflow ${selectedWorkflowId} is unavailable`)
    }
    onAdd(selectedWorkflowId)
    onClose()
  }

  return (
    <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='Add workflow' size='sm'>
      <ChipModalHeader onClose={onClose}>Add workflow</ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title='Workflow' required submitOnEnter={false}>
          {(aria) => (
            <ChipSelect
              options={workflows.map((workflow) => ({
                value: workflow.id,
                label: workflow.name,
              }))}
              value={selectedWorkflowId}
              onChange={setSelectedWorkflowId}
              placeholder='Select workflow'
              searchPlaceholder='Search workflows'
              searchable
              aria-label='Workflow'
              disabled={disabled}
              fullWidth
              dropdownWidth='trigger'
              align='start'
              {...aria}
            />
          )}
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: 'Add workflow',
          onClick: handleAdd,
          disabled: disabled || !selectedWorkflowId,
        }}
      />
    </ChipModal>
  )
}
