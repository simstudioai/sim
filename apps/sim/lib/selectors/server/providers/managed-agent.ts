import { AGENT_MEMORY_BETA, managedAgentsList } from '@/lib/managed-agents/session-client'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import {
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  requireListRequest,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type ManagedAgentSelectorKey = Extract<
  ServerSelectorKey,
  | 'managedAgent.agents'
  | 'managedAgent.environments'
  | 'managedAgent.vaults'
  | 'managedAgent.memoryStores'
>

type ManagedAgentResource = 'agents' | 'environments' | 'vaults' | 'memory-stores'

interface ManagedAgentRow {
  id?: unknown
  name?: unknown
  config?: { type?: unknown }
}

const RESOURCE_ENDPOINTS: Record<ManagedAgentResource, { path: string; beta?: string }> = {
  agents: { path: '/v1/agents' },
  environments: { path: '/v1/environments' },
  vaults: { path: '/v1/vaults' },
  'memory-stores': { path: '/v1/memory_stores', beta: AGENT_MEMORY_BETA },
}

function toOption(
  resource: ManagedAgentResource,
  row: ManagedAgentRow,
  environmentType: string | undefined
): SafeSelectorOption | null {
  if (typeof row.id !== 'string' || !row.id) return null
  const name = typeof row.name === 'string' ? row.name.trim() : ''

  if (resource === 'environments') {
    const type = row.config?.type
    const validType = type === 'cloud' || type === 'self_hosted' ? type : undefined
    if (
      (environmentType === 'cloud' || environmentType === 'self_hosted') &&
      validType !== undefined &&
      validType !== environmentType
    ) {
      return null
    }
    return {
      id: row.id,
      label: `${name || row.id}${validType ? ` (${validType})` : ''}`,
      ...(validType ? { meta: { type: validType } } : {}),
    }
  }

  if (resource === 'vaults') return { id: row.id, label: name || row.id }
  return { id: row.id, label: name ? `${name} (${row.id})` : row.id }
}

async function executeResource(args: ExecuteServerSelectorArgs, resource: ManagedAgentResource) {
  requireListRequest(args.selectorKey, args.request)
  const endpoint = RESOURCE_ENDPOINTS[resource]

  try {
    const bundle = await resolveSelectorCredentialBundle({
      credential: args.credential,
      protectedValues: args.protectedValues,
      recordCredentialUse: args.recordCredentialUse,
      providerId: 'claude-platform',
    })
    const rows = await managedAgentsList<ManagedAgentRow>({
      apiKey: bundle.accessToken,
      path: endpoint.path,
      beta: endpoint.beta,
      signal: args.signal,
    })
    return listSelectorResult(
      rows
        .map((row) => toOption(resource, row, args.context.environmentType))
        .filter((option): option is SafeSelectorOption => option !== null)
    )
  } catch (error) {
    if (args.signal?.aborted) throw error
    // Preserve the existing editor behavior for beta resources that are not
    // enabled in a Claude workspace: an unavailable collection is an empty list.
    return listSelectorResult([])
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['claude-platform'],
} as const

/**
 * The integration this selector reaches. Declared rather than derived: The managed-agent platform is an
 * API-key integration with no entry in the deployment OAuth catalog, so its
 * service id maps to no block type and the allowlist would have nothing to
 * judge it on.
 */
const integrationBlockTypes = ['managed_agent'] as const

export const managedAgentSelectorAttachments = {
  'managedAgent.agents': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: (args) => executeResource(args, 'agents'),
  },
  'managedAgent.environments': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: (args) => executeResource(args, 'environments'),
  },
  'managedAgent.vaults': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: (args) => executeResource(args, 'vaults'),
  },
  'managedAgent.memoryStores': {
    credential,
    integrationBlockTypes,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: (args) => executeResource(args, 'memory-stores'),
  },
} satisfies ServerSelectorAttachmentMap<ManagedAgentSelectorKey>
