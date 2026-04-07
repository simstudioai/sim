import { API_ENDPOINTS } from '@/stores/constants'

export interface EnvironmentVariable {
  key: string
  value: string
}

export interface WorkspaceEnvironmentData {
  workspace: Record<string, string>
  personal: Record<string, string>
  conflicts: string[]
}

export async function fetchPersonalEnvironment(
  signal?: AbortSignal
): Promise<Record<string, EnvironmentVariable>> {
  const response = await fetch(API_ENDPOINTS.ENVIRONMENT, { signal })

  if (!response.ok) {
    await response.text().catch(() => {})
    throw new Error(`Failed to load environment variables: ${response.statusText}`)
  }

  const { data } = await response.json()

  if (data && typeof data === 'object') {
    return data
  }

  return {}
}

export async function fetchWorkspaceEnvironment(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceEnvironmentData> {
  const response = await fetch(API_ENDPOINTS.WORKSPACE_ENVIRONMENT(workspaceId), { signal })

  if (!response.ok) {
    await response.text().catch(() => {})
    throw new Error(`Failed to load workspace environment: ${response.statusText}`)
  }

  const { data } = await response.json()

  return {
    workspace: data.workspace || {},
    personal: data.personal || {},
    conflicts: data.conflicts || [],
  }
}
