import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm'
import { inspectConfiguredOAuthClient } from '@/lib/core/config/env-capabilities.server'
import type { ResourceScope } from '@/lib/core/resource-scope'
import {
  MANAGED_MCP_CONNECTOR_IDS,
  MANAGED_MCP_CONNECTORS,
} from '@/lib/credential-groups/managed-mcp-connectors'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  type CredentialGroupProvider,
  getCredentialGroupProviderId,
  isCredentialGroupStandardOAuthProvider,
} from '@/lib/credential-groups/providers'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'

/**
 * The providers this deployment can actually enroll.
 *
 * A standard OAuth provider needs Sim's own OAuth client for that service to be configured;
 * without it the connector is never built and starting an enrollment fails with a configuration
 * error. Offering the option anyway leaves an admin with a row that only reports its own
 * unavailability after they have already added it to a group and invited somebody.
 *
 * Slack is exempt because its credential is the workspace's own custom bot, configured per group
 * after the fact — its readiness is already surfaced by the option's `configurationStatus`.
 *
 * Server-only: `inspectConfiguredOAuthClient` reads the server environment.
 */
export function listConfiguredCredentialGroupProviders(): CredentialGroupProvider[] {
  return CREDENTIAL_GROUP_PROVIDER_IDS.filter((provider) => {
    if (!isCredentialGroupStandardOAuthProvider(provider)) return true
    return inspectConfiguredOAuthClient(getCredentialGroupProviderId(provider)).state === 'ready'
  })
}

/** Existing group registrations remain usable when the deployment has no shared HubSpot client. */
export async function listConfiguredManagedMcpConnectors(
  credentialGroupId: string | undefined,
  scope: ResourceScope
) {
  let hubspotReady = inspectConfiguredOAuthClient('hubspot-mcp').state === 'ready'
  if (!hubspotReady && credentialGroupId) {
    const [registration] = await db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.credentialGroupId, credentialGroupId),
          eq(mcpServers.managedConnectorId, 'hubspot'),
          eq(mcpServers.url, MANAGED_MCP_CONNECTORS.hubspot.url),
          eq(mcpServers.authType, 'oauth'),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt),
          isNotNull(mcpServers.oauthClientId),
          ne(mcpServers.oauthClientId, ''),
          isNotNull(mcpServers.oauthClientSecret),
          ne(mcpServers.oauthClientSecret, '')
        )
      )
      .limit(1)
    hubspotReady = Boolean(registration)
  }
  const zoomReady =
    inspectConfiguredOAuthClient('zoom-mcp').state === 'ready' &&
    (await isSearchProviderEnabled('zoom', scope))
  return MANAGED_MCP_CONNECTOR_IDS.filter(
    (id) => (id !== 'hubspot' || hubspotReady) && (id !== 'zoom' || zoomReady)
  )
}
