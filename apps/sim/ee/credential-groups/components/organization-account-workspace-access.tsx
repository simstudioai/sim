'use client'

import { useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Plus, Workspaces } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import type { OrganizationAccountWorkspaceAccess as WorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
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
import { OrganizationWorkspaceGrantModal } from '@/ee/credential-groups/components/organization-workspace-grant-modal'
import { credentialGroupWorkspaceSearchParam } from '@/ee/credential-groups/search-params'
import {
  useOrganizationAccountWorkspaceAccess,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/hooks/queries/organization-accounts'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

type Grant = WorkspaceAccess['grants'][number]
type GrantEditor =
  | { mode: 'create'; revision: number }
  | { mode: 'edit'; grant: Grant; revision: number }

interface OrganizationAccountWorkspaceAccessProps {
  organizationId: string
}

export function OrganizationAccountWorkspaceAccess({
  organizationId,
}: OrganizationAccountWorkspaceAccessProps) {
  const access = useOrganizationAccountWorkspaceAccess(organizationId)
  const [searchTerm, setSearchParam] = useQueryState(credentialGroupWorkspaceSearchParam.key, {
    ...credentialGroupWorkspaceSearchParam.parser,
    history: 'replace',
    clearOnDefault: true,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchParam)
  return (
    <SettingsPanel
      search={{ value: searchTerm, onChange: setSearchTerm, placeholder: 'Search workspaces...' }}
    >
      {access.error ? (
        <SettingsQueryErrorState
          error={access.error}
          fallback='Could not load workspace access'
          isRetrying={access.isFetching}
          onRetry={() => void access.refetch()}
          variant='inline'
        />
      ) : !access.data ? (
        <SettingsEmptyState variant='inline'>Loading workspace access…</SettingsEmptyState>
      ) : (
        <WorkspaceAccessForm
          key={organizationId}
          organizationId={organizationId}
          access={access.data}
          searchTerm={searchTerm}
        />
      )}
    </SettingsPanel>
  )
}

interface WorkspaceAccessFormProps extends OrganizationAccountWorkspaceAccessProps {
  access: WorkspaceAccess
  searchTerm: string
}

function WorkspaceAccessForm({ organizationId, access, searchTerm }: WorkspaceAccessFormProps) {
  const update = useUpdateOrganizationAccountWorkspaceAccess()
  const [editor, setEditor] = useState<GrantEditor | null>(null)
  const byId = new Map(access.workspaces.map((workspace) => [workspace.id, workspace]))
  const grantsById = new Map(access.grants.map((grant) => [grant.workspaceId, grant]))
  const typesById = new Map(access.credentialTypes.map((type) => [type.id, type.label]))
  if (grantsById.size !== access.grants.length)
    throw new Error('Workspace access contains duplicate workspaces')
  for (const grant of access.grants) {
    if (!byId.has(grant.workspaceId))
      throw new Error(`Workspace access references unavailable workspace ${grant.workspaceId}`)
    if (grant.access.mode === 'selected') {
      for (const type of grant.access.credentialTypes) {
        if (!typesById.has(type)) throw new Error(`Unknown credential type ${type}`)
      }
    }
  }
  const allowedWorkspaces = access.workspaces.filter((workspace) => grantsById.has(workspace.id))
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const visibleWorkspaces = allowedWorkspaces.filter((workspace) =>
    workspace.name.toLowerCase().includes(normalizedSearch)
  )
  const availableWorkspaces = access.workspaces.filter((workspace) => !grantsById.has(workspace.id))

  const save = async (grants: WorkspaceAccess['grants'], revision: number) => {
    try {
      await update.mutateAsync({ organizationId, revision, grants })
      setEditor(null)
      toast.success('Workspace access updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update workspace access'))
    }
  }
  const saveGrant = (grant: Grant) => {
    if (!editor) throw new Error('Workspace access editor is not open')
    if (!byId.has(grant.workspaceId)) throw new Error('Selected workspace is unavailable')
    if (editor.mode === 'create') {
      if (grantsById.has(grant.workspaceId)) throw new Error('Workspace already has access')
      if (access.grants.length >= ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
        throw new Error(
          `Workspace access cannot exceed ${ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT} workspaces`
        )
      void save([...access.grants, grant], editor.revision)
    } else {
      if (grant.workspaceId !== editor.grant.workspaceId)
        throw new Error('Cannot change the workspace of an existing grant')
      void save(
        access.grants.map((existing) =>
          existing.workspaceId === grant.workspaceId ? grant : existing
        ),
        editor.revision
      )
    }
  }

  return (
    <>
      <SettingsSection
        label='Workspaces'
        action={
          <Chip
            leftAdornment={<Plus className='size-[14px]' />}
            disabled={
              update.isPending ||
              !availableWorkspaces.length ||
              access.grants.length >= ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT
            }
            onClick={() => {
              update.reset()
              setEditor({ mode: 'create', revision: access.revision })
            }}
          >
            Add workspace
          </Chip>
        }
      >
        {update.error && (
          <p role='alert' className='mb-3 text-[var(--text-error)] text-caption'>
            {update.error.message}
          </p>
        )}
        {!visibleWorkspaces.length ? (
          <SettingsEmptyState variant='inline'>
            {normalizedSearch ? 'No workspaces match your search' : 'No workspaces have access'}
          </SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {visibleWorkspaces.map((workspace) => {
              const grant = grantsById.get(workspace.id)!
              return (
                <SettingsResourceRow
                  key={workspace.id}
                  icon={<Workspaces className='text-[var(--text-icon)]' aria-hidden />}
                  iconFilled
                  title={workspace.name}
                  description={
                    grant.access.mode === 'all'
                      ? 'All integrations'
                      : grant.access.credentialTypes
                          .map((type) => typesById.get(type)!)
                          .sort((a, b) => a.localeCompare(b))
                          .join(', ')
                  }
                  trailing={
                    <Chip
                      disabled={update.isPending}
                      onClick={() => {
                        update.reset()
                        setEditor({ mode: 'edit', grant, revision: access.revision })
                      }}
                    >
                      Edit access
                    </Chip>
                  }
                />
              )
            })}
          </div>
        )}
      </SettingsSection>
      {editor && (
        <OrganizationWorkspaceGrantModal
          {...(editor.mode === 'create'
            ? ({ mode: 'create', workspaces: availableWorkspaces } as const)
            : ({
                mode: 'edit',
                grant: editor.grant,
                workspaceName: byId.get(editor.grant.workspaceId)!.name,
                onRemove: () =>
                  void save(
                    access.grants.filter((grant) => grant.workspaceId !== editor.grant.workspaceId),
                    editor.revision
                  ),
              } as const))}
          credentialTypes={access.credentialTypes}
          disabled={update.isPending}
          error={update.error?.message}
          onClose={() => setEditor(null)}
          onSave={saveGrant}
        />
      )}
    </>
  )
}
