'use client'

import { useState } from 'react'
import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import {
  FieldStack,
  LoadingState,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import { AddMembersModal } from '@/platform/app/(shell)/settings/_components/sections/access-control/add-members-modal'
import {
  ActionMenu,
  Avatar,
  Button,
  ConfirmDialog,
  FailureNotice,
  MultiSelect,
  Switch,
  TextField,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  type PermissionGroup,
  type PermissionGroupWorkspaceRef,
  useBulkAddPermissionGroupMembers,
  usePermissionGroupMembers,
  useRemovePermissionGroupMember,
} from '@/platform/lib/data/access-control'
import { plural } from '@/platform/lib/plural'
import { formatTimestamp } from '@/platform/lib/time'

interface GroupMembersProps {
  group: PermissionGroup
  organizationId: string
}

/** Who a group restricts. Each change here is its own confirmed action, outside the page's Save. */
function GroupMembers({ group, organizationId }: GroupMembersProps) {
  const members = usePermissionGroupMembers(organizationId, group.id)
  const removeMember = useRemovePermissionGroupMember()
  const bulkAddMembers = useBulkAddPermissionGroupMembers()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const memberList = members.data ?? []
  return (
    <SettingsSection title='Members'>
      <SettingsRow
        label={
          members.isPending || members.error
            ? 'Members'
            : memberList.length === 0
              ? group.membershipMode === 'inherit'
                ? 'Applies to all members of its workspaces. Add members to restrict it to specific people.'
                : 'No members assigned.'
              : `Restricted to ${plural(memberList.length, 'member')}`
        }
      >
        <Button
          variant='primary'
          size='compact'
          icon='I074'
          disabled={members.data === undefined}
          onClick={() => setAdding(true)}
        >
          Add
        </Button>
      </SettingsRow>
      {members.isPending ? (
        <LoadingState label='Loading members…' />
      ) : members.data === undefined ? (
        <FailureNotice
          message={getErrorMessage(members.error, 'Failed to load members')}
          retrying={members.isFetching}
          onRetry={() => void members.refetch()}
        />
      ) : (
        memberList.map((member) => {
          const name = member.userName || member.userEmail || 'Unknown'
          return (
            <SettingsRow
              key={member.id}
              label={name}
              description={`${member.userEmail || name} · Added ${formatTimestamp(new Date(member.assignedAt).getTime())}`}
              leading={<Avatar name={name} src={member.userImage ?? undefined} />}
            >
              <ActionMenu
                label={`${name} actions`}
                icon='I108'
                actions={[
                  {
                    id: 'remove',
                    label: 'Remove',
                    destructive: true,
                    onSelect: () => setRemoving({ id: member.id, name }),
                  },
                ]}
              />
            </SettingsRow>
          )
        })
      )}
      {adding && (
        <AddMembersModal
          organizationId={organizationId}
          existingUserIds={memberList.map((member) => member.userId)}
          onClose={() => setAdding(false)}
          onAdd={async (userIds) => {
            await bulkAddMembers.mutateAsync({
              organizationId,
              permissionGroupId: group.id,
              userIds,
            })
          }}
          isAdding={bulkAddMembers.isPending}
        />
      )}
      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(null)}
        title='Remove member'
        description={(target) => `Remove ${target.name} from ${group.name}?`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={async (target) => {
          try {
            await removeMember.mutateAsync({
              organizationId,
              permissionGroupId: group.id,
              memberId: target.id,
            })
          } catch (error) {
            toast.error("Couldn't remove member", {
              description: getErrorMessage(error, 'Try again in a moment.'),
            })
          }
        }}
      />
    </SettingsSection>
  )
}

interface GroupGeneralTabProps {
  group: PermissionGroup
  organizationId: string
  name: string
  description: string
  isDefault: boolean
  workspaceIds: string[]
  workspaceOptions: { value: string; label: string }[]
  organizationWorkspaces: PermissionGroupWorkspaceRef[]
  workspacesLoading: boolean
  onChange: (patch: {
    name?: string
    description?: string
    isDefault?: boolean
    workspaceIds?: string[]
  }) => void
}

export function GroupGeneralTab({
  group,
  organizationId,
  name,
  description,
  isDefault,
  workspaceIds,
  workspaceOptions,
  organizationWorkspaces,
  workspacesLoading,
  onChange,
}: GroupGeneralTabProps) {
  const known = [...organizationWorkspaces, ...group.workspaces]
  const governed = workspaceIds.flatMap((id) => {
    const workspace = known.find((entry) => entry.id === id)
    return workspace ? [workspace] : []
  })
  return (
    <>
      <SettingsSection title='Details'>
        <FieldStack>
          <TextField
            label='Name'
            placeholder='e.g., Marketing Team'
            maxLength={100}
            value={name}
            onChange={(value) => onChange({ name: value })}
            error={!name.trim() ? 'Name is required.' : undefined}
          />
          <TextField
            label='Description'
            placeholder='e.g., Limited access for marketing users'
            maxLength={500}
            value={description}
            onChange={(value) => onChange({ description: value })}
          />
        </FieldStack>
      </SettingsSection>
      <SettingsSection title='Default group'>
        <SettingsRow
          label='Organization default'
          description='Applies to everyone in the organization not assigned to another group, including external workspace members'
        >
          <Switch
            label='Organization default'
            checked={isDefault}
            onCheckedChange={(checked) => onChange({ isDefault: checked })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Workspaces'>
        {isDefault ? (
          <SettingsRow label='Governs every workspace in the organization' />
        ) : (
          <>
            <FieldStack>
              <MultiSelect
                label={
                  governed.length > 0
                    ? `Governs ${plural(governed.length, 'workspace')}`
                    : 'Select the workspaces this group governs'
                }
                searchLabel='Search workspaces…'
                placeholder={workspacesLoading ? 'Loading workspaces…' : 'Select workspaces…'}
                options={workspaceOptions}
                value={workspaceIds}
                disabled={workspacesLoading}
                onValueChange={(ids) => onChange({ workspaceIds: ids })}
              />
            </FieldStack>
            {governed.map((workspace) => (
              <SettingsRow key={workspace.id} label={workspace.name} />
            ))}
          </>
        )}
      </SettingsSection>
      {!isDefault && <GroupMembers group={group} organizationId={organizationId} />}
    </>
  )
}
