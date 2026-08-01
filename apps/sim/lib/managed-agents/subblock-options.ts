import { requestJson } from '@/lib/api/client/request'
import {
  listManagedAgentOptionsContract,
  type ManagedAgentOption,
  type ManagedAgentResource,
} from '@/lib/api/contracts/managed-agents'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

/**
 * `fetchOptions` helpers for the Managed Agent block's dropdowns. Each reads
 * the block's selected Claude Platform `credential` and calls the list route,
 * which decrypts the credential's key server-side — the API key never touches
 * the browser.
 */

function readSubBlockValue(blockId: string, key: string): string | null {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return null
  const value = useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function fetchOptions(
  blockId: string,
  resource: ManagedAgentResource
): Promise<ManagedAgentOption[]> {
  const credentialId = readSubBlockValue(blockId, 'credential')
  if (!credentialId) return []
  try {
    const { options } = await requestJson(listManagedAgentOptionsContract, {
      query: { credentialId, resource },
    })
    return options
  } catch {
    return []
  }
}

export function fetchManagedAgentAgentOptions(blockId: string): Promise<ManagedAgentOption[]> {
  return fetchOptions(blockId, 'agents')
}

export async function fetchManagedAgentEnvironmentOptions(
  blockId: string
): Promise<ManagedAgentOption[]> {
  const options = await fetchOptions(blockId, 'environments')
  // Filter to the selected environment type so cloud/self-hosted stay separate
  // (self-hosted rejects `resources`, so the two modes expose different fields).
  // Options with an unknown type are kept as a safety net.
  const mode = readSubBlockValue(blockId, 'environmentType')
  if (mode !== 'cloud' && mode !== 'self_hosted') return options
  return options.filter((option) => option.type === undefined || option.type === mode)
}

export function fetchManagedAgentVaultOptions(blockId: string): Promise<ManagedAgentOption[]> {
  return fetchOptions(blockId, 'vaults')
}

export function fetchManagedAgentMemoryStoreOptions(
  blockId: string
): Promise<ManagedAgentOption[]> {
  return fetchOptions(blockId, 'memory-stores')
}
