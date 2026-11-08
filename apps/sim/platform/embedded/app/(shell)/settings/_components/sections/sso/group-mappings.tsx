'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import type {
  PermissionGroup,
  PermissionGroupWorkspaceRef,
} from '@/lib/api/contracts/permission-groups'
import {
  type MappingTargetKind,
  PERMISSION_OPTIONS,
  TARGET_KIND_OPTIONS,
  type WorkspacePermission,
} from '@/ee/scim/components/options'
import {
  automaticMatchWouldRemain,
  buildScimMappingBody,
  describeScimMapping,
  mappingChangesAllMembersPolicy,
  removeMappingConsequence,
} from '@/ee/scim/lib/group-mapping-view'
import { useSettingsUnsavedGuard } from '@/hooks/use-settings-unsaved-guard'
import {
  ActionRow,
  Muted,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import {
  useScimGroupMappingList,
  useScimMappingAdd,
} from '@/platform/embedded/lib/data/sso-settings'
import { plural } from '@/platform/shared/plural'

interface AddMappingProps {
  organizationId: string
  groupId: string
  permissionGroups: PermissionGroup[]
  workspaces: PermissionGroupWorkspaceRef[]
}

function AddMapping({ organizationId, groupId, permissionGroups, workspaces }: AddMappingProps) {
  const mapping = useScimMappingAdd(organizationId)
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
    navigationBlocked: mapping.adding,
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
    if (!body || mapping.adding) return
    await mapping.add(body, discard)
  }

  return (
    <>
      <ActionRow>
        <Select
          label='Mapping target type'
          disabled={mapping.adding}
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
            disabled={mapping.adding}
            placeholder={targetKind === 'workspace' ? 'Choose a workspace' : 'Choose a group'}
            options={targets.map((target) => ({ value: target.id, label: target.name }))}
            value={targetId || null}
            onValueChange={(next) => setTargetId(next ?? '')}
          />
        )}
        {targetKind === 'workspace' && (
          <Select
            label='Workspace permission'
            disabled={mapping.adding}
            options={PERMISSION_OPTIONS}
            value={permission}
            onValueChange={(next) => setPermission(next as WorkspacePermission)}
          />
        )}
        <Button variant='primary' disabled={!body || mapping.adding} onClick={() => void add()}>
          {mapping.adding ? 'Adding…' : 'Add mapping'}
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
  const list = useScimGroupMappingList(organizationId, active)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)

  if (list.status === 'loading') return <LoadingRows label='Loading groups…' />
  if (list.status === 'failed') {
    return <FailureNotice message={list.message} retrying={list.retrying} onRetry={list.retry} />
  }
  const { groups, permissionGroups, workspaces, targetsFailure } = list
  const pendingRemove = groups
    ?.flatMap((group) => group.mappings)
    .find((mapping) => mapping.id === pendingRemoveId)
  const names = {
    permissionGroups: new Map(permissionGroups.map((group) => [group.id, group.name])),
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }
  const automaticMatchRemains = automaticMatchWouldRemain(pendingRemove, autoMapByName, names)
  const targetsNotice = targetsFailure ? (
    <FailureNotice
      message='Failed to load mapping targets'
      retrying={targetsFailure.retrying}
      onRetry={targetsFailure.retry}
    />
  ) : null
  if (!groups || groups.length === 0) {
    return (
      <>
        {targetsNotice}
        <EmptyState
          title='No groups yet.'
          description='Push a group from your identity provider and it appears here.'
        />
      </>
    )
  }

  return (
    <>
      {targetsNotice}
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
                        disabled: list.removing,
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
      <ConfirmDialog
        target={active && pendingRemove !== undefined}
        onClose={() => setPendingRemoveId(null)}
        title='Remove mapping'
        description={`Remove the mapping to ${pendingRemove ? describeScimMapping(pendingRemove, names) : ''}? ${removeMappingConsequence(pendingRemove, automaticMatchRemains)}`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={async () => {
          if (!pendingRemove) return
          await list.removeMapping(pendingRemove.id)
        }}
      />
    </>
  )
}
