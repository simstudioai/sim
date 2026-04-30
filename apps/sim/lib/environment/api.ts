import type { z } from 'zod'
import { requestJson } from '@/lib/api/client/request'
import {
  type environmentVariableSchema,
  getPersonalEnvironmentContract,
  getWorkspaceEnvironmentContract,
  type workspaceEnvironmentDataSchema,
} from '@/lib/api/contracts'

export type EnvironmentVariable = z.output<typeof environmentVariableSchema>

export type WorkspaceEnvironmentData = z.output<typeof workspaceEnvironmentDataSchema>

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

  return {
    workspace: data.workspace || {},
    personal: data.personal || {},
    conflicts: data.conflicts || [],
  }
}
