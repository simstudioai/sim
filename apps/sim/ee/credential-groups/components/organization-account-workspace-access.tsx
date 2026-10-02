'use client'

import { useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { Plus, Workspaces } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryState } from 'nuqs'
import type { OrganizationAccountWorkspaceAccess as WorkspaceAccess } from '@/lib/api/contracts/organization-accounts'
import type { ProjectApi } from '@/lib/api/contracts/projects'
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
import { useOrganizationProjectsQuery } from '@/hooks/queries/projects'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'

type Grant = WorkspaceAccess['grants'][number]
type GrantEditor =
  | { mode: 'create'; revision: number }
  | { mode: 'edit'; grant: Grant; revision: number }
  | {
      mode: 'edit-project'
      project: ProjectApi
      grant: NonNullable<WorkspaceAccess['projectGrants']>[number]
      revision: number
    }

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
      search={{
        value: searchTerm,
        onChange: setSearchTerm,
        placeholder: 'Search projects and environments...',
      }}
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
        <SettingsEmptyState variant='inline'>Loading project access…</SettingsEmptyState>
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
  const projects = useOrganizationProjectsQuery(organizationId)
  const projectByWorkspace = new Map(
    (projects.data ?? []).flatMap((project) =>
      project.workspaces.map((environment) => [environment.id, project] as const)
    )
  )
  const projectGrants = access.projectGrants ?? []
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
    `${projectByWorkspace.get(workspace.id)?.name ?? ''} ${workspace.name}`
      .toLowerCase()
      .includes(normalizedSearch)
  )

  const save = async (
    grants: WorkspaceAccess['grants'],
    revision: number,
    nextProjectGrants = projectGrants
  ) => {
    try {
      await update.mutateAsync({
        organizationId,
        revision,
        grants,
        projectGrants: nextProjectGrants,
      })
      setEditor(null)
      toast.success('Project access updated')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update project access'))
    }
  }
  const saveGrant = (
    grants: Grant[],
    nextProjectGrants: NonNullable<WorkspaceAccess['projectGrants']>
  ) => {
    if (!editor) return
    const removedWorkspaceIds = new Set([
      ...(editor.mode === 'edit' ? [editor.grant.workspaceId] : []),
      ...grants.map((grant) => grant.workspaceId),
      ...(projects.data ?? [])
        .filter((project) => nextProjectGrants.some((grant) => grant.projectId === project.id))
        .flatMap((project) => project.workspaces.map((environment) => environment.id)),
    ])
    const removedProjectId = editor.mode === 'edit-project' ? editor.project.id : undefined
    void save(
      [...access.grants.filter((grant) => !removedWorkspaceIds.has(grant.workspaceId)), ...grants],
      editor.revision,
      [
        ...projectGrants.filter((grant) => grant.projectId !== removedProjectId),
        ...nextProjectGrants,
      ]
    )
  }
  const availableProjects = (projects.data ?? []).filter(
    (project) => !projectGrants.some((grant) => grant.projectId === project.id)
  )
  const visibleProjectGrants = projectGrants.filter(
    (grant) =>
      !normalizedSearch ||
      (projects.data ?? [])
        .find((project) => project.id === grant.projectId)
        ?.name.toLowerCase()
        .includes(normalizedSearch)
  )

  return (
    <>
      <SettingsSection
        label='Projects'
        action={
          <Chip
            leftAdornment={<Plus className='size-[14px]' />}
            disabled={
              update.isPending ||
              !availableProjects.length ||
              access.grants.length >= ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT
            }
            onClick={() => {
              update.reset()
              setEditor({ mode: 'create', revision: access.revision })
            }}
          >
            Add project
          </Chip>
        }
      >
        {update.error && (
          <p role='alert' className='mb-3 text-[var(--text-error)] text-caption'>
            {update.error.message}
          </p>
        )}
        {projects.error ? (
          <p role='alert' className='text-small'>
            {projects.error.message}
          </p>
        ) : !visibleWorkspaces.length && !visibleProjectGrants.length ? (
          <SettingsEmptyState variant='inline'>
            {normalizedSearch ? 'No projects match your search' : 'No projects have access'}
          </SettingsEmptyState>
        ) : (
          <div className={RESOURCE_LIST_STACK}>
            {visibleProjectGrants.map((grant) => {
              const project = (projects.data ?? []).find(
                (project) => project.id === grant.projectId
              ) ?? {
                id: grant.projectId,
                name: 'Unavailable project',
                organizationId,
                workspaces: [],
              }
              return (
                <SettingsResourceRow
                  key={project.id}
                  icon={<Workspaces aria-hidden />}
                  iconFilled
                  title={project.name}
                  description={`All current and future environments · ${grant.access.mode === 'all' ? 'All integrations' : grant.access.credentialTypes.map((type) => typesById.get(type)).join(', ')}`}
                  trailing={
                    <Chip
                      disabled={update.isPending}
                      onClick={() => {
                        update.reset()
                        setEditor({
                          mode: 'edit-project',
                          project,
                          grant,
                          revision: access.revision,
                        })
                      }}
                    >
                      Edit access
                    </Chip>
                  }
                />
              )
            })}
            {visibleWorkspaces.map((workspace) => {
              const grant = grantsById.get(workspace.id)!
              return (
                <SettingsResourceRow
                  key={workspace.id}
                  icon={<Workspaces className='text-[var(--text-icon)]' aria-hidden />}
                  iconFilled
                  title={`${projectByWorkspace.get(workspace.id)?.name ?? 'Project unavailable'} / ${workspace.name}`}
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
            ? ({ mode: 'create', projects: availableProjects } as const)
            : editor.mode === 'edit-project'
              ? ({
                  mode: 'edit-project',
                  project: editor.project,
                  grant: editor.grant,
                  onRemove: () =>
                    void save(
                      access.grants,
                      editor.revision,
                      projectGrants.filter((grant) => grant.projectId !== editor.project.id)
                    ),
                } as const)
              : ({
                  mode: 'edit',
                  grant: editor.grant,
                  workspaceName: byId.get(editor.grant.workspaceId)!.name,
                  onRemove: () =>
                    void save(
                      access.grants.filter(
                        (grant) => grant.workspaceId !== editor.grant.workspaceId
                      ),
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
