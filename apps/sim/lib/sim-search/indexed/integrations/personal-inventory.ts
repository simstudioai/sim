import type { Principal } from '@sim/auth/principal'
import {
  type PersonalSearchIntegrationsPage,
  personalSearchIntegrationPages,
} from '@/lib/knowledge/application/personal-search-integration-pages'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

/**
 * The indexed arm of Sim's Search inventory for one chat turn: every page of the viewer's
 * personal connections on the indexed sources, merged and serialized for the prompt. Indexed
 * inventory pages by source, where Live Search returns a single page.
 */
export async function loadIndexedSearchIntegrationInventory({
  principal,
  organizationId,
  signal,
  maxBytes,
}: {
  principal: Principal
  organizationId: string
  signal?: AbortSignal
  maxBytes: number
}): Promise<string> {
  assertIndexedOrgSearchEnabled()
  const connections: Array<PersonalSearchIntegrationsPage['connections'][number]> = []
  const available = new Map<string, PersonalSearchIntegrationsPage['available'][number]>()
  let inventory = JSON.stringify({ connections, available: [] })
  for await (const page of personalSearchIntegrationPages({
    principal,
    input: { organizationId },
    signal,
  })) {
    connections.push(...page.connections)
    for (const entry of page.available) {
      available.set(JSON.stringify(entry.target), entry)
    }
    inventory = JSON.stringify({ connections, available: [...available.values()] })
    if (Buffer.byteLength(inventory) > maxBytes) {
      throw new Error('Search integration inventory exceeds the prompt size limit')
    }
  }
  return inventory
}
