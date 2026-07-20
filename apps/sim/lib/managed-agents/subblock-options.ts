import { requestJson } from '@/lib/api/client/request'
import {
  getManagedAgentDefaultsContract,
  listManagedAgentAgentsContract,
  listManagedAgentConnectionsContract,
  listManagedAgentEnvironmentsContract,
  listManagedAgentMemoryStoresContract,
  listManagedAgentVaultsContract,
  type ManagedAgentSelfHostedDefaultRow,
} from '@/lib/api/contracts'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * fetchOptions helpers for the Managed Agent workflow block's dropdowns.
 *
 * The subblock system passes only `blockId` to `fetchOptions`; each helper
 * reads the sibling subblock values it depends on from the subblock store
 * (`connection` → agents / environments / vaults). Same pattern the Agent
 * block uses for its `reasoningEffort` / `verbosity` fetchers.
 *
 * All requests go through the workspace-scoped proxy routes, which decrypt
 * the stored API key server-side and hit Claude Platform on our behalf —
 * the API key never touches the browser.
 */

interface SubBlockOption {
  label: string
  id: string
}

function activeWorkspaceId(): string | null {
  return useWorkflowRegistry.getState().hydration.workspaceId ?? null
}

function connectionIdForBlock(blockId: string): string | null {
  const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
  if (!activeWorkflowId) return null
  const workflowValues = useSubBlockStore.getState().workflowValues[activeWorkflowId]
  const value = workflowValues?.[blockId]?.connection
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** List Managed Agent connections in the current workspace. */
export async function fetchManagedAgentConnectionOptions(): Promise<SubBlockOption[]> {
  const workspaceId = activeWorkspaceId()
  if (!workspaceId) return []
  try {
    const { data } = await requestJson(listManagedAgentConnectionsContract, {
      query: { workspaceId },
    })
    return data.map((row) => ({ id: row.id, label: row.name || row.id }))
  } catch {
    return []
  }
}

/** List agents inside the connection selected on `blockId`. */
export async function fetchManagedAgentAgentOptions(blockId: string): Promise<SubBlockOption[]> {
  const workspaceId = activeWorkspaceId()
  const connectionId = connectionIdForBlock(blockId)
  if (!workspaceId || !connectionId) return []
  try {
    const { data } = await requestJson(listManagedAgentAgentsContract, {
      params: { id: connectionId },
      query: { workspaceId },
    })
    return data.map((row) => ({
      id: row.id,
      label: row.name ? `${row.name} (${row.id})` : row.id,
    }))
  } catch {
    return []
  }
}

/**
 * List environments inside the connection selected on `blockId`. Options
 * carry the config type in the label (e.g. "prod (self-hosted)") so users
 * can tell which env types they're picking without a second lookup.
 */
export async function fetchManagedAgentEnvironmentOptions(
  blockId: string,
  filterType?: 'cloud' | 'self_hosted'
): Promise<SubBlockOption[]> {
  const workspaceId = activeWorkspaceId()
  const connectionId = connectionIdForBlock(blockId)
  if (!workspaceId || !connectionId) return []
  try {
    const { data } = await requestJson(listManagedAgentEnvironmentsContract, {
      params: { id: connectionId },
      query: { workspaceId },
    })
    return data
      .filter((row) => (filterType ? row.envType === filterType : true))
      .map((row) => ({ id: row.id, label: row.name ? `${row.name} (${row.id})` : row.id }))
  } catch {
    return []
  }
}

/**
 * Cloud-only environment picker. Bound directly to a block's
 * `fetchOptions` (no wrapping) so the block signature matches the
 * subblock system's expected `(blockId: string) => Promise<Option[]>`.
 */
export function fetchManagedAgentCloudEnvironmentOptions(
  blockId: string
): Promise<SubBlockOption[]> {
  return fetchManagedAgentEnvironmentOptions(blockId, 'cloud')
}

/** Self-hosted-only environment picker. */
export function fetchManagedAgentSelfHostedEnvironmentOptions(
  blockId: string
): Promise<SubBlockOption[]> {
  return fetchManagedAgentEnvironmentOptions(blockId, 'self_hosted')
}

/**
 * Fetches the environment's raw config for the block's `environmentType`
 * companion field. Called after the user picks an environment so the
 * `sessionParameters` subblock's `condition: environmentType==='self_hosted'`
 * can gate correctly without a follow-up server round-trip at execute time.
 */
export async function fetchManagedAgentEnvironmentType(
  blockId: string,
  environmentId: string
): Promise<'cloud' | 'self_hosted' | null> {
  const workspaceId = activeWorkspaceId()
  const connectionId = connectionIdForBlock(blockId)
  if (!workspaceId || !connectionId || !environmentId) return null
  try {
    const { data } = await requestJson(listManagedAgentEnvironmentsContract, {
      params: { id: connectionId },
      query: { workspaceId },
    })
    const match = data.find((row) => row.id === environmentId)
    return match?.envType ?? null
  } catch {
    return null
  }
}

/** List vaults for the connection selected on `blockId`. */
export async function fetchManagedAgentVaultOptions(blockId: string): Promise<SubBlockOption[]> {
  const workspaceId = activeWorkspaceId()
  const connectionId = connectionIdForBlock(blockId)
  if (!workspaceId || !connectionId) return []
  try {
    const { data } = await requestJson(listManagedAgentVaultsContract, {
      params: { id: connectionId },
      query: { workspaceId },
    })
    return data.map((row) => ({ id: row.id, label: row.name || row.id }))
  } catch {
    return []
  }
}

/** List memory stores for the connection selected on `blockId`. */
export async function fetchManagedAgentMemoryStoreOptions(
  blockId: string
): Promise<SubBlockOption[]> {
  const workspaceId = activeWorkspaceId()
  const connectionId = connectionIdForBlock(blockId)
  if (!workspaceId || !connectionId) return []
  try {
    const { data } = await requestJson(listManagedAgentMemoryStoresContract, {
      params: { id: connectionId },
      query: { workspaceId },
    })
    return data.map((row) => ({
      id: row.id,
      label: row.name ? `${row.name} (${row.id})` : row.id,
    }))
  } catch {
    return []
  }
}

/**
 * Fetch the deployer-configured default rows the Claude Managed Agents
 * (self-hosted) block seeds into its Session parameters table. Values
 * live in the server-only env var `MANAGED_AGENT_SELF_HOSTED_DEFAULTS`
 * and are read via the `/api/managed-agent-defaults` route so they
 * never enter the client bundle at build time.
 */
export async function fetchManagedAgentSelfHostedDefaults(): Promise<
  ManagedAgentSelfHostedDefaultRow[]
> {
  try {
    const { selfHosted } = await requestJson(getManagedAgentDefaultsContract, {})
    return selfHosted
  } catch {
    return []
  }
}
