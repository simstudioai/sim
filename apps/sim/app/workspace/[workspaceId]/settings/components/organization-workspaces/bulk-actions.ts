import type { BulkActionCopy } from '@/app/workspace/[workspaceId]/settings/components/bulk-action'
import type { WorkspaceAccessTab } from '@/app/workspace/[workspaceId]/settings/components/organization-workspaces/search-params'

const workspaceCount = (rows: number) => `${rows} ${rows === 1 ? 'workspace' : 'workspaces'}`
const memberCount = (rows: number) => `${rows} ${rows === 1 ? 'member' : 'members'}`
const inviteCount = (rows: number) => `${rows} ${rows === 1 ? 'invite' : 'invites'}`

/**
 * Deleting workspaces from the organization list.
 *
 * Worded as deletion because that is the decision the user is making, though
 * the route archives rather than hard-deletes — the workspace and everything in
 * it stops being reachable either way, and "archive" would understate that.
 */
export const DELETE_WORKSPACES_COPY: BulkActionCopy = {
  title: 'Delete workspaces',
  triggerLabel: 'Actions for selected workspaces',
  pendingLabel: 'Deleting...',
  count: workspaceCount,
  lead: 'Delete ',
  consequence:
    '? Every workflow, log, and file inside them stops being reachable, and everyone who had access loses it. This action cannot be undone.',
  succeeded: (rows) => `Deleted ${workspaceCount(rows)}`,
  failed: (failures, rows) => `Couldn't delete ${failures} of ${workspaceCount(rows)}`,
}

/**
 * Withdrawing access to one workspace, per tab of its detail view.
 *
 * Both are scoped to that workspace alone: a member keeps their organization
 * membership and every other workspace they belong to, and an invitation keeps
 * its remaining grants — it is cancelled outright only when this was the last
 * one.
 */
export const WORKSPACE_ACCESS_BULK_COPY: Record<WorkspaceAccessTab, BulkActionCopy> = {
  members: {
    title: 'Remove from workspace',
    triggerLabel: 'Actions for selected members',
    pendingLabel: 'Removing...',
    count: memberCount,
    lead: 'Remove ',
    consequence:
      ' from this workspace? They keep their organization membership and any other workspace they belong to.',
    succeeded: (rows) => `Removed ${memberCount(rows)} from this workspace`,
    failed: (failures, rows) => `Couldn't remove ${failures} of ${memberCount(rows)}`,
  },
  pending: {
    title: 'Revoke access',
    triggerLabel: 'Actions for selected invites',
    pendingLabel: 'Revoking...',
    count: inviteCount,
    lead: 'Revoke ',
    consequence:
      ' to this workspace? Their invitation stands for any other workspace it grants, and is cancelled outright only if this was the last one.',
    succeeded: (rows) => `Revoked ${inviteCount(rows)} to this workspace`,
    failed: (failures, rows) => `Couldn't revoke ${failures} of ${inviteCount(rows)}`,
  },
}
