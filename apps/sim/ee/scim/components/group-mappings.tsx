'use client'

import { useState } from 'react'
import { Chip, ChipConfirmModal, ChipSelect, ChipTag, toast } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useSettingsUnsavedGuard } from '@/components/settings/use-settings-unsaved-guard'
import type {
  ScimGroupMappingBody,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import type { PermissionGroup } from '@/lib/api/contracts/permission-groups'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/ee/access-control/hooks/permission-groups'
import {
  type MappingTargetKind,
  PERMISSION_OPTIONS,
  TARGET_KIND_OPTIONS,
  type WorkspacePermission,
} from '@/ee/scim/components/options'
import {
  useDeleteScimGroupMapping,
  useScimGroupMappings,
  useUpsertScimGroupMapping,
} from '@/ee/scim/hooks/scim'

function describeMapping(
  mapping: ScimGroupMappingView,
  names: { permissionGroups: Map<string, string>; workspaces: Map<string, string> }
): string {
  switch (mapping.targetKind) {
    case 'permission_group':
      return names.permissionGroups.get(mapping.permissionGroupId ?? '') ?? 'Permission group'
    case 'workspace': {
      const name = names.workspaces.get(mapping.workspaceId ?? '') ?? 'Workspace'
      const level = PERMISSION_OPTIONS.find((o) => o.value === mapping.permissionType)?.label
      return level ? `${name} · ${level}` : name
    }
    case 'org_role':
      return 'Organization admin'
  }
}

interface AddMappingProps {
  organizationId: string
  groupId: string
  permissionGroups: PermissionGroup[]
  workspaces: Array<{ id: string; name: string }>
}

function AddMapping({ organizationId, groupId, permissionGroups, workspaces }: AddMappingProps) {
  const upsertMapping = useUpsertScimGroupMapping()
  const [targetKind, setTargetKind] = useState<MappingTargetKind>('permission_group')
  const [targetId, setTargetId] = useState('')
  const [permission, setPermission] = useState<WorkspacePermission>('read')
  const discardMapping = () => {
    setTargetKind('permission_group')
    setTargetId('')
    setPermission('read')
  }
  useSettingsUnsavedGuard({
    isDirty: targetKind !== 'permission_group' || Boolean(targetId) || permission !== 'read',
    navigationBlocked: upsertMapping.isPending,
    onDiscard: discardMapping,
  })

  function buildBody(): ScimGroupMappingBody | null {
    switch (targetKind) {
      case 'permission_group':
        return targetId ? { groupId, targetKind, permissionGroupId: targetId } : null
      case 'workspace':
        return targetId
          ? { groupId, targetKind, workspaceId: targetId, permissionType: permission }
          : null
      case 'org_role':
        return { groupId, targetKind, role: 'admin' }
    }
  }

  const body = buildBody()
  const selectedPermissionGroup =
    targetKind === 'permission_group'
      ? permissionGroups.find((group) => group.id === targetId)
      : undefined
  const changesAllMembersPolicy =
    selectedPermissionGroup?.membershipMode === 'inherit' &&
    selectedPermissionGroup.memberCount === 0 &&
    selectedPermissionGroup.workspaces.length > 0

  async function handleAdd() {
    if (!body || upsertMapping.isPending) return
    try {
      const result = await upsertMapping.mutateAsync({ organizationId, body })
      discardMapping()
      if ((result.mapping.unassignedMemberCount ?? 0) > 0) {
        toast.info('Mapping saved. Some permission-group memberships need attention below.')
      } else {
        toast.success(
          `Mapping saved. Checked ${result.reconciledUsers} member${result.reconciledUsers === 1 ? '' : 's'}.`
        )
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add mapping'))
    }
  }

  const targetOptions = targetKind === 'permission_group' ? permissionGroups : workspaces

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <ChipSelect
          disabled={upsertMapping.isPending}
          aria-label='Mapping target type'
          align='start'
          value={targetKind}
          onChange={(next) => {
            setTargetKind(next as MappingTargetKind)
            setTargetId('')
            setPermission('read')
          }}
          options={[...TARGET_KIND_OPTIONS]}
        />
        {targetKind !== 'org_role' && (
          <ChipSelect
            disabled={upsertMapping.isPending}
            aria-label={targetKind === 'workspace' ? 'Workspace' : 'Permission group'}
            align='start'
            searchable
            placeholder={targetKind === 'workspace' ? 'Choose a workspace' : 'Choose a group'}
            value={targetId}
            onChange={setTargetId}
            options={targetOptions.map((target) => ({ value: target.id, label: target.name }))}
          />
        )}
        {targetKind === 'workspace' && (
          <ChipSelect
            disabled={upsertMapping.isPending}
            aria-label='Workspace permission'
            align='start'
            value={permission}
            onChange={(next) => setPermission(next as WorkspacePermission)}
            options={[...PERMISSION_OPTIONS]}
          />
        )}
        <Chip variant='primary' onClick={handleAdd} disabled={!body || upsertMapping.isPending}>
          {upsertMapping.isPending ? 'Adding...' : 'Add mapping'}
        </Chip>
      </div>
      {changesAllMembersPolicy && (
        <p className='text-[var(--text-muted)] text-caption'>
          This permission group currently governs everyone in its workspaces. Mapping it switches it
          permanently to selected members. Other members will use the remaining permission policy.
        </p>
      )}
    </div>
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
  const { data: allPermissionGroups = [] } = usePermissionGroups(organizationId, active)
  /** The default group governs by having no members, so it cannot be a membership target. */
  const permissionGroups = allPermissionGroups.filter((group) => !group.isDefault)
  const { data: workspaces = [] } = useOrganizationWorkspaces(organizationId, active)
  const deleteMapping = useDeleteScimGroupMapping()
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const pendingRemove = groups
    ?.flatMap((group) => group.mappings)
    .find((mapping) => mapping.id === pendingRemoveId)

  const names = {
    permissionGroups: new Map(permissionGroups.map((group) => [group.id, group.name])),
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }
  const automaticMatchRemains =
    pendingRemove?.targetKind === 'permission_group' &&
    autoMapByName &&
    (pendingRemove.source === 'automatic' ||
      names.permissionGroups.get(pendingRemove.permissionGroupId ?? '') ===
        pendingRemove.groupDisplayName)

  async function handleRemove() {
    if (!pendingRemove || deleteMapping.isPending) return
    try {
      await deleteMapping.mutateAsync({ organizationId, mappingId: pendingRemove.id })
      setPendingRemoveId(null)
      toast.success('Mapping removed')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove mapping'))
    }
  }

  if (isLoading) {
    return <SettingsEmptyState variant='inline'>Loading groups...</SettingsEmptyState>
  }
  if (groups === undefined && isError) {
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Failed to load directory groups'
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        variant='inline'
      />
    )
  }
  if (!groups || groups.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        No groups yet. Push a group from your identity provider and it appears here.
      </SettingsEmptyState>
    )
  }

  return (
    <>
      <div className='flex flex-col gap-5'>
        {groups.map((group) => {
          const unassignedMappings = group.mappings.filter(
            (mapping) => (mapping.unassignedMemberCount ?? 0) > 0
          )
          return (
            <div key={group.id} className='flex flex-col gap-3'>
              <SettingsResourceRow
                title={group.displayName}
                description={`${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`}
              />
              <div className='flex flex-col gap-3'>
                {group.mappings.length > 0 && (
                  <div className='flex flex-wrap gap-1.5'>
                    {group.mappings.map((mapping) => (
                      <ChipTag
                        key={mapping.id}
                        variant='gray'
                        rightIcon={X}
                        rightIconLabel={`Remove ${describeMapping(mapping, names)} mapping`}
                        rightIconDisabled={deleteMapping.isPending}
                        onRightIconClick={() => setPendingRemoveId(mapping.id)}
                      >
                        {describeMapping(mapping, names)}
                        {mapping.source === 'automatic' ? ' · Automatic' : ''}
                      </ChipTag>
                    ))}
                  </div>
                )}
                {unassignedMappings.length > 0 && (
                  <div className='flex flex-col gap-2'>
                    {unassignedMappings.map((mapping) => (
                      <p key={mapping.id} className='text-[var(--text-error)] text-caption'>
                        {describeMapping(mapping, names)}: {mapping.unassignedMemberCount} directory
                        {mapping.unassignedMemberCount === 1 ? ' member is' : ' members are'} not
                        assigned.
                      </p>
                    ))}
                    <p className='text-[var(--text-muted)] text-caption'>
                      A member can belong to only one permission group per workspace. Review
                      overlapping memberships in Permission groups, then reconcile.
                    </p>
                    <div>
                      <Chip onClick={onReconcile} disabled={reconciling}>
                        {reconciling ? 'Reconciling...' : 'Reconcile now'}
                      </Chip>
                    </div>
                  </div>
                )}
                <AddMapping
                  organizationId={organizationId}
                  groupId={group.id}
                  permissionGroups={permissionGroups}
                  workspaces={workspaces}
                />
              </div>
            </div>
          )
        })}
      </div>
      <ChipConfirmModal
        open={active && pendingRemove !== undefined}
        onOpenChange={(open) => !open && setPendingRemoveId(null)}
        title='Remove mapping'
        text={[
          'Remove the mapping to ',
          { text: pendingRemove ? describeMapping(pendingRemove, names) : '', bold: true },
          '? ',
          pendingRemove?.targetKind === 'permission_group'
            ? 'Members may keep workspace access under a different permission policy.'
            : 'Directory-managed access from this mapping will be withdrawn unless another mapping grants it. Existing manual access may remain.',
          ...(automaticMatchRemains
            ? [
                ' Name matching is enabled and can recreate this mapping. Turn off Match permission groups by name first to keep it removed.',
              ]
            : []),
        ]}
        confirm={{
          label: 'Remove',
          onClick: handleRemove,
          pending: deleteMapping.isPending,
          pendingLabel: 'Removing...',
        }}
      />
    </>
  )
}
