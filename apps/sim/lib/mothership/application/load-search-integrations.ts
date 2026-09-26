import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'
import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/mothership/chat/organization-chats'
import { loadIndexedSearchIntegrationInventory } from '@/lib/sim-search/indexed'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import { listLiveSearchAccounts } from '@/lib/sim-search/live/application'

const MAX_INVENTORY_BYTES = 256 * 1024

interface SearchIntegrationsContext {
  userId: string
  organizationId: string
  chatId: string
  messageId: string
  signal?: AbortSignal
}

/** Loads the complete current person's Search inventory for one authenticated chat turn. */
export async function loadCopilotSearchIntegrations(
  context: SearchIntegrationsContext
): Promise<string> {
  context.signal?.throwIfAborted()
  const principal = createTrustedOrganizationCopilotPrincipal(
    { ...context, delegationId: context.messageId },
    {
      audience: knowledgeDelegationPolicy.audience,
      ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS,
    }
  )
  await authorizeOrganizationChatDelegation.execute({ principal })

  if (isIndexedOrgSearchEnabled())
    return loadIndexedSearchIntegrationInventory({
      principal,
      organizationId: context.organizationId,
      signal: context.signal,
      maxBytes: MAX_INVENTORY_BYTES,
    })

  const [inventory, connections] = await Promise.all([
    listLiveSearchAccounts.execute({
      principal,
      input: { organizationId: context.organizationId },
    }),
    listPersonalSearchIntegrations.execute({
      principal,
      input: { organizationId: context.organizationId },
    }),
  ])
  context.signal?.throwIfAborted()
  const result = JSON.stringify({
    ...inventory,
    connections: connections.connections,
    available: connections.available,
    connectionGuidance:
      'Offer the exact available target or account action in a terminal <credential> tag to connect or reconnect in chat. Search uses the provider APIs directly. Account inventory alone does not establish permission to search; a provider search must succeed.',
  })
  if (Buffer.byteLength(result) > MAX_INVENTORY_BYTES)
    throw new Error('Search integration inventory exceeds the prompt size limit')
  return result
}
