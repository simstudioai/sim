import type { BulkActionCopy } from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import type { OrganizationMemberTab } from '@/app/workspace/[workspaceId]/settings/components/team-management/search-params'

const memberCount = (rows: number) => `${rows} ${rows === 1 ? 'member' : 'members'}`
const invitationCount = (rows: number) => `${rows} ${rows === 1 ? 'invitation' : 'invitations'}`

/**
 * The members table's bulk action, which is per-tab: remove accepted members, or
 * revoke pending invitations. The two are the same gesture from the user's side
 * — tick rows, open the `...`, confirm — so they share one runner and one
 * confirmation surface, and this table is the single place they differ.
 */
export const BULK_ACTION_COPY: Record<OrganizationMemberTab, BulkActionCopy> = {
  members: {
    title: 'Remove from Organization',
    triggerLabel: 'Actions for selected members',
    pendingLabel: 'Removing...',
    count: memberCount,
    lead: 'Remove ',
    consequence:
      ' from the organization? Their workspace access is revoked, and credentials they own stop working until another member reconnects them. This action cannot be undone.',
    succeeded: (rows) => `Removed ${memberCount(rows)} from the organization`,
    failed: (failures, rows) => `Couldn't remove ${failures} of ${memberCount(rows)}`,
  },
  invitations: {
    title: 'Revoke invites',
    triggerLabel: 'Actions for selected invitations',
    pendingLabel: 'Revoking...',
    count: invitationCount,
    lead: 'Revoke ',
    consequence:
      '? The invite links stop working immediately. You can invite these people again at any time.',
    succeeded: (rows) => `Revoked ${invitationCount(rows)}`,
    failed: (failures, rows) => `Couldn't revoke ${failures} of ${invitationCount(rows)}`,
  },
}
