import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { listOAuthCredentialsContract } from '@/lib/api/contracts'
import { listOrganizationOAuthCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import type { Credential } from '@/lib/oauth'
import { useWorkspaceCredential } from '@/hooks/queries/credentials'

export const OAUTH_CREDENTIAL_LIST_STALE_TIME = 60 * 1000
export const OAUTH_CREDENTIAL_DETAIL_STALE_TIME = 60 * 1000

export const oauthCredentialKeys = {
  all: ['oauthCredentials'] as const,
  lists: () => [...oauthCredentialKeys.all, 'list'] as const,
  list: (providerId?: string, workspaceId?: string, workflowId?: string, organizationId?: string) =>
    [
      ...oauthCredentialKeys.lists(),
      providerId ?? 'none',
      workspaceId ?? 'none',
      workflowId ?? 'none',
      organizationId ?? 'none',
    ] as const,
  details: () => [...oauthCredentialKeys.all, 'detail'] as const,
  detail: (credentialId?: string, workflowId?: string) =>
    [...oauthCredentialKeys.details(), credentialId ?? 'none', workflowId ?? 'none'] as const,
}

interface FetchOAuthCredentialsParams {
  providerId: string
  workspaceId?: string
  organizationId?: string
  workflowId?: string
}

export async function fetchOAuthCredentials(
  params: FetchOAuthCredentialsParams,
  signal?: AbortSignal
): Promise<Credential[]> {
  const { providerId, workspaceId, workflowId, organizationId } = params
  if (!providerId) return []
  if (organizationId) {
    if (workspaceId || workflowId)
      throw new Error('Organization credential listing cannot include a workspace or workflow')
    return (
      await requestJson(listOrganizationOAuthCredentialsContract, {
        query: { organizationId, providerId },
        signal,
      })
    ).credentials
  }
  const data = await requestJson(listOAuthCredentialsContract, {
    signal,
    query: {
      provider: providerId,
      workspaceId,
      workflowId,
    },
  })
  return data.credentials ?? []
}

export async function fetchOAuthCredentialDetail(
  credentialId: string,
  workflowId?: string,
  signal?: AbortSignal
): Promise<Credential[]> {
  if (!credentialId) return []
  const data = await requestJson(listOAuthCredentialsContract, {
    signal,
    query: {
      credentialId,
      workflowId,
    },
  })
  return data.credentials ?? []
}

interface UseOAuthCredentialsOptions {
  enabled?: boolean
  workspaceId?: string
  organizationId?: string
  workflowId?: string
}

function resolveOptions(
  enabledOrOptions?: boolean | UseOAuthCredentialsOptions
): Required<UseOAuthCredentialsOptions> {
  if (typeof enabledOrOptions === 'boolean') {
    return {
      enabled: enabledOrOptions,
      workspaceId: '',
      organizationId: '',
      workflowId: '',
    }
  }

  return {
    enabled: enabledOrOptions?.enabled ?? true,
    workspaceId: enabledOrOptions?.workspaceId ?? '',
    organizationId: enabledOrOptions?.organizationId ?? '',
    workflowId: enabledOrOptions?.workflowId ?? '',
  }
}

export function useOAuthCredentials(
  providerId?: string,
  enabledOrOptions?: boolean | UseOAuthCredentialsOptions
) {
  const { enabled, workspaceId, workflowId, organizationId } = resolveOptions(enabledOrOptions)

  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.list(providerId, workspaceId, workflowId, organizationId),
    queryFn: ({ signal }) =>
      fetchOAuthCredentials(
        {
          providerId: providerId ?? '',
          workspaceId: workspaceId || undefined,
          organizationId: organizationId || undefined,
          workflowId: workflowId || undefined,
        },
        signal
      ),
    enabled: Boolean(providerId) && enabled,
    staleTime: OAUTH_CREDENTIAL_LIST_STALE_TIME,
  })
}

export function useOAuthCredentialDetail(
  credentialId?: string,
  workflowId?: string,
  enabled = true
) {
  return useQuery<Credential[]>({
    queryKey: oauthCredentialKeys.detail(credentialId, workflowId),
    queryFn: ({ signal }) => fetchOAuthCredentialDetail(credentialId ?? '', workflowId, signal),
    enabled: Boolean(credentialId) && enabled,
    staleTime: OAUTH_CREDENTIAL_DETAIL_STALE_TIME,
  })
}

export function useCredentialName(
  credentialId?: string,
  providerId?: string,
  workflowId?: string,
  workspaceId?: string
) {
  const { data: credentials = [], isFetching: credentialsLoading } = useOAuthCredentials(
    providerId,
    {
      enabled: Boolean(providerId),
      workspaceId,
      workflowId,
    }
  )

  const selectedCredential = credentials.find((cred) => cred.id === credentialId)

  const shouldFetchDetail = Boolean(credentialId && !selectedCredential && providerId && workflowId)

  const { data: foreignCredentials = [], isFetching: foreignLoading } = useOAuthCredentialDetail(
    shouldFetchDetail ? credentialId : undefined,
    workflowId,
    shouldFetchDetail
  )

  // Fallback for credential blocks that have no serviceId/providerId — look up by ID directly
  const { data: workspaceCredential, isFetching: workspaceCredentialLoading } =
    useWorkspaceCredential(!providerId ? credentialId : undefined)

  const detailCredential = foreignCredentials[0]
  const hasForeignMeta = foreignCredentials.length > 0

  const displayName =
    selectedCredential?.name ?? detailCredential?.name ?? workspaceCredential?.displayName ?? null

  return {
    displayName,
    isLoading: credentialsLoading || foreignLoading || workspaceCredentialLoading,
    hasForeignMeta,
  }
}
