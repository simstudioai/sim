'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { EmptyState } from '@sim/emcn/empty-state'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { Tooltip } from '@sim/emcn/tooltip'
import { InviteModal } from '@/app/(product)/_components/invite-modal/invite-modal'
import { ManageCreditsModal } from '@/app/(product)/o/[organizationId]/settings/_components/section-parts/manage-credits-modal'
import {
  InvitationRow,
  MemberRow,
  WorkspaceInvitationRow,
  WorkspaceMemberRow,
} from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/member-rows'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/members/members.module.css'
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
  const startRemoval = (row: MemberRowModel) =>
    setRemoval({
      userId: row.userId,
      name: row.name || row.email,
      isSelf: row.isSelf,
      isExternal: row.role === 'external',
    })

  return (
    <div className={styles.panel}>
      <SearchField
        label='Search members'
        placeholder='Search members…'
        value={search}
        onValueChange={setSearch}
      />

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
        <EmptyState title={`No members matching “${search.trim()}”`} />
      ) : (
        <>
          {(!searching || visible.members.length + visible.invitations.length > 0) && (
            <SettingsSection title={`Members ${visible.total}`}>
              {visible.members.length + visible.invitations.length === 0 && (
                <p className={styles.status} data-type='T060'>
                  No members yet
                </p>
              )}
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
            </SettingsSection>
          )}
          {visible.workspaces.map((workspace) => (
            <SettingsSection key={workspace.id} title={`${workspace.name} ${workspace.total}`}>
              {workspace.members.length + workspace.invitations.length === 0 && (
                <p className={styles.status} data-type='T060'>
                  No members in this workspace
                </p>
              )}
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
            </SettingsSection>
          ))}
        </>
      )}

      {(members.canManage || members.canLeave) && (
        <SettingsSection title='Membership'>
          {members.canManage && (
            <SettingsRow label='Invite people'>
              <Tooltip label='Invitations are disabled' enabled={!members.canInvite}>
                <span>
                  <Button
                    size='compact'
                    disabled={!members.canInvite}
                    onClick={() => setInviting(true)}
                  >
                    Invite
                  </Button>
                </span>
              </Tooltip>
            </SettingsRow>
          )}
          {members.canLeave && members.viewerId && (
            <SettingsRow label='Organization membership'>
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
        title='Remove from workspace'
        description={({ name, workspaceName }) => `${name} will lose access to ${workspaceName}.`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={({ userId, workspaceId }) => actions.removeFromWorkspace(userId, workspaceId)}
      />
      <ConfirmDialog
        target={revoking}
        onClose={() => setRevoking(null)}
        title='Revoke invite'
        description={({ email }) => `The invite sent to ${email} will stop working.`}
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
    </div>
  )
}
