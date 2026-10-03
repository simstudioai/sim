import { queryOptions } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ApiKey,
  listPersonalApiKeysContract,
  listWorkspaceApiKeysContract,
} from '@/lib/api/contracts/api-keys'

export type ApiKeyScope = 'combined' | 'personal' | 'workspace'

export interface CombinedApiKeysData {
  workspaceKeys: ApiKey[]
  personalKeys: ApiKey[]
  conflicts: string[]
}

export const apiKeysKeys = {
  all: ['apiKeys'] as const,
  workspaces: () => [...apiKeysKeys.all, 'workspace'] as const,
  workspace: (workspaceId: string) => [...apiKeysKeys.workspaces(), workspaceId] as const,
  personal: () => [...apiKeysKeys.all, 'personal'] as const,
  combineds: () => [...apiKeysKeys.all, 'combined'] as const,
  combined: (workspaceId: string) => [...apiKeysKeys.combineds(), workspaceId] as const,
}

export const API_KEYS_COMBINED_STALE_TIME = 60 * 1000

export async function fetchApiKeys(
  workspaceId: string,
  scope: ApiKeyScope,
  signal?: AbortSignal
): Promise<CombinedApiKeysData> {
  if (scope === 'personal') {
    const data = await requestJson(listPersonalApiKeysContract, { signal })
    return { workspaceKeys: [], personalKeys: data.keys, conflicts: [] }
  }
  if (scope === 'workspace') {
    const data = await requestJson(listWorkspaceApiKeysContract, {
      params: { id: workspaceId },
      signal,
    })
    return { workspaceKeys: data.keys, personalKeys: [], conflicts: [] }
  }

  const [workspaceData, personalData] = await Promise.all([
    requestJson(listWorkspaceApiKeysContract, { params: { id: workspaceId }, signal }),
    requestJson(listPersonalApiKeysContract, { signal }),
  ])
  const workspaceKeys = workspaceData.keys
  const personalKeys = personalData.keys
  const workspaceKeyNames = new Set(workspaceKeys.map((key) => key.name))
  const conflicts: string[] = []
  for (const key of personalKeys) {
    if (workspaceKeyNames.has(key.name)) conflicts.push(key.name)
  }

  return {
    workspaceKeys,
    personalKeys,
    conflicts,
  }
}

export function apiKeysQueryOptions(workspaceId: string, scope: ApiKeyScope = 'combined') {
  return queryOptions({
    queryKey:
      scope === 'personal'
        ? apiKeysKeys.personal()
        : scope === 'workspace'
          ? apiKeysKeys.workspace(workspaceId)
          : apiKeysKeys.combined(workspaceId),
    queryFn: ({ signal }) => fetchApiKeys(workspaceId, scope, signal),
    retryOnMount: true,
    staleTime: API_KEYS_COMBINED_STALE_TIME,
  })
}
