'use client'

import { useState } from 'react'
import { Checkbox, Chip, ChipInput, toast } from '@sim/emcn'
import type { OrganizationAccountWorkspaceAccess as WorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
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
  if (!access.data)
    return <p className='text-[var(--text-muted)] text-caption'>Loading workspace access…</p>
  return (
    <WorkspaceAccessForm
      key={access.data.revision}
      organizationId={organizationId}
      access={access.data}
    />
  )
}
interface WorkspaceAccessFormProps extends OrganizationAccountWorkspaceAccessProps {
  access: WorkspaceAccess
}
function WorkspaceAccessForm({ organizationId, access }: WorkspaceAccessFormProps) {
  const [selected, setSelected] = useState(() => {
    const available = new Set(access.workspaces.map((workspace) => workspace.id))
    return new Set(access.workspaceIds.filter((id) => available.has(id)))
  })
  const [search, setSearch] = useState('')
  const update = useUpdateOrganizationAccountWorkspaceAccess()
  const changed =
    selected.size !== access.workspaceIds.length ||
    access.workspaceIds.some((id) => !selected.has(id))
  const workspaces = access.workspaces.filter((workspace) =>
    workspace.name.toLowerCase().includes(search.trim().toLowerCase())
  )
  return (
    <div className='flex flex-col gap-4'>
      <p className='text-[var(--text-muted)] text-small'>
        Every authorized manual and deployed workflow in an allowed workspace can use every active
        account in this organization. Chat continues to use each person’s own connections.
      </p>
      <ChipInput
        placeholder='Search workspaces'
        aria-label='Search workspaces'
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className='flex flex-col gap-1'>
        {workspaces.map((workspace) => (
          <SettingsResourceRow
            key={workspace.id}
            title={workspace.name}
            trailing={
              <Checkbox
                aria-label={`Allow ${workspace.name}`}
                checked={selected.has(workspace.id)}
                disabled={update.isPending}
                onCheckedChange={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(workspace.id)
                    else next.delete(workspace.id)
                    return next
                  })
                }
              />
            }
          />
        ))}
      </div>
      {workspaces.length === 0 && (
        <p className='text-[var(--text-muted)] text-caption'>No matching workspaces.</p>
      )}
      {update.error && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {update.error.message}
        </p>
      )}
      <div>
        <Chip
          variant='primary'
          disabled={!changed || update.isPending}
          onClick={() =>
            update.mutate(
              { organizationId, revision: access.revision, workspaceIds: [...selected] },
              { onSuccess: () => toast.success('Workspace access updated') }
            )
          }
        >
          Save access
        </Chip>
      </div>
    </div>
  )
}
