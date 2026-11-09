'use client'

import { useDeleteWorkspaceCredential, useWorkspaceCredentials } from '@/hooks/queries/credentials'

/** One workspace's connected credentials, as legacy's workspace Integrations page read them. */
export function useWorkspaceConnections(workspaceId: string | undefined) {
  const credentials = useWorkspaceCredentials({ workspaceId })
  const remove = useDeleteWorkspaceCredential(workspaceId)
  return {
    credentials,
    pending: remove.isPending,
    /** Settles with the deletion, so a confirming dialog stays open and reports a failure. */
    disconnect: (credentialId: string) => remove.mutateAsync(credentialId),
  }
}
