'use client'

import { useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Workspaces } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type { OrganizationAccountWorkspaceAccess as WorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { CredentialGroupAddResourceModal } from '@/ee/credential-groups/components/credential-group-add-resource-modal'
import {
  useOrganizationAccountWorkspaceAccess,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-accounts'

interface OrganizationAccountWorkspaceAccessProps {
  organizationId: string
}

export function OrganizationAccountWorkspaceAccess({
  organizationId,
}: OrganizationAccountWorkspaceAccessProps) {
  const access = useOrganizationAccountWorkspaceAccess(organizationId)
  if (access.error)
    return (
      <SettingsQueryErrorState
        error={access.error}
        fallback='Could not load workspace access'
        isRetrying={access.isFetching}
        onRetry={() => void access.refetch()}
      />
    )
  if (!access.data) return null
  return (
    <WorkspaceAccessForm
      key={organizationId}
      organizationId={organizationId}
      access={access.data}
    />
  )
}

interface WorkspaceAccessFormProps extends OrganizationAccountWorkspaceAccessProps {
  access: WorkspaceAccess
}

function WorkspaceAccessForm({ organizationId, access }: WorkspaceAccessFormProps) {
  const update = useUpdateOrganizationAccountWorkspaceAccess()
  const [showAddWorkspace, setShowAddWorkspace] = useState(false)

  const selectedIds = access.workspaceIds
  const selected = new Set(selectedIds)
  const workspacesById = new Map(access.workspaces.map((workspace) => [workspace.id, workspace]))
  if (selected.size !== selectedIds.length)
    throw new Error('Workspace access contains duplicate workspaces')
  for (const id of selectedIds) {
    if (!workspacesById.has(id))
      throw new Error(`Workspace access references unavailable workspace ${id}`)
  }
  const allowedWorkspaces = access.workspaces.filter((workspace) => selected.has(workspace.id))
  const availableWorkspaces = access.workspaces.filter((workspace) => !selected.has(workspace.id))

  const updateAccess = async (workspaceIds: string[]) => {
    try {
      await update.mutateAsync({
        organizationId,
        revision: access.revision,
        workspaceIds,
      })
      setShowAddWorkspace(false)
      toast.success('Workspace access updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update workspace access'))
    }
  }

  return (
    <SettingsPanel>
      <SettingsSection
        label='Workspace access'
        action={
          <Chip
            onClick={() => {
              update.reset()
              setShowAddWorkspace(true)
            }}
            disabled={
              update.isPending ||
              availableWorkspaces.length === 0 ||
              selectedIds.length >= ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT
            }
          >
            Add workspaces
          </Chip>
        }
      >
        {update.error && (
          <p role='alert' className='mb-3 px-0.5 text-[var(--text-error)] text-caption'>
            {update.error.message}
          </p>
        )}
        {allowedWorkspaces.length === 0 ? (
          <SettingsEmptyState variant='inline'>No workspaces have access</SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {allowedWorkspaces.map((workspace) => (
              <SettingsResourceRow
                key={workspace.id}
                icon={<Workspaces className='text-[var(--text-icon)]' aria-hidden />}
                iconFilled
                title={workspace.name}
                description='Authorized workflows can use every connected account in this organization'
                disabled={update.isPending}
                trailing={
                  update.isPending ? undefined : (
                    <RowActionsMenu
                      label={`${workspace.name} actions`}
                      actions={[
                        {
                          label: 'Remove',
                          destructive: true,
                          onSelect: () =>
                            void updateAccess(selectedIds.filter((id) => id !== workspace.id)),
                        },
                      ]}
                    />
                  )
                }
              />
            ))}
          </div>
        )}
      </SettingsSection>
      {showAddWorkspace && (
        <CredentialGroupAddResourceModal
          resourceType='workspace'
          resources={availableWorkspaces}
          disabled={update.isPending}
          error={update.error?.message}
          onAdd={(ids) => {
            for (const id of ids) {
              if (!workspacesById.has(id)) throw new Error(`Workspace ${id} is unavailable`)
              if (selected.has(id)) throw new Error(`Workspace ${id} already has access`)
            }
            if (selectedIds.length + ids.length > ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT) {
              throw new Error(
                `Workspace access cannot exceed ${ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT} workspaces`
              )
            }
            void updateAccess([...selectedIds, ...ids])
          }}
          onClose={() => setShowAddWorkspace(false)}
        />
      )}
    </SettingsPanel>
  )
}
