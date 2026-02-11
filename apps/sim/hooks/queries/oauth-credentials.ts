import { useQuery } from '@tanstack/react-query'
import {
  clearPendingOAuthCredentialDraft,
  readPendingOAuthCredentialDraft,
} from '@/lib/credentials/client-state'
import type { Credential } from '@/lib/oauth'
import { CREDENTIAL_SET } from '@/executor/constants'
import { useCredentialSetDetail } from '@/hooks/queries/credential-sets'
import { fetchJson } from '@/hooks/selectors/helpers'

interface CredentialListResponse {
  credentials?: Credential[]
}

interface CredentialDetailResponse {
  credentials?: Credential[]
}

interface AuthAccountsResponse {
  accounts?: Array<{ id: string }>
}

export const oauthCredentialKeys = {
  list: (providerId?: string, workspaceId?: string, workflowId?: string) =>
    [
      'oauthCredentials',
      providerId ?? 'none',
      workspaceId ?? 'none',
      workflowId ?? 'none',
    ] as const,
  detail: (credentialId?: string, workflowId?: string) =>
    ['oauthCredentialDetail', credentialId ?? 'none', workflowId ?? 'none'] as const,
}

interface FetchOAuthCredentialsParams {
  providerId: string
  workspaceId?: string
  workflowId?: string
}

async function finalizePendingOAuthCredentialDraftIfNeeded(params: {
  providerId: string
  workspaceId?: string
}) {
  const { providerId, workspaceId } = params
  if (!workspaceId || !providerId) return
  if (typeof window === 'undefined') return

  const draft = readPendingOAuthCredentialDraft()
  if (!draft) return
  if (draft.workspaceId !== workspaceId || draft.providerId !== providerId) return

  const draftAgeMs = Date.now() - draft.requestedAt
  if (draftAgeMs > 15 * 60 * 1000) {
    clearPendingOAuthCredentialDraft()
    return
  }

  const bootstrapResponse = await fetch('/api/credentials/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId }),
  })
  if (!bootstrapResponse.ok) {
    return
  }

  const accountsResponse = await fetch(
    `/api/auth/accounts?provider=${encodeURIComponent(providerId)}`
  )
  if (!accountsResponse.ok) {
    return
  }
  const accountsData = (await accountsResponse.json()) as AuthAccountsResponse
  const accountIds = (accountsData.accounts ?? []).map((account) => account.id)
  if (accountIds.length === 0) {
    return
  }

  const targetAccountId =
    accountIds.find((accountId) => !draft.existingAccountIds.includes(accountId)) ?? accountIds[0]
  if (!targetAccountId) {
    return
  }

  const createResponse = await fetch('/api/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId,
      type: 'oauth',
      displayName: draft.displayName,
      providerId,
      accountId: targetAccountId,
    }),
  })
  if (!createResponse.ok) {
    return
  }

  clearPendingOAuthCredentialDraft()
  window.dispatchEvent(
    new CustomEvent('oauth-credentials-updated', {
      detail: { providerId, workspaceId },
    })
  )
}

export async function fetchOAuthCredentials(
  params: FetchOAuthCredentialsParams
): Promise<Credential[]> {
  const { providerId, workspaceId, workflowId } = params
  if (!providerId) return []
  await finalizePendingOAuthCredentialDraftIfNeeded({ providerId, workspaceId })
  const data = await fetchJson<CredentialListResponse>('/api/auth/oauth/credentials', {
    searchParams: {
      provider: providerId,
      workspaceId,
      workflowId,
    },
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

interface UseOAuthCredentialsOptions {
  enabled?: boolean
  workspaceId?: string
  workflowId?: string
}

function resolveOptions(
  enabledOrOptions?: boolean | UseOAuthCredentialsOptions
): Required<UseOAuthCredentialsOptions> {
  if (typeof enabledOrOptions === 'boolean') {
    return {
      enabled: enabledOrOptions,
      workspaceId: '',
      workflowId: '',
    }
  }

  return {
    enabled: enabledOrOptions?.enabled ?? true,
    workspaceId: enabledOrOptions?.workspaceId ?? '',
    workflowId: enabledOrOptions?.workflowId ?? '',
  }
}

export function useOAuthCredentials(
  providerId?: string,
  enabledOrOptions?: boolean | UseOAuthCredentialsOptions
) {
  const { enabled, workspaceId, workflowId } = resolveOptions(enabledOrOptions)

  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.list(providerId, workspaceId, workflowId),
    queryFn: () =>
      fetchOAuthCredentials({
        providerId: providerId ?? '',
        workspaceId: workspaceId || undefined,
        workflowId: workflowId || undefined,
      }),
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

  // Fetch credential set by ID directly
  const { data: credentialSetData, isFetching: credentialSetLoading } = useCredentialSetDetail(
    credentialSetId,
    isCredentialSet
  )

  const { data: credentials = [], isFetching: credentialsLoading } = useOAuthCredentials(
    providerId,
    {
      enabled: Boolean(providerId) && !isCredentialSet,
      workspaceId,
      workflowId,
    }
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

  const detailCredential = foreignCredentials[0]
  const hasForeignMeta = foreignCredentials.length > 0

  const displayName =
    credentialSetData?.name ?? selectedCredential?.name ?? detailCredential?.name ?? null

  return {
    displayName,
    isLoading:
      credentialsLoading ||
      foreignLoading ||
      (isCredentialSet && credentialSetLoading && !credentialSetData),
    hasForeignMeta,
  }
}
