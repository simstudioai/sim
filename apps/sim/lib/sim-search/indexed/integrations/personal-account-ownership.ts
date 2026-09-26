import type { Principal } from '@sim/auth/principal'
import { personalSearchIntegrationPages } from '@/lib/knowledge/application/personal-search-integration-pages'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'

/**
 * The indexed arm of organization personal-token ownership: whether the viewer's personal Search
 * inventory lists `credentialId` as a connected account on this connector type. Indexed search
 * answers ownership from its per-source inventory, where Live Search reads the live accounts.
 */
export async function ownsIndexedPersonalSearchAccount(
  principal: Principal,
  input: { organizationId: string; connectorType: string; credentialId: string }
): Promise<boolean> {
  assertIndexedOrgSearchEnabled()
  for await (const page of personalSearchIntegrationPages({
    principal,
    input: { organizationId: input.organizationId, connectorType: input.connectorType },
  })) {
    if (
      page.connections.some((connection) =>
        connection.accounts.some(
          (account) => account.credentialId === input.credentialId && account.status === 'connected'
        )
      )
    )
      return true
  }
  return false
}
