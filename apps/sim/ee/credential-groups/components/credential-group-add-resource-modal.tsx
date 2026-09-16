'use client'

import { useState } from 'react'
import {
  ChipDropdown,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
} from '@sim/emcn'

interface CredentialGroupAddResourceModalBaseProps {
  resources: readonly { id: string; name: string }[]
  disabled: boolean
  error?: string
  onClose: () => void
}

type CredentialGroupAddResourceModalProps = CredentialGroupAddResourceModalBaseProps &
  (
    | { resourceType: 'workflow'; onAdd: (resourceId: string) => void }
    | { resourceType: 'workspace'; onAdd: (resourceIds: string[]) => void }
  )

export function CredentialGroupAddResourceModal(props: CredentialGroupAddResourceModalProps) {
  const { resources, resourceType, disabled, error, onClose } = props
  const [selectedResourceIds, setSelectedResourceIds] = useState<string[]>([])
  const label = resourceType === 'workspace' ? 'Workspaces' : 'Workflow'
  const title = resourceType === 'workspace' ? 'Add workspaces' : 'Add workflow'
  const options = resources.map((resource) => ({ value: resource.id, label: resource.name }))

  const handleAdd = () => {
    if (!selectedResourceIds.length)
      throw new Error(`Select a ${resourceType} before granting access`)
    if (new Set(selectedResourceIds).size !== selectedResourceIds.length) {
      throw new Error('Access selection contains duplicate resources')
    }
    const available = new Set(resources.map((resource) => resource.id))
    for (const id of selectedResourceIds) {
      if (!available.has(id)) throw new Error(`Selected ${resourceType} ${id} is unavailable`)
    }
    if (props.resourceType === 'workspace') props.onAdd(selectedResourceIds)
    else props.onAdd(selectedResourceIds[0])
  }

  return (
    <ChipModal
      open
      onOpenChange={(open) => !open && !disabled && onClose()}
      srTitle={title}
      size='sm'
      dismissDisabled={disabled}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={disabled}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='custom' title={label} required submitOnEnter={false}>
          {(aria) =>
            resourceType === 'workspace' ? (
              <ChipDropdown
                multiple
                options={options}
                value={selectedResourceIds}
                onChange={setSelectedResourceIds}
                allLabel='Select workspaces'
                showAllOption={false}
                searchPlaceholder='Search workspaces'
                searchable
                aria-label={label}
                disabled={disabled}
                fullWidth
                matchTriggerWidth
                align='start'
                {...aria}
              />
            ) : (
              <ChipSelect
                options={options}
                value={selectedResourceIds[0] ?? ''}
                onChange={(id) => setSelectedResourceIds([id])}
                placeholder={`Select ${resourceType}`}
                searchPlaceholder={`Search ${resourceType}s`}
                searchable
                aria-label={label}
                disabled={disabled}
                fullWidth
                dropdownWidth='trigger'
                align='start'
                {...aria}
              />
            )
          }
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        primaryAction={{
          label: title,
          onClick: handleAdd,
          disabled: disabled || selectedResourceIds.length === 0,
        }}
      />
    </ChipModal>
  )
}
