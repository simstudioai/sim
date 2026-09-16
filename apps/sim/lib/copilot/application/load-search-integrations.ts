import {
  COPILOT_APPLICATION_DELEGATION_TTL_MS,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/copilot/auth/application-delegation'
import { authorizeOrganizationChatDelegation } from '@/lib/copilot/chat/organization-chats'
import { knowledgeDelegationPolicy } from '@/lib/knowledge/application/authorization'
import { listPersonalSearchIntegrations } from '@/lib/knowledge/application/personal-search-integrations'

const MAX_INVENTORY_PAGES = 100
const MAX_INVENTORY_BYTES = 256 * 1024

interface SearchIntegrationsContext {
  userId: string
  organizationId: string
  chatId: string
  messageId: string
  signal?: AbortSignal
}

type IntegrationInventory = Awaited<ReturnType<typeof listPersonalSearchIntegrations.execute>>

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

  const connections: IntegrationInventory['connections'] = []
  const available = new Map<string, IntegrationInventory['available'][number]>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < MAX_INVENTORY_PAGES; pageNumber++) {
    context.signal?.throwIfAborted()
    const page = await listPersonalSearchIntegrations.execute({
      principal,
      input: { organizationId: context.organizationId, ...(cursor ? { cursor } : {}) },
    })
    context.signal?.throwIfAborted()
    connections.push(...page.connections)
    for (const entry of page.available) {
      available.set(JSON.stringify(entry.target), entry)
    }
    const inventory = JSON.stringify({ connections, available: [...available.values()] })
    if (Buffer.byteLength(inventory) > MAX_INVENTORY_BYTES) {
      throw new Error('Search integration inventory exceeds the prompt size limit')
    }
    if (page.nextCursor === null) return inventory
    if (cursors.has(page.nextCursor)) {
      throw new Error('Search integration inventory pagination did not advance')
    }
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new Error('Search integration inventory exceeds the pagination limit')
}
