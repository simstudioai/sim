'use client'

import { useState } from 'react'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import {
  Button,
  EmptyState,
  FailureNotice,
  LoadingRows,
  SectionSearch,
  Tooltip,
} from '@/platform/design-system/components'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import { InviteModal } from '@/platform/embedded/app/(shell)/_components/invite-modal/invite-modal'
import { ManageCreditsModal } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/manage-credits-modal'
import { SectionToolbar } from '@/platform/embedded/app/(shell)/settings/_components/section-parts/section-parts'
import {
  InvitationRow,
  MemberRow,
  WorkspaceInvitationRow,
  WorkspaceMemberRow,
} from '@/platform/embedded/app/(shell)/settings/_components/sections/members/member-rows'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/members/members.module.css'
import {
  type RemovalTarget,
  RemoveMemberModal,
} from '@/platform/embedded/app/(shell)/settings/_components/sections/members/remove-member-modal'
import { SeatsOverview } from '@/platform/embedded/app/(shell)/settings/_components/sections/members/seats-overview'
import { TransferOwnershipModal } from '@/platform/embedded/app/(shell)/settings/_components/sections/members/transfer-ownership-modal'
import { useMembers } from '@/platform/embedded/lib/data/members'
import { filterRoster, type MemberRowModel } from '@/platform/embedded/lib/data/members-model'

interface MembersPanelProps {
  organization: OrganizationSurfaceContext
}

const LOAD_FAILED = 'Failed to load organization members'

export function MembersPanel({ organization }: MembersPanelProps) {
  const members = useMembers(organization)
  const [search, setSearch] = useSettingsSearch()
  const [inviting, setInviting] = useState(false)
  const [removal, setRemoval] = useState<RemovalTarget | null>(null)
  const [transferring, setTransferring] = useState(false)
  const [credits, setCredits] = useState<MemberRowModel | null>(null)
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
      <SectionToolbar
        grow={<SectionSearch subject='members' value={search} onValueChange={setSearch} />}
      >
        {members.canManage && (
          <Tooltip label='Invitations are disabled' enabled={!members.canInvite}>
            <span>
              <Button
                variant='primary'
                size='compact'
                icon='I074'
                disabled={!members.canInvite}
                onClick={() => setInviting(true)}
              >
                Invite
              </Button>
            </span>
          </Tooltip>
        )}
      </SectionToolbar>

      {members.canLeave && members.viewerId && (
        <SettingsSection title='Membership'>
          <SettingsRow label='Organization membership'>
            <Button
              size='compact'
              variant='destructive'
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
        </SettingsSection>
      )}

      {members.seats.visible && <SeatsOverview seats={members.seats} />}

      {roster.status === 'pending' ? (
        <SettingsSection title='Members'>
          <LoadingRows label='Loading members…' />
        </SettingsSection>
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
                <EmptyState title='No members yet' />
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
                />
              ))}
            </SettingsSection>
          )}
          {visible.workspaces.map((workspace) => (
            <SettingsSection key={workspace.id} title={`${workspace.name} ${workspace.total}`}>
              {workspace.members.length + workspace.invitations.length === 0 && (
                <EmptyState title='No members in this workspace' />
              )}
              {workspace.members.map((row) => (
                <WorkspaceMemberRow
                  key={row.key}
                  row={row}
                  workspaceId={workspace.id}
                  workspaceName={workspace.name}
                  actions={actions}
                />
              ))}
              {workspace.invitations.map((row) => (
                <WorkspaceInvitationRow
                  key={row.key}
                  row={row}
                  workspaceId={workspace.id}
                  workspaceName={workspace.name}
                  canManage={members.canManage}
                  actions={actions}
                />
              ))}
            </SettingsSection>
          ))}
        </>
      )}

      {members.canManage && inviting && <InviteModal onClose={() => setInviting(false)} />}
      <RemoveMemberModal target={removal} onClose={() => setRemoval(null)} />
      {transferring && (
        <TransferOwnershipModal
          open
          onClose={() => setTransferring(false)}
          roster={roster.model}
          hasPaidSubscription={members.seats.hasPaidSubscription}
        />
      )}
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
