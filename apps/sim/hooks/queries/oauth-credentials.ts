import { useQuery } from '@tanstack/react-query'
import type { Credential } from '@/lib/oauth'
import { CREDENTIAL_SET } from '@/executor/constants'
import { useCredentialSetMemberships, useCredentialSets } from '@/hooks/queries/credential-sets'
import { fetchJson } from '@/hooks/selectors/helpers'

interface CredentialListResponse {
  credentials?: Credential[]
}

interface CredentialDetailResponse {
  credentials?: Credential[]
}

export const oauthCredentialKeys = {
  list: (providerId?: string) => ['oauthCredentials', providerId ?? 'none'] as const,
  detail: (credentialId?: string, workflowId?: string) =>
    ['oauthCredentialDetail', credentialId ?? 'none', workflowId ?? 'none'] as const,
}

export async function fetchOAuthCredentials(providerId: string): Promise<Credential[]> {
  if (!providerId) return []
  const data = await fetchJson<CredentialListResponse>('/api/auth/oauth/credentials', {
    searchParams: { provider: providerId },
  })
  return data.credentials ?? []
}

export async function fetchOAuthCredentialDetail(
  credentialId: string,
  workflowId?: string
): Promise<Credential[]> {
  if (!credentialId) return []
  const data = await fetchJson<CredentialDetailResponse>('/api/auth/oauth/credentials', {
    searchParams: {
      credentialId,
      workflowId,
    },
  })
  return data.credentials ?? []
}

export function useOAuthCredentials(providerId?: string, enabled = true) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.list(providerId),
    queryFn: () => fetchOAuthCredentials(providerId ?? ''),
    enabled: Boolean(providerId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useOAuthCredentialDetail(
  credentialId?: string,
  workflowId?: string,
  enabled = true
) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.detail(credentialId, workflowId),
    queryFn: () => fetchOAuthCredentialDetail(credentialId ?? '', workflowId),
    enabled: Boolean(credentialId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useCredentialName(
  credentialId?: string,
  providerId?: string,
  workflowId?: string,
  workspaceId?: string
) {
  // Check if this is a credential set value
  const isCredentialSet = credentialId?.startsWith(CREDENTIAL_SET.PREFIX) ?? false
  const credentialSetId = isCredentialSet
    ? credentialId?.slice(CREDENTIAL_SET.PREFIX.length)
    : undefined

  // Fetch credential set memberships if this is a credential set
  const { data: memberships = [], isFetching: membershipsLoading } = useCredentialSetMemberships()

  // Also fetch owned credential sets to check there
  const { data: ownedSets = [], isFetching: ownedSetsLoading } = useCredentialSets(
    workspaceId,
    isCredentialSet && Boolean(workspaceId)
  )

  const { data: credentials = [], isFetching: credentialsLoading } = useOAuthCredentials(
    providerId,
    Boolean(providerId) && !isCredentialSet
  )

  const selectedCredential = credentials.find((cred) => cred.id === credentialId)

  const shouldFetchDetail = Boolean(
    credentialId && !selectedCredential && providerId && workflowId && !isCredentialSet
  )

  const { data: foreignCredentials = [], isFetching: foreignLoading } = useOAuthCredentialDetail(
    shouldFetchDetail ? credentialId : undefined,
    workflowId,
    shouldFetchDetail
  )

  const hasForeignMeta = foreignCredentials.length > 0

  // For credential sets, find the matching membership or owned set and use its name
  const credentialSetName = credentialSetId
    ? (memberships.find((m) => m.credentialSetId === credentialSetId)?.credentialSetName ??
      ownedSets.find((s) => s.id === credentialSetId)?.name)
    : undefined

  const displayName =
    credentialSetName ??
    selectedCredential?.name ??
    (hasForeignMeta ? 'Saved by collaborator' : null)

  return {
    displayName,
    isLoading:
      credentialsLoading ||
      foreignLoading ||
      (isCredentialSet && (membershipsLoading || ownedSetsLoading)),
    hasForeignMeta,
  }
}
