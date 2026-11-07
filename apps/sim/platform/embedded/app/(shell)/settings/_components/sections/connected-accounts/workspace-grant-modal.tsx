'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { InlineNotice } from '@sim/emcn/status'
import type { OrganizationAccountWorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { isOrganizationCredentialType } from '@/lib/credential-groups/credential-types'

type Grant = OrganizationAccountWorkspaceAccess['grants'][number]
const ALL_INTEGRATIONS = 'all'

interface WorkspaceGrantModalBaseProps {
  credentialTypes: OrganizationAccountWorkspaceAccess['credentialTypes']
  disabled: boolean
  error?: string
  /** Settles with the save, for the dialog to hold on. */
  onSave: (grant: Grant) => Promise<void>
  onClose: () => void
}

interface WorkspaceGrantModalProps extends WorkspaceGrantModalBaseProps {
  target:
    | { mode: 'create'; workspaces: OrganizationAccountWorkspaceAccess['workspaces'] }
    | { mode: 'edit'; grant: Grant; workspaceName: string; onRemove: () => void }
}

/** All integrations is an explicit grant; an empty picker selection never grants access. */
export function WorkspaceGrantModal({
  target,
  credentialTypes,
  disabled,
  error,
  onSave,
  onClose,
}: WorkspaceGrantModalProps) {
  const [workspaceId, setWorkspaceId] = useState(
    target.mode === 'edit' ? target.grant.workspaceId : ''
  )
  const [access, setAccess] = useState<Grant['access']>(
    target.mode === 'edit' ? target.grant.access : { mode: 'selected', credentialTypes: [] }
  )

  async function save() {
    if (!workspaceId) throw new Error('Select a workspace before granting access')
    if (
      target.mode === 'create' &&
      !target.workspaces.some((workspace) => workspace.id === workspaceId)
    )
      throw new Error('Selected workspace is unavailable')
    if (access.mode === 'selected' && !access.credentialTypes.length)
      throw new Error('Select at least one integration')
    await onSave({ workspaceId, access })
    return false
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !disabled) onClose()
      }}
      title={target.mode === 'create' ? 'Add workspace' : `Edit ${target.workspaceName} access`}
      confirmLabel={target.mode === 'create' ? 'Add workspace' : 'Save access'}
      pending={disabled}
      confirmDisabled={
        disabled || !workspaceId || (access.mode === 'selected' && !access.credentialTypes.length)
      }
      onConfirm={save}
    >
      {target.mode === 'create' && (
        <SearchableSelect
          label='Workspace'
          searchLabel='Search workspaces'
          placeholder='Select workspace'
          options={target.workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
          value={workspaceId || null}
          onValueChange={(value) => setWorkspaceId(value ?? '')}
          disabled={disabled}
        />
      )}
      <MultiSelect
        label='Integrations'
        searchLabel='Search integrations'
        placeholder='Select integrations'
        options={[
          { value: ALL_INTEGRATIONS, label: 'All integrations' },
          ...credentialTypes.map((type) => ({ value: type.id, label: type.label })),
        ]}
        value={access.mode === 'all' ? [ALL_INTEGRATIONS] : access.credentialTypes}
        onValueChange={(values) => {
          if (access.mode !== 'all' && values.includes(ALL_INTEGRATIONS)) {
            setAccess({ mode: 'all' })
            return
          }
          const selected = values.filter((value) => value !== ALL_INTEGRATIONS)
          if (!selected.every(isOrganizationCredentialType))
            throw new Error('Unknown credential type')
          setAccess({ mode: 'selected', credentialTypes: selected })
        }}
        hint={access.mode === 'all' ? 'Includes integrations added in the future.' : undefined}
        disabled={disabled}
      />
      {target.mode === 'edit' && (
        <div>
          <Button
            variant='destructive'
            size='compact'
            disabled={disabled}
            onClick={target.onRemove}
          >
            Remove access
          </Button>
        </div>
      )}
      {error && <InlineNotice intent='danger' message={error} />}
    </Modal>
  )
}
