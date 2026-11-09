'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { Modal } from '@sim/emcn/modal'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import {
  ActionRow,
  Muted,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import {
  automaticMatchWouldRemain,
  buildScimMappingBody,
  describeScimMapping,
  type MappingTargetKind,
  mappingChangesAllMembersPolicy,
  PERMISSION_OPTIONS,
  removeMappingConsequence,
  TARGET_KIND_OPTIONS,
  useDeleteScimGroupMapping,
  useOrganizationWorkspaces,
  usePermissionGroups,
  useScimGroupMappings,
  useUpsertScimGroupMapping,
  type WorkspacePermission,
} from '@/platform/lib/data/scim'
import { useSettingsUnsavedGuard } from '@/platform/lib/data/settings-guard'
import { plural } from '@/platform/shared/plural'

type PermissionGroups = NonNullable<ReturnType<typeof usePermissionGroups>['data']>
type Workspaces = NonNullable<ReturnType<typeof useOrganizationWorkspaces>['data']>

interface AddMappingProps {
  organizationId: string
  groupId: string
  permissionGroups: PermissionGroups
  workspaces: Workspaces
}

function AddMapping({ organizationId, groupId, permissionGroups, workspaces }: AddMappingProps) {
  const upsertMapping = useUpsertScimGroupMapping()
  const [targetKind, setTargetKind] = useState<MappingTargetKind>('permission_group')
  const [targetId, setTargetId] = useState('')
  const [permission, setPermission] = useState<WorkspacePermission>('read')
  const discard = () => {
    setTargetKind('permission_group')
    setTargetId('')
    setPermission('read')
  }
  useSettingsUnsavedGuard({
    isDirty: targetKind !== 'permission_group' || Boolean(targetId) || permission !== 'read',
    navigationBlocked: upsertMapping.isPending,
    onDiscard: discard,
  })
  const body = buildScimMappingBody(groupId, targetKind, targetId, permission)
  const changesAllMembersPolicy = mappingChangesAllMembersPolicy(
    targetKind === 'permission_group'
      ? permissionGroups.find((group) => group.id === targetId)
      : undefined
  )
  const targets = targetKind === 'permission_group' ? permissionGroups : workspaces

  async function add() {
    if (!body || upsertMapping.isPending) return
    try {
      const result = await upsertMapping.mutateAsync({ organizationId, body })
      discard()
      if ((result.mapping.unassignedMemberCount ?? 0) > 0) {
        toast.info('Mapping saved. Some permission-group memberships need attention below.')
      } else {
        toast.success(`Mapping saved. Checked ${plural(result.reconciledUsers, 'member')}.`)
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add mapping'))
    }
  }

  return (
    <>
      <ActionRow>
        <Select
          label='Mapping target type'
          disabled={upsertMapping.isPending}
          options={TARGET_KIND_OPTIONS}
          value={targetKind}
          onValueChange={(next) => {
            setTargetKind(next as MappingTargetKind)
            setTargetId('')
            setPermission('read')
          }}
        />
        {targetKind !== 'org_role' && (
          <SearchableSelect
            label={targetKind === 'workspace' ? 'Workspace' : 'Permission group'}
            labelHidden
            searchLabel={targetKind === 'workspace' ? 'Search workspaces' : 'Search groups'}
            disabled={upsertMapping.isPending}
            placeholder={targetKind === 'workspace' ? 'Choose a workspace' : 'Choose a group'}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
            value={targetId || null}
            onValueChange={(next) => setTargetId(next ?? '')}
          />
        )}
        {targetKind === 'workspace' && (
          <Select
            label='Workspace permission'
            disabled={upsertMapping.isPending}
            options={PERMISSION_OPTIONS}
            value={permission}
            onValueChange={(next) => setPermission(next as WorkspacePermission)}
          />
        )}
        <Button
          variant='primary'
          disabled={!body || upsertMapping.isPending}
          onClick={() => void add()}
        >
          {upsertMapping.isPending ? 'Adding…' : 'Add mapping'}
        </Button>
      </ActionRow>
      {changesAllMembersPolicy && (
        <Muted>
          This permission group currently governs everyone in its workspaces. Mapping it switches it
          permanently to selected members. Other members will use the remaining permission policy.
        </Muted>
      )}
    </>
  )
}

interface GroupMappingsProps {
  organizationId: string
  active: boolean
  autoMapByName: boolean
  onReconcile: () => Promise<void>
  reconciling: boolean
}

export function GroupMappings({
  organizationId,
  active,
  autoMapByName,
  onReconcile,
  reconciling,
}: GroupMappingsProps) {
  const {
    data: groups,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useScimGroupMappings(organizationId, active)
  const permissionGroupsQuery = usePermissionGroups(organizationId, active)
  const allPermissionGroups = permissionGroupsQuery.data ?? []
  // The default group governs by having no members, so it cannot be a membership target.
  const permissionGroups = allPermissionGroups.filter((group) => !group.isDefault)
  const workspacesQuery = useOrganizationWorkspaces(organizationId, active)
  const workspaces = workspacesQuery.data ?? []
  const deleteMapping = useDeleteScimGroupMapping()
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const pendingRemove = groups
    ?.flatMap((group) => group.mappings)
    .find((mapping) => mapping.id === pendingRemoveId)
  const names = {
    permissionGroups: new Map(permissionGroups.map((group) => [group.id, group.name])),
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }
  const automaticMatchRemains = automaticMatchWouldRemain(pendingRemove, autoMapByName, names)

  if (isLoading) return null
  if (groups === undefined && isError) {
    return (
      <FailureNotice
        message={getErrorMessage(error, 'Failed to load directory groups')}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  }
  if (permissionGroupsQuery.isPending || workspacesQuery.isPending) return null
  // The pickers and the name-match warning both read these, so a failed read must not look empty.
  if (!permissionGroupsQuery.data || !workspacesQuery.data) {
    return (
      <FailureNotice
        message='Failed to load mapping targets'
        retrying={permissionGroupsQuery.isFetching || workspacesQuery.isFetching}
        onRetry={() => {
          void permissionGroupsQuery.refetch()
          void workspacesQuery.refetch()
        }}
      />
    )
  }
  if (!groups || groups.length === 0) {
    return (
      <Muted>No groups yet. Push a group from your identity provider and it appears here.</Muted>
    )
  }

  return (
    <>
      {groups.map((group) => {
        const unassigned = group.mappings.filter(
          (mapping) => (mapping.unassignedMemberCount ?? 0) > 0
        )
        return (
          <div key={group.id}>
            <SettingsRow
              label={group.displayName}
              description={plural(group.memberCount, 'member')}
            />
            {group.mappings.map((mapping) => {
              const target = describeScimMapping(mapping, names)
              return (
                <SettingsRow
                  key={mapping.id}
                  label={target}
                  description={mapping.source === 'automatic' ? 'Automatic' : undefined}
                >
                  <ActionMenu
                    label={`${target} actions`}
                    icon='I108'
                    actions={[
                      {
                        id: 'remove',
                        label: 'Remove',
                        destructive: true,
                        disabled: deleteMapping.isPending,
                        onSelect: () => setPendingRemoveId(mapping.id),
                      },
                    ]}
                  />
                </SettingsRow>
              )
            })}
            {unassigned.length > 0 && (
              <InlineNotice
                intent='danger'
                message={`${unassigned
                  .map(
                    (mapping) =>
                      `${describeScimMapping(mapping, names)}: ${mapping.unassignedMemberCount} directory ${mapping.unassignedMemberCount === 1 ? 'member is' : 'members are'} not assigned.`
                  )
                  .join(
                    ' '
                  )} A member can belong to only one permission group per workspace. Review overlapping memberships in Permission groups, then reconcile.`}
                action={
                  <Button size='compact' disabled={reconciling} onClick={() => void onReconcile()}>
                    {reconciling ? 'Reconciling…' : 'Reconcile now'}
                  </Button>
                }
              />
            )}
            <AddMapping
              organizationId={organizationId}
              groupId={group.id}
              permissionGroups={permissionGroups}
              workspaces={workspaces}
            />
          </div>
        )
      })}
      <Modal
        variant='confirm'
        destructive
        open={active && pendingRemove !== undefined}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null)
        }}
        title='Remove mapping'
        description={`Remove the mapping to ${pendingRemove ? describeScimMapping(pendingRemove, names) : ''}? ${removeMappingConsequence(pendingRemove, automaticMatchRemains)}`}
        confirmLabel={deleteMapping.isPending ? 'Removing…' : 'Remove'}
        onConfirm={async () => {
          if (!pendingRemove) return
          await deleteMapping.mutateAsync({ organizationId, mappingId: pendingRemove.id })
          toast.success('Mapping removed')
        }}
      />
    </>
  )
}
