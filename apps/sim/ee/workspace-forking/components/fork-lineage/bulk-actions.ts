import type { BulkActionCopy } from '@/app/workspace/[workspaceId]/settings/components/bulk-action'

const forkCount = (rows: number) => `${rows} ${rows === 1 ? 'fork' : 'forks'}`

/**
 * Severing several fork edges at once.
 *
 * Worded as disconnection rather than deletion because nothing is deleted: both workspaces and
 * everything in them survive. What ends is the relationship, and with it the saved mappings and
 * sync history that only existed to serve it.
 */
export const DISCONNECT_FORKS_COPY: BulkActionCopy = {
  title: 'Disconnect forks',
  triggerLabel: 'Actions for selected forks',
  pendingLabel: 'Disconnecting...',
  count: forkCount,
  lead: 'Disconnect ',
  consequence:
    ' from the workspaces they were forked from? Both sides stay exactly as they are, but they stop appearing in each other’s lineage and syncing between them ends. The saved mappings and sync history for each pair are deleted, and this cannot be undone.',
  succeeded: (rows) => `Disconnected ${forkCount(rows)}`,
  failed: (failures, rows) => `Couldn't disconnect ${failures} of ${forkCount(rows)}`,
}
