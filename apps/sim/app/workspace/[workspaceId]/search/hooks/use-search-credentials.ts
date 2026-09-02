'use client'

import { useMemo } from 'react'
import { useSession } from '@/lib/auth/auth-client'
import { isSearchConnectorProvider } from '@/lib/sim-search/connectors'
import { useWorkspaceCredentials, type WorkspaceCredential } from '@/hooks/queries/credentials'

const EMPTY_CREDENTIALS: readonly WorkspaceCredential[] = []

interface UseSearchCredentialsResult {
  /** The viewer's own OAuth credentials for Sim Search connector providers. */
  credentials: readonly WorkspaceCredential[]
  isPending: boolean
}

/**
 * The credentials the Sim Search surface shows as connected. Sim Search
 * connections are personal: the surface lists only credentials the viewer
 * created, so a workspace admin — who can see every shared credential — still
 * sees just their own here. Service accounts are excluded, as they are from the
 * knowledge-base connector picker: no connector can authenticate with one.
 *
 * Reads the same unfiltered workspace credential query the integrations pages
 * use, so the two surfaces share one cache and one invalidation path.
 */
export function useSearchCredentials(workspaceId: string): UseSearchCredentialsResult {
  const { data: session, isPending: sessionPending } = useSession()
  const userId = session?.user?.id
  const { data: allCredentials, isPending: credentialsPending } = useWorkspaceCredentials({
    workspaceId,
    enabled: Boolean(workspaceId),
  })

  const credentials = useMemo(() => {
    if (!userId || !allCredentials) return EMPTY_CREDENTIALS
    return allCredentials.filter(
      (credential) =>
        credential.type === 'oauth' &&
        credential.createdBy === userId &&
        isSearchConnectorProvider(credential.providerId)
    )
  }, [allCredentials, userId])

  return {
    credentials,
    isPending: sessionPending || (Boolean(workspaceId) && credentialsPending),
  }
}
