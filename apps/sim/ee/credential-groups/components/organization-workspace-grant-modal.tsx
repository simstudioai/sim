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
import type { OrganizationAccountWorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { isOrganizationCredentialType } from '@/lib/credential-groups/credential-types'

type Grant = OrganizationAccountWorkspaceAccess['grants'][number]
const ALL_INTEGRATIONS = 'all'

type OrganizationWorkspaceGrantModalProps = {
  credentialTypes: OrganizationAccountWorkspaceAccess['credentialTypes']
  disabled: boolean
  error?: string
  onSave: (grant: Grant) => void
  onClose: () => void
} & (
  | { mode: 'create'; workspaces: OrganizationAccountWorkspaceAccess['workspaces'] }
  | { mode: 'edit'; grant: Grant; workspaceName: string; onRemove: () => void }
)

export function OrganizationWorkspaceGrantModal(props: OrganizationWorkspaceGrantModalProps) {
  const { credentialTypes, disabled, error, onSave, onClose } = props
  const [workspaceId, setWorkspaceId] = useState(
    props.mode === 'edit' ? props.grant.workspaceId : ''
  )
  const [access, setAccess] = useState<Grant['access']>(
    props.mode === 'edit' ? props.grant.access : { mode: 'selected', credentialTypes: [] }
  )
  const title = props.mode === 'create' ? 'Add workspace' : `Edit ${props.workspaceName} access`
  const save = () => {
    if (!workspaceId) throw new Error('Select a workspace before granting access')
    if (
      props.mode === 'create' &&
      !props.workspaces.some((workspace) => workspace.id === workspaceId)
    )
      throw new Error('Selected workspace is unavailable')
    if (access.mode === 'selected' && !access.credentialTypes.length)
      throw new Error('Select at least one integration')
    onSave({ workspaceId, access })
  }

  return (
    <ChipModal
      open
      size='sm'
      srTitle={title}
      dismissDisabled={disabled}
      onOpenChange={(open) => !open && !disabled && onClose()}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={disabled}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {props.mode === 'create' && (
          <ChipModalField type='custom' title='Workspace' required submitOnEnter={false}>
            {(aria) => (
              <ChipSelect
                options={props.workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
                value={workspaceId}
                onChange={setWorkspaceId}
                placeholder='Select workspace'
                aria-label='Workspace'
                searchable
                searchPlaceholder='Search workspaces'
                disabled={disabled}
                fullWidth
                dropdownWidth='trigger'
                align='start'
                {...aria}
              />
            )}
          </ChipModalField>
        )}
        <ChipModalField
          type='custom'
          title='Integrations'
          required
          submitOnEnter={false}
          hint={access.mode === 'all' ? 'Includes integrations added in the future.' : undefined}
        >
          {(aria) => (
            <ChipDropdown
              multiple
              options={[
                { value: ALL_INTEGRATIONS, label: 'All integrations' },
                ...credentialTypes.map((type) => ({ value: type.id, label: type.label })),
              ]}
              value={access.mode === 'all' ? [ALL_INTEGRATIONS] : access.credentialTypes}
              onChange={(values) => {
                if (access.mode !== 'all' && values.includes(ALL_INTEGRATIONS)) {
                  setAccess({ mode: 'all' })
                  return
                }
                const selected = values.filter((value) => value !== ALL_INTEGRATIONS)
                if (!selected.every(isOrganizationCredentialType))
                  throw new Error('Unknown credential type')
                setAccess({ mode: 'selected', credentialTypes: selected })
              }}
              allLabel='Select integrations'
              aria-label='Integrations'
              showAllOption={false}
              searchable
              searchPlaceholder='Search integrations'
              disabled={disabled}
              fullWidth
              matchTriggerWidth
              align='start'
              {...aria}
            />
          )}
        </ChipModalField>
        <ChipModalError>{error}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={disabled}
        primaryAction={{
          label: props.mode === 'create' ? 'Add workspace' : 'Save access',
          disabled:
            disabled ||
            !workspaceId ||
            (access.mode === 'selected' && !access.credentialTypes.length),
          onClick: save,
        }}
        secondaryActions={
          props.mode === 'edit'
            ? [
                {
                  label: 'Remove access',
                  variant: 'destructive',
                  disabled,
                  onClick: props.onRemove,
                },
              ]
            : undefined
        }
      />
    </ChipModal>
  )
}
