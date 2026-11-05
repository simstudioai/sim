'use client'

import { useState } from 'react'
import { InviteModal } from '@/platform/app/(shell)/_components/invite-modal/invite-modal'
import { ManageCreditsModal } from '@/platform/app/(shell)/settings/_components/sections/members/manage-credits-modal'
import {
  InvitationRow,
  MemberRow,
  WorkspaceInvitationRow,
  WorkspaceMemberRow,
} from '@/platform/app/(shell)/settings/_components/sections/members/member-rows'
import styles from '@/platform/app/(shell)/settings/_components/sections/members/members.module.css'
import {
  type RemovalTarget,
  RemoveMemberModal,
} from '@/platform/app/(shell)/settings/_components/sections/members/remove-member-modal'
import { SeatsOverview } from '@/platform/app/(shell)/settings/_components/sections/members/seats-overview'
import { TransferOwnershipModal } from '@/platform/app/(shell)/settings/_components/sections/members/transfer-ownership-modal'
import {
  Button,
  EmptyState,
  InlineNotice,
  SearchField,
  Tooltip,
} from '@/platform/design-system/components'
import { SettingsSection } from '@/platform/design-system/components/settings-section/settings-section'
import {
  filterRoster,
  type MemberRowModel,
  useMemberSearch,
  useMembers,
} from '@/platform/lib/data/members'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'

interface MembersPanelProps {
  organization: PlatformOrganization
}

const LOAD_FAILED = 'Failed to load organization members'

export function MembersPanel({ organization }: MembersPanelProps) {
  const members = useMembers(organization)
  const { search, setSearch } = useMemberSearch()
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
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchField
            label='Search members'
            placeholder='Search members...'
            defaultValue={search}
            onValueChange={setSearch}
          />
        </div>
        {members.canLeave && members.viewerId && (
          <Button
            variant='quiet'
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
        )}
        {members.canManage && (
          <Tooltip label='Invitations are disabled' enabled={!members.canInvite}>
            <span>
              <Button
                variant='primary'
                disabled={!members.canInvite}
                onClick={() => setInviting(true)}
              >
                Invite
              </Button>
            </span>
          </Tooltip>
        )}
      </div>

      {members.seats.visible && <SeatsOverview seats={members.seats} />}

      {roster.status === 'pending' ? (
        <SettingsSection title='Members'>
          <p className={styles.status} role='status' data-type='T060'>
            Loading members…
          </p>
        </SettingsSection>
      ) : !visible ? (
        <InlineNotice
          intent='danger'
          title={LOAD_FAILED}
          message={roster.error?.message ?? 'The roster is unavailable.'}
          action={
            <Button size='compact' disabled={roster.retrying} onClick={roster.retry}>
              Retry
            </Button>
          }
        />
      ) : noMatches ? (
        <EmptyState title={`No members matching “${search.trim()}”`} />
      ) : (
        <>
          {(!searching || visible.members.length + visible.invitations.length > 0) && (
            <SettingsSection title={`Members (${visible.total})`}>
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
                />
              ))}
            </SettingsSection>
          )}
          {visible.workspaces.map((workspace) => (
            <SettingsSection key={workspace.id} title={`${workspace.name} (${workspace.total})`}>
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
                />
              ))}
              {workspace.invitations.map((row) => (
                <WorkspaceInvitationRow
                  key={row.key}
                  row={row}
                  workspaceId={workspace.id}
                  canManage={members.canManage}
                  actions={actions}
                />
              ))}
            </SettingsSection>
          ))}
        </>
      )}

      {members.canManage && <InviteModal open={inviting} onOpenChange={setInviting} />}
      <RemoveMemberModal target={removal} onClose={() => setRemoval(null)} />
      <TransferOwnershipModal
        open={transferring}
        onClose={() => setTransferring(false)}
        roster={roster.model}
        hasPaidSubscription={members.seats.hasPaidSubscription}
      />
      <ManageCreditsModal
        key={credits?.userId ?? 'none'}
        member={credits}
        onClose={() => setCredits(null)}
      />
    </div>
  )
}
