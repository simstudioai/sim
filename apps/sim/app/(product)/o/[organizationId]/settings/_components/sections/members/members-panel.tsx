'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { InviteModal } from '@/app/(product)/_components/invite-modal/invite-modal'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { ManageCreditsModal } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/manage-credits-modal'
import {
  InvitationRow,
  MemberRow,
  WorkspaceInvitationRow,
  WorkspaceMemberRow,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/member-rows'
import {
  type RemovalTarget,
  RemoveMemberModal,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/remove-member-modal'
import { SeatsOverview } from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/seats-overview'
import { TransferOwnershipModal } from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/transfer-ownership-modal'
import { useMemberSearch, useMembers } from '@/platform/lib/data/members'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import {
  filterRoster,
  type InvitationRowModel,
  type MemberRowModel,
} from '@/platform/shared/members'

interface MembersPanelProps {
  organization: PlatformOrganization
}

const LOAD_FAILED = 'Failed to load organization members'

interface WorkspaceRemoval {
  userId: string
  name: string
  workspaceId: string
  workspaceName: string
}

export function MembersPanel({ organization }: MembersPanelProps) {
  const members = useMembers(organization)
  const { search, setSearch } = useMemberSearch()
  const [inviting, setInviting] = useState(false)
  const [removal, setRemoval] = useState<RemovalTarget | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [credits, setCredits] = useState<MemberRowModel | null>(null)
  const [workspaceRemoval, setWorkspaceRemoval] = useState<WorkspaceRemoval | null>(null)
  const [revoking, setRevoking] = useState<InvitationRowModel | null>(null)
  const { roster, actions } = members
  const searching = search.trim().length > 0
  const visible = roster.model && filterRoster(roster.model, search)
  const noMatches =
    searching &&
    visible &&
    visible.members.length + visible.invitations.length + visible.workspaces.length === 0
  const hasRows = Boolean(
    roster.model &&
      roster.model.members.length +
        roster.model.invitations.length +
        roster.model.workspaces.length >
        0
  )
  const startRemoval = (row: MemberRowModel) =>
    setRemoval({
      userId: row.userId,
      name: row.name || row.email,
      isSelf: row.isSelf,
      isExternal: row.role === 'external',
    })

  return (
    <SectionStack>
      {hasRows && (
        <SearchField
          label='Search members'
          placeholder='Search members…'
          value={search}
          onValueChange={setSearch}
        />
      )}

      {members.seats.visible && <SeatsOverview seats={members.seats} />}

      {roster.status === 'pending' ? (
        <SettingsSection title='Members' />
      ) : !visible ? (
        <FailureNotice
          title={LOAD_FAILED}
          message={roster.error?.message ?? 'The roster is unavailable.'}
          retrying={roster.retrying}
          onRetry={roster.retry}
        />
      ) : noMatches ? (
        <EmptyState title='No matching members' />
      ) : (
        <>
          {(!searching || visible.members.length + visible.invitations.length > 0) && (
            <SettingsList
              title='Members'
              empty={
                visible.members.length + visible.invitations.length === 0
                  ? { title: 'No members yet' }
                  : undefined
              }
            >
              {visible.members.map((row) => (
                <MemberRow
                  key={row.key}
                  row={row}
                  actions={actions}
                  onRemove={startRemoval}
                  onManageCredits={setCredits}
                  onTransfer={() => setTransferring(true)}
                />
              ))}
              {visible.invitations.map((row) => (
                <InvitationRow
                  key={row.key}
                  row={row}
                  canManage={members.canManage}
                  actions={actions}
                  onRevoke={setRevoking}
                />
              ))}
            </SettingsList>
          )}
          {visible.workspaces.map((workspace) => (
            <SettingsList
              key={workspace.id}
              title={workspace.name}
              empty={
                workspace.members.length + workspace.invitations.length === 0
                  ? { title: 'No members in this workspace' }
                  : undefined
              }
            >
              {workspace.members.map((row) => (
                <WorkspaceMemberRow
                  key={row.key}
                  row={row}
                  workspaceId={workspace.id}
                  actions={actions}
                  onRemove={(member) =>
                    setWorkspaceRemoval({
                      userId: member.userId,
                      name: member.name || member.email,
                      workspaceId: workspace.id,
                      workspaceName: workspace.name,
                    })
                  }
                />
              ))}
              {workspace.invitations.map((row) => (
                <WorkspaceInvitationRow
                  key={row.key}
                  row={row}
                  workspaceId={workspace.id}
                  canManage={members.canManage}
                  actions={actions}
                  onRevoke={setRevoking}
                />
              ))}
            </SettingsList>
          ))}
        </>
      )}

      {(members.canManage || members.canLeave) && (
        <SettingsSection title='Membership'>
          {members.canManage && (
            <SettingsRow
              label='Invite people'
              description='Add people to your organization by email'
            >
              <Button
                size='compact'
                disabled={!members.canInvite}
                disabledReason='Invitations are disabled'
                onClick={() => setInviting(true)}
              >
                Invite
              </Button>
            </SettingsRow>
          )}
          {members.canLeave && members.viewerId && (
            <SettingsRow label='Organization membership' description='Leave this organization'>
              <Button
                size='compact'
                variant='quiet'
                destructive
                onClick={() =>
                  setRemoval({
                    userId: members.viewerId ?? '',
                    name: 'yourself',
                    isSelf: true,
                    isExternal: false,
                  })
                }
              >
                Leave organization
              </Button>
            </SettingsRow>
          )}
        </SettingsSection>
      )}
      {members.canManage && <InviteModal open={inviting} onOpenChange={setInviting} />}
      <RemoveMemberModal target={removal} onClose={() => setRemoval(null)} />
      <ConfirmDialog
        target={workspaceRemoval}
        onClose={() => setWorkspaceRemoval(null)}
        title={({ name, workspaceName }) => `Remove ${name} from ${workspaceName}`}
        description='They will lose access to every workflow, table and file in it.'
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={({ userId, workspaceId }) => actions.removeFromWorkspace(userId, workspaceId)}
      />
      <ConfirmDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        title={({ email }) => `Revoke invite for ${email}`}
        description='The invite link will stop working.'
        confirmLabel='Revoke'
        pendingLabel='Revoking…'
        onConfirm={({ id }) => actions.revokeInvitation(id)}
      />
      <TransferOwnershipModal
        open={transferring}
        onClose={() => setTransferring(false)}
        roster={roster.model}
        hasPaidSubscription={members.seats.hasPaidSubscription}
      />
      {credits && (
        <ManageCreditsModal
          key={credits.userId}
          member={{ userId: credits.userId, name: credits.name || credits.email }}
          onClose={() => setCredits(null)}
        />
      )}
    </SectionStack>
  )
}
