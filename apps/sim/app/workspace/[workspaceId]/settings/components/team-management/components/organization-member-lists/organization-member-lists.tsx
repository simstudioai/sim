'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  ChipDropdown,
  ChipInput,
  chipVariants,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MoreHorizontal,
  Search,
} from '@/components/emcn'
import type { OrgRole, PermissionType } from '@/components/permissions'
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
  ManageCreditsModal,
  type ManageCreditsTarget,
} from '@/app/workspace/[workspaceId]/settings/components/team-management/components/manage-credits-modal'
import { useUpdateWorkspacePermissions } from '@/hooks/queries/invitations'
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

function formatJoinedDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US')
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text)
}

interface OrganizationMemberListsProps {
  organizationId: string
  roster: OrganizationRoster | null | undefined
  isLoadingRoster: boolean
  currentUserId: string
  currentUserEmail: string
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
  organizationId,
  roster,
  isLoadingRoster,
  currentUserId,
  currentUserEmail,
  onRemoveMember,
  onTransferOwnership,
}: OrganizationMemberListsProps) {
  const [query, setQuery] = useState('')
  const [creditsTarget, setCreditsTarget] = useState<ManageCreditsTarget | null>(null)

  const updateMemberRole = useUpdateOrganizationMemberRole()
  const updateInvitation = useUpdateInvitation()
  const updatePermissions = useUpdateWorkspacePermissions()
  const cancelInvitation = useCancelInvitation()
  const resendInvitation = useResendInvitation()

  const members = useMemo(() => roster?.members ?? [], [roster])
  const pendingInvitations = useMemo(() => roster?.pendingInvitations ?? [], [roster])
  const workspaces = useMemo(() => roster?.workspaces ?? [], [roster])

  const q = query.trim().toLowerCase()
  const matches = (name: string, email: string) =>
    !q || name.toLowerCase().includes(q) || email.toLowerCase().includes(q)

  const isActiveSearch = q.length > 0

  const buildActionsMenu = (children: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type='button' aria-label='Member actions' className={chipVariants({ flush: true })}>
          <MoreHorizontal className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>{children}</DropdownMenuContent>
    </DropdownMenu>
  )

  const renderOrgMemberRow = (member: RosterMember) => {
    const isSelf = member.userId === currentUserId
    const isOwner = member.role === 'owner'
    const isExternal = member.role === 'external'
    const editable = !isSelf && !isOwner && !isExternal
    const canRemove = !isSelf && !isOwner

    return (
      <MemberRow
        key={`org-member-${member.memberId}`}
        name={member.name}
        email={member.email}
        image={member.image}
        status={`Joined ${formatJoinedDate(member.createdAt)}`}
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
        menu={buildActionsMenu(
          <>
            <DropdownMenuItem onSelect={() => copyToClipboard(member.email)}>
              Copy email
            </DropdownMenuItem>
            {!isOwner && (
              <DropdownMenuItem
                onSelect={() =>
                  setCreditsTarget({
                    userId: member.userId,
                    name: member.name,
                    email: member.email,
                  })
                }
              >
                Manage Credits
              </DropdownMenuItem>
            )}
            {canRemove && (
              <DropdownMenuItem
                className='text-[var(--text-error)]'
                onSelect={() =>
                  onRemoveMember({
                    id: member.memberId,
                    role: member.role,
                    user: {
                      id: member.userId,
                      name: member.name,
                      email: member.email,
                      image: member.image,
                    },
                  })
                }
              >
                Remove
              </DropdownMenuItem>
            )}
            {isSelf && isOwner && onTransferOwnership && (
              <DropdownMenuItem onSelect={() => onTransferOwnership()}>
                Transfer ownership
              </DropdownMenuItem>
            )}
            {isSelf && !isOwner && (
              <DropdownMenuItem
                className='text-[var(--text-error)]'
                onSelect={() =>
                  onRemoveMember({
                    id: member.memberId,
                    role: member.role,
                    user: {
                      id: member.userId,
                      name: member.name,
                      email: member.email,
                      image: member.image,
                    },
                  })
                }
              >
                Leave organization
              </DropdownMenuItem>
            )}
          </>
        )}
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
      menu={buildActionsMenu(
        <>
          <DropdownMenuItem onSelect={() => copyToClipboard(invitation.email)}>
            Copy email
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              resendInvitation
                .mutateAsync({ invitationId: invitation.id, orgId: organizationId })
                .catch((error) => logger.error('Failed to resend invitation', { error }))
            }
          >
            Resend invite
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-[var(--text-error)]'
            onSelect={() =>
              cancelInvitation
                .mutateAsync({ invitationId: invitation.id, orgId: organizationId })
                .catch((error) => logger.error('Failed to revoke invitation', { error }))
            }
          >
            Revoke invite
          </DropdownMenuItem>
        </>
      )}
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
        disabled={updateInvitation.isPending}
      />
    )
    return renderInviteRow(invitation, 'org-invite', roleControl)
  }

  const renderWorkspaceMemberRow = (
    member: RosterMember,
    workspaceId: string,
    access: RosterWorkspaceAccess
  ) => {
    const rowUserIsOrgAdmin = member.role === 'owner' || member.role === 'admin'
    const wouldDemoteSelf = member.userId === currentUserId && access.permission === 'admin'
    const disabled = rowUserIsOrgAdmin || wouldDemoteSelf || updatePermissions.isPending

    return (
      <MemberRow
        key={`ws-${workspaceId}-member-${member.memberId}`}
        name={member.name}
        email={member.email}
        image={member.image}
        status={`Joined ${formatJoinedDate(member.createdAt)}`}
        roleControl={
          <ChipDropdown
            value={access.permission}
            onChange={(permission) =>
              updatePermissions
                .mutateAsync({
                  workspaceId,
                  organizationId,
                  updates: [{ userId: member.userId, permissions: permission as PermissionType }],
                })
                .catch((error) => logger.error('Failed to update workspace permission', { error }))
            }
            options={WORKSPACE_ROLE_OPTIONS}
            matchTriggerWidth={false}
            disabled={disabled}
          />
        }
        menu={buildActionsMenu(
          <DropdownMenuItem onSelect={() => copyToClipboard(member.email)}>
            Copy email
          </DropdownMenuItem>
        )}
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
        disabled={updateInvitation.isPending}
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

  return (
    <>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder='Search members...'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className='flex-1'
        />
      </div>

      {showMembersSection && (
        <MemberSection
          label={`Members (${orgRowCount})`}
          isEmpty={!isLoadingRoster && filteredOrgMembers.length + filteredOrgPending.length === 0}
          emptyText={isActiveSearch ? `No members matching “${query}”` : 'No members yet'}
        >
          {filteredOrgMembers.map(renderOrgMemberRow)}
          {filteredOrgPending.map(renderOrgInviteRow)}
        </MemberSection>
      )}

      {workspaces.map((workspace) => {
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
              isActiveSearch ? `No members matching “${query}”` : 'No members in this workspace'
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

      <ManageCreditsModal
        key={creditsTarget?.userId ?? 'none'}
        open={creditsTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCreditsTarget(null)
        }}
        organizationId={organizationId}
        member={creditsTarget}
      />
    </>
  )
}
