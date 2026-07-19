'use client'

import { useMemo, useState } from 'react'
import { ChipDropdown, ChipInput, Search, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/predicates'
import { getErrorMessage } from '@sim/utils/errors'
import { formatDate } from '@sim/utils/formatting'
import { useTranslations } from 'next-intl'
import {
  type OrgRole,
  type PermissionType,
  RoleLockTooltip,
  workspaceRoleLockReason,
} from '@/components/permissions'
import type {
  OrganizationRoster,
  RosterMember,
  RosterPendingInvitation,
  RosterWorkspaceAccess,
} from '@/lib/api/contracts/organization'
import type { Member } from '@/lib/workspaces/organization'
import {
  MemberRow,
  MemberSection,
} from '@/app/workspace/[workspaceId]/settings/components/member-list'
import {
  type RowAction,
  RowActionsMenu,
} from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  ManageCreditsModal,
  type ManageCreditsTarget,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components/manage-credits-modal'
import {
  useRemoveWorkspaceMember,
  useUpdateWorkspacePermissions,
} from '@/hooks/queries/invitations'
import {
  useCancelInvitation,
  useResendInvitation,
  useUpdateInvitation,
  useUpdateOrganizationMemberRole,
} from '@/hooks/queries/organization'

const logger = createLogger('OrganizationMemberLists')

const ORG_ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
] as const

const WORKSPACE_ROLE_OPTIONS = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'admin', label: 'Admin' },
] as const

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

interface OrganizationMemberListsProps {
  canManage: boolean
  organizationId: string
  roster: OrganizationRoster | null | undefined
  isLoadingRoster: boolean
  currentUserId: string
  onRemoveMember: (member: Member) => void
  onTransferOwnership?: () => void
}

/**
 * Renders the organization roster as Teammates-style sections: an org-level
 * "Members" section followed by one section per workspace, each listing that
 * workspace's members and pending grants. A single search box filters every
 * section; sections with no matches collapse while a search is active.
 */
