'use client'

import { type ReactNode, useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import {
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { WorkspaceGrantModal } from '@/platform/app/(shell)/settings/_components/sections/connected-accounts/workspace-grant-modal'
import {
  Button,
  EmptyState,
  errorMessageOr,
  InlineNotice,
  LoadingRows,
  QueryBoundary,
  SearchField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  credentialGroupWorkspaceSearchParam,
  ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT,
  type OrganizationAccountWorkspaceAccess,
  useDebouncedSearchSetter,
  useOrganizationAccountWorkspaceAccess,
  useUpdateOrganizationAccountWorkspaceAccess,
} from '@/platform/lib/data/credential-groups'

type Grant = OrganizationAccountWorkspaceAccess['grants'][number]
type GrantEditor =
  | { mode: 'create'; revision: number }
  | { mode: 'edit'; grant: Grant; revision: number }

interface GroupAccessProps {
  organizationId: string
}

export function GroupAccess({ organizationId }: GroupAccessProps) {
  const access = useOrganizationAccountWorkspaceAccess(organizationId)
  const [searchTerm, setSearchParam] = useQueryState(credentialGroupWorkspaceSearchParam.key, {
    ...credentialGroupWorkspaceSearchParam.parser,
    history: 'replace',
    clearOnDefault: true,
  })
  const setSearchTerm = useDebouncedSearchSetter(setSearchParam)
  return (
    <SectionStack>
      <QueryBoundary
        query={access}
        failure={errorMessageOr('Could not load workspace access')}
        loadingLabel='Loading workspace access…'
        loading={
          <SettingsSection title='Workspaces'>
            <LoadingRows label='Loading workspace access…' />
          </SettingsSection>
        }
      >
        {(data) => (
          <WorkspaceAccessList
            key={organizationId}
            organizationId={organizationId}
            access={data}
            search={
              <SearchField
                label='Search workspaces'
                placeholder='Search workspaces…'
                value={searchTerm}
                onValueChange={setSearchTerm}
              />
            }
            searchTerm={searchTerm}
          />
        )}
      </QueryBoundary>
    </SectionStack>
  )
}

interface WorkspaceAccessListProps extends GroupAccessProps {
  access: OrganizationAccountWorkspaceAccess
  search: ReactNode
  searchTerm: string
}

function WorkspaceAccessList({
  organizationId,
  access,
  search,
  searchTerm,
}: WorkspaceAccessListProps) {
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
  const normalizedSearch = searchTerm.trim().toLowerCase()
  const visibleWorkspaces = access.workspaces.filter(
    (workspace) =>
      grantsById.has(workspace.id) && workspace.name.toLowerCase().includes(normalizedSearch)
  )
  const availableWorkspaces = access.workspaces.filter((workspace) => !grantsById.has(workspace.id))

  async function save(grants: OrganizationAccountWorkspaceAccess['grants'], revision: number) {
    try {
      await update.mutateAsync({ organizationId, revision, grants })
      setEditor(null)
      toast.success('Workspace access updated')
    } catch (failure) {
      toast.error(getErrorMessage(failure, 'Could not update workspace access'))
    }
  }

  function saveGrant(grant: Grant) {
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
      <SectionToolbar grow={search}>
        <Button
          variant='primary'
          size='compact'
          icon='I074'
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
        </Button>
      </SectionToolbar>
      {update.error && !editor && <InlineNotice intent='danger' message={update.error.message} />}
      <SettingsSection title='Workspaces'>
        {visibleWorkspaces.length === 0 ? (
          <EmptyState
            title={
              normalizedSearch ? 'No workspaces match your search' : 'No workspaces have access'
            }
          />
        ) : (
          visibleWorkspaces.map((workspace) => {
            const grant = grantsById.get(workspace.id)
            if (!grant) return null
            return (
              <SettingsRow
                key={workspace.id}
                label={workspace.name}
                description={
                  grant.access.mode === 'all'
                    ? 'All integrations'
                    : grant.access.credentialTypes
                        .map((type) => typesById.get(type) ?? type)
                        .sort((a, b) => a.localeCompare(b))
                        .join(', ')
                }
              >
                <Button
                  size='compact'
                  disabled={update.isPending}
                  onClick={() => {
                    update.reset()
                    setEditor({ mode: 'edit', grant, revision: access.revision })
                  }}
                >
                  Edit access
                </Button>
              </SettingsRow>
            )
          })
        )}
      </SettingsSection>
      {editor && (
        <WorkspaceGrantModal
          {...(editor.mode === 'create'
            ? ({ mode: 'create', workspaces: availableWorkspaces } as const)
            : ({
                mode: 'edit',
                grant: editor.grant,
                workspaceName: byId.get(editor.grant.workspaceId)?.name ?? '',
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
