import { requestJson } from '@/lib/api/client/request'
import {
  type EnvironmentVariable,
  getPersonalEnvironmentContract,
  getWorkspaceEnvironmentContract,
  type WorkspaceEnvironmentData,
} from '@/lib/api/contracts'

export type { EnvironmentVariable, WorkspaceEnvironmentData }

export async function fetchPersonalEnvironment(
  signal?: AbortSignal
): Promise<Record<string, EnvironmentVariable>> {
  const { data } = await requestJson(getPersonalEnvironmentContract, { signal })

  if (data && typeof data === 'object') {
    return data
  }

  return {}
}

export async function fetchWorkspaceEnvironment(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceEnvironmentData> {
  const { data } = await requestJson(getWorkspaceEnvironmentContract, {
    params: { id: workspaceId },
    signal,
  })

  // Returned whole rather than rebuilt field-by-field: `requestJson` has already
  // validated against the contract and applied every `.default({})`, so
  // reconstructing here only creates a place for new response fields to be
  // silently dropped.
  return data
}