export function OrganizationMemberLists({
  canManage,
  organizationId,
  roster,
  isLoadingRoster,
  currentUserId,
  onRemoveMember,
  onTransferOwnership,
}: OrganizationMemberListsProps) {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
  const [query, setQuery] = useState('')
  const [creditsTarget, setCreditsTarget] = useState<ManageCreditsTarget | null>(null)

  const updateMemberRole = useUpdateOrganizationMemberRole()
  const updateInvitation = useUpdateInvitation()
  const updatePermissions = useUpdateWorkspacePermissions()
  const removeWorkspaceMember = useRemoveWorkspaceMember()
  const cancelInvitation = useCancelInvitation()
  const resendInvitation = useResendInvitation()

  const members = useMemo(() => roster?.members ?? [], [roster])
  const pendingInvitations = useMemo(() => roster?.pendingInvitations ?? [], [roster])
  const workspaces = useMemo(() => roster?.workspaces ?? [], [roster])

  const q = query.trim().toLowerCase()
  const matches = (name: string, email: string) =>
    !q || name.toLowerCase().includes(q) || email.toLowerCase().includes(q)

  const isActiveSearch = q.length > 0

  const buildActionsMenu = (actions: RowAction[]) => (
    <RowActionsMenu label={t('member_actions')} actions={actions} />
  )

  const renderOrgMemberRow = (member: RosterMember) => {
    const isSelf = member.userId === currentUserId
    const isOwner = member.role === 'owner'
    const isExternal = member.role === 'external'
    const editable = canManage && !isSelf && !isOwner && !isExternal
    const canRemove = canManage && !isSelf && !isOwner

    return (
      <MemberRow
        key={`org-member-${member.memberId}`}
        name={member.name}
        email={member.email}
        image={member.image}
        status={`Joined ${formatDate(new Date(member.createdAt))}`}
        roleControl={
          editable ? (
            <ChipDropdown
              value={member.role}
              onChange={(role) =>
                updateMemberRole
                  .mutateAsync({
                    orgId: organizationId,
                    userId: member.userId,
                    role: role as OrgRole,
                  })
                  .catch((error) => logger.error('Failed to update member role', { error }))
              }
              options={ORG_ROLE_OPTIONS}
              matchTriggerWidth={false}
              disabled={updateMemberRole.isPending}
            />
          ) : (
            <ChipDropdown
              value={member.role}
              options={[{ value: member.role, label: capitalize(member.role) }]}
              matchTriggerWidth={false}
              disabled
            />
          )
        }
        menu={buildActionsMenu([
          { label: 'Copy email', onSelect: () => copyToClipboard(member.email) },
          ...(canManage && !isOwner
            ? [
                {
                  label: 'Manage Credits',
                  onSelect: () =>
                    setCreditsTarget({
                      userId: member.userId,
                      name: member.name,
                      email: member.email,
                    }),
                },
              ]
            : []),
          ...(canRemove
            ? [
                {
                  label: 'Remove',
                  destructive: true,
                  onSelect: () =>
                    onRemoveMember({
                      id: member.memberId,
                      role: member.role,
                      user: {
                        id: member.userId,
                        name: member.name,
                        email: member.email,
                        image: member.image,
                      },
                    }),
                },
              ]
            : []),
          ...(isSelf && isOwner && onTransferOwnership
            ? [{ label: 'Transfer ownership', onSelect: () => onTransferOwnership() }]
            : []),
          ...(canManage && isSelf && !isOwner
            ? [
                {
                  label: 'Leave organization',
                  destructive: true,
                  onSelect: () =>
                    onRemoveMember({
                      id: member.memberId,
                      role: member.role,
                      user: {
                        id: member.userId,
                        name: member.name,
                        email: member.email,
                        image: member.image,
                      },
                    }),
                },
              ]
            : []),
        ])}
      />
    )
  }

  const renderInviteRow = (
    invitation: RosterPendingInvitation,
    keyPrefix: string,
    roleControl: React.ReactNode
  ) => (
    <MemberRow
      key={`${keyPrefix}-${invitation.id}`}
      name={invitation.inviteeName ?? invitation.email}
      email={invitation.email}
      image={invitation.inviteeImage}
      status='Invite pending'
      roleControl={roleControl}
      menu={buildActionsMenu([
        { label: 'Copy email', onSelect: () => copyToClipboard(invitation.email) },
        ...(canManage
          ? [
              {
                label: 'Resend invite',
                onSelect: () =>
                  resendInvitation
                    .mutateAsync({ invitationId: invitation.id, orgId: organizationId })
                    .catch((error) => logger.error('Failed to resend invitation', { error })),
              },
              {
                label: 'Revoke invite',
                destructive: true,
                onSelect: () =>
                  cancelInvitation
                    .mutateAsync({ invitationId: invitation.id, orgId: organizationId })
                    .catch((error) => logger.error('Failed to revoke invitation', { error })),
              },
            ]
          : []),
      ])}
    />
  )

  const renderOrgInviteRow = (invitation: RosterPendingInvitation) => {
    const isExternal = invitation.membershipIntent === 'external'
    const roleControl = isExternal ? (
      <ChipDropdown
        value='external'
        options={[{ value: 'external', label: 'External' }]}
        matchTriggerWidth={false}
        disabled
      />
    ) : (
      <ChipDropdown
        value={invitation.role === 'admin' ? 'admin' : 'member'}
        onChange={(role) =>
          updateInvitation
            .mutateAsync({
              orgId: organizationId,
              invitationId: invitation.id,
              role: role as OrgRole,
            })
            .catch((error) => logger.error('Failed to update invitation role', { error }))
        }
        options={ORG_ROLE_OPTIONS}
        matchTriggerWidth={false}
        disabled={!canManage || updateInvitation.isPending}
      />
    )
    return renderInviteRow(invitation, 'org-invite', roleControl)
  }

  const renderWorkspaceMemberRow = (
    member: RosterMember,
    workspaceId: string,
    access: RosterWorkspaceAccess
  ) => {
    const rowUserIsOrgAdmin = isOrgAdminRole(member.role)
    const isSelf = member.userId === currentUserId
    const wouldDemoteSelf = isSelf && access.permission === 'admin'
    const disabled =
      !canManage || rowUserIsOrgAdmin || wouldDemoteSelf || updatePermissions.isPending
    const lockReason = rowUserIsOrgAdmin ? workspaceRoleLockReason('org-admin') : null
    const canRemoveFromWorkspace = canManage && !rowUserIsOrgAdmin && !isSelf

    return (
      <MemberRow
        key={`ws-${workspaceId}-member-${member.memberId}`}
        name={member.name}
        email={member.email}
        image={member.image}
        status={`Joined ${formatDate(new Date(member.createdAt))}`}
        roleControl={
          <RoleLockTooltip reason={lockReason}>
            <ChipDropdown
              value={access.permission}
              onChange={(permission) =>
                updatePermissions
                  .mutateAsync({
                    workspaceId,
                    organizationId,
                    updates: [{ userId: member.userId, permissions: permission as PermissionType }],
                  })
                  .catch((error) =>
                    logger.error('Failed to update workspace permission', { error })
                  )
              }
              options={WORKSPACE_ROLE_OPTIONS}
              matchTriggerWidth={false}
              disabled={disabled}
            />
          </RoleLockTooltip>
        }
        menu={buildActionsMenu([
          { label: 'Copy email', onSelect: () => copyToClipboard(member.email) },
          ...(canRemoveFromWorkspace
            ? [
                {
                  label: 'Remove from workspace',
                  destructive: true,
                  onSelect: () =>
                    removeWorkspaceMember
                      .mutateAsync({ userId: member.userId, workspaceId, organizationId })
                      .catch((error) => {
                        logger.error('Failed to remove workspace member', { error })
                        toast.error("Couldn't remove member", {
                          description: getErrorMessage(error, 'Please try again in a moment.'),
                        })
                      }),
                },
              ]
            : []),
        ])}
      />
    )
  }

  const renderWorkspaceInviteRow = (
    invitation: RosterPendingInvitation,
    workspaceId: string,
    access: RosterWorkspaceAccess
  ) => {
    const roleControl = (
      <ChipDropdown
        value={access.permission}
        onChange={(permission) =>
          updateInvitation
            .mutateAsync({
              orgId: organizationId,
              invitationId: invitation.id,
              grants: [{ workspaceId, permission: permission as PermissionType }],
            })
            .catch((error) => logger.error('Failed to update invitation grant', { error }))
        }
        options={WORKSPACE_ROLE_OPTIONS}
        matchTriggerWidth={false}
        disabled={!canManage || updateInvitation.isPending}
      />
    )
    return renderInviteRow(invitation, `ws-${workspaceId}-invite`, roleControl)
  }

  const filteredOrgMembers = members.filter((m) => matches(m.name, m.email))
  const orgPending = pendingInvitations.filter((inv) => inv.kind === 'organization')
  const filteredOrgPending = orgPending.filter((inv) =>
    matches(inv.inviteeName ?? inv.email, inv.email)
  )
  const orgRowCount = members.length + orgPending.length
  const hasOrgMatches = filteredOrgMembers.length + filteredOrgPending.length > 0
  const showMembersSection = !isActiveSearch || hasOrgMatches

  /**
   * Group each workspace's members and pending invites once per roster change.
   * This is O(workspaces × members) and independent of the search query, so
   * hoisting it out of render keeps keystroke filtering cheap on large orgs.
   */
  const workspaceGroups = useMemo(
    () =>
      workspaces.map((workspace) => {
        const workspaceMembers = members
          .map((member) => ({
            member,
            access: member.workspaces.find((w) => w.workspaceId === workspace.id),
          }))
          .filter((entry): entry is { member: RosterMember; access: RosterWorkspaceAccess } =>
            Boolean(entry.access)
          )
        const workspaceInvites = pendingInvitations
          .map((invitation) => ({
            invitation,
            access: invitation.workspaces.find((w) => w.workspaceId === workspace.id),
          }))
          .filter(
            (
              entry
            ): entry is { invitation: RosterPendingInvitation; access: RosterWorkspaceAccess } =>
              Boolean(entry.access)
          )
        return { workspace, workspaceMembers, workspaceInvites }
      }),
    [workspaces, members, pendingInvitations]
  )

  return (
    <>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder={t('search_members')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='flex-1'
        />
      </div>

      {showMembersSection && (
        <MemberSection
          label={`Members (${orgRowCount})`}
          isEmpty={!isLoadingRoster && filteredOrgMembers.length + filteredOrgPending.length === 0}
          emptyText={isActiveSearch ? `No members matching “${query}”` : tI18n('no_members_yet')}
        >
          {filteredOrgMembers.map(renderOrgMemberRow)}
          {filteredOrgPending.map(renderOrgInviteRow)}
        </MemberSection>
      )}

      {workspaceGroups.map(({ workspace, workspaceMembers, workspaceInvites }) => {
        const visibleMembers = workspaceMembers.filter(({ member }) =>
          matches(member.name, member.email)
        )
        const visibleInvites = workspaceInvites.filter(({ invitation }) =>
          matches(invitation.inviteeName ?? invitation.email, invitation.email)
        )
        const totalCount = workspaceMembers.length + workspaceInvites.length
        const hasMatches = visibleMembers.length + visibleInvites.length > 0

        if (isActiveSearch && !hasMatches) return null

        return (
          <MemberSection
            key={`workspace-${workspace.id}`}
            label={`${workspace.name} (${totalCount})`}
            isEmpty={visibleMembers.length + visibleInvites.length === 0}
            emptyText={
              isActiveSearch
                ? `No members matching “${query}”`
                : tI18n('no_members_in_this_workspace')
            }
          >
            {visibleMembers.map(({ member, access }) =>
              renderWorkspaceMemberRow(member, workspace.id, access)
            )}
            {visibleInvites.map(({ invitation, access }) =>
              renderWorkspaceInviteRow(invitation, workspace.id, access)
            )}
          </MemberSection>
        )
      })}

      {canManage && (
        <ManageCreditsModal
          key={creditsTarget?.userId ?? 'none'}
          open={creditsTarget !== null}
          onOpenChange={(open) => {
            if (!open) setCreditsTarget(null)
          }}
          organizationId={organizationId}
          member={creditsTarget}
        />
      )}
    </>
  )
}
