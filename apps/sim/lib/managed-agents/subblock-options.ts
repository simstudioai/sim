import { requestJson } from '@/lib/api/client/request'
import {
  listManagedAgentOptionsContract,
  type ManagedAgentOption,
  type ManagedAgentResource,
} from '@/lib/api/contracts/managed-agents'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * `fetchOptions` helpers for the Managed Agent block's dropdowns. Each reads
 * the active workspace id from the registry and calls the workspace-scoped
 * list route, which decrypts the stored Claude Platform key server-side — the
 * API key never touches the browser.
 */

function activeWorkspaceId(): string | null {
  return useWorkflowRegistry.getState().hydration.workspaceId ?? null
}

async function fetchOptions(resource: ManagedAgentResource): Promise<ManagedAgentOption[]> {
  const workspaceId = activeWorkspaceId()
  if (!workspaceId) return []
  try {
    const { options } = await requestJson(listManagedAgentOptionsContract, {
      query: { workspaceId, resource },
    })
    return options
  } catch {
    return []
  }
}

export function fetchManagedAgentAgentOptions(): Promise<ManagedAgentOption[]> {
  return fetchOptions('agents')
}

export function fetchManagedAgentEnvironmentOptions(): Promise<ManagedAgentOption[]> {
  return fetchOptions('environments')
}

export function fetchManagedAgentVaultOptions(): Promise<ManagedAgentOption[]> {
  return fetchOptions('vaults')
}

export function fetchManagedAgentMemoryStoreOptions(): Promise<ManagedAgentOption[]> {
  return fetchOptions('memory-stores')
}
