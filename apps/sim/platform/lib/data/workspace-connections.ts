'use client'

import { useDeleteWorkspaceCredential, useWorkspaceCredentials } from '@/hooks/queries/credentials'

/**
 * One workspace's connected credentials, as legacy's workspace Integrations page read them. With
 * `enabled` false the list is left unread, for a view that shows none of it.
 */
export function useWorkspaceConnections(workspaceId: string | undefined, enabled = true) {
  const credentials = useWorkspaceCredentials({ workspaceId, enabled })
  const remove = useDeleteWorkspaceCredential(workspaceId)
  return {
    credentials,
    pending: remove.isPending,
    /** Settles with the deletion, so a confirming dialog stays open and reports a failure. */
    disconnect: (credentialId: string) => remove.mutateAsync(credentialId),
  }
}
