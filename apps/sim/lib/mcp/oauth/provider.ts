import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import { mcpServers } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { MANAGED_MCP_CONNECTORS } from '@/lib/credential-groups/managed-mcp-connectors'
import { getSharedHubSpotMcpClient, getSharedZoomMcpClient } from '@/lib/mcp/oauth/shared-clients'
import {
  clearClient,
  clearState,
  clearTokens,
  clearVerifier,
  type McpOauthRow,
  saveClientInformation as saveClientInformationDb,
  saveCodeVerifier as saveCodeVerifierDb,
  saveState,
  saveTokens as saveTokensDb,
} from '@/lib/mcp/oauth/storage'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'

const logger = createLogger('SimMcpOauthProvider')

export class McpOauthRedirectRequired extends Error {
  constructor(public readonly authorizationUrl: string) {
    super('MCP OAuth redirect required')
    this.name = 'McpOauthRedirectRequired'
  }
}

export interface PreregisteredClient {
  clientId: string
  clientSecret?: string
  configurationFingerprint?: string
  scope?: string
  tokenEndpointAuthMethod?: 'client_secret_basic' | 'client_secret_post'
}

interface SimMcpOauthProviderInit {
  row: McpOauthRow
  scope?: string
  /**
   * Optional user-supplied client credentials. When provided, the SDK skips
   * Dynamic Client Registration and uses these for the auth/token exchange.
   */
  preregistered?: PreregisteredClient
}

export class SimMcpOauthProvider implements OAuthClientProvider {
  private row: McpOauthRow
  private readonly scope?: string
  private readonly preregistered?: PreregisteredClient

  constructor({ row, scope, preregistered }: SimMcpOauthProviderInit) {
    this.row = row
    this.scope = preregistered?.scope ?? scope
    this.preregistered = preregistered
  }

  /** Deployment registrations may restrict consent even when discovery advertises more tools. */
  get authorizationScope(): string | undefined {
    return this.preregistered?.scope
  }

  get redirectUrl(): string {
    return `${getBaseUrl().replace(/\/$/, '')}/api/mcp/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    const meta: OAuthClientMetadata = {
      client_name: 'Sim',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method:
        this.preregistered?.tokenEndpointAuthMethod ??
        (this.preregistered?.clientSecret ? 'client_secret_post' : 'none'),
    }
    if (this.scope) meta.scope = this.scope
    return meta
  }

  async state(): Promise<string> {
    const state = generateId()
    await saveState(this.row.id, state, 'provider.state')
    return state
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.row.clientInformation) return this.row.clientInformation
    if (this.preregistered) {
      return {
        client_id: this.preregistered.clientId,
        client_secret: this.preregistered.clientSecret,
        redirect_uris: [this.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method:
          this.preregistered.tokenEndpointAuthMethod ??
          (this.preregistered.clientSecret ? 'client_secret_post' : 'none'),
      }
    }
    return undefined
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    if (this.preregistered) return
    await saveClientInformationDb(this.row.id, info)
    this.row.clientInformation = info
  }

  tokens(): OAuthTokens | undefined {
    return this.row.tokens ?? undefined
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await saveTokensDb(this.row.id, tokens)
    this.row.tokens = tokens
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    throw new McpOauthRedirectRequired(authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await saveCodeVerifierDb(this.row.id, codeVerifier)
    this.row.codeVerifier = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this.row.codeVerifier) {
      throw new Error('No PKCE code verifier saved for this MCP OAuth session')
    }
    return this.row.codeVerifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      await clearClient(this.row.id)
      this.row.clientInformation = null
    }
    if (scope === 'all' || scope === 'tokens') {
      await clearTokens(this.row.id)
      this.row.tokens = null
    }
    if (scope === 'all' || scope === 'verifier') {
      await clearVerifier(this.row.id)
      await clearState(this.row.id, `invalidateCredentials:${scope}`)
      this.row.codeVerifier = null
    }
  }

  get rowId(): string {
    return this.row.id
  }
}

export async function loadPreregisteredClient(
  serverId: string
): Promise<PreregisteredClient | undefined> {
  const [row] = await db
    .select({
      clientId: mcpServers.oauthClientId,
      clientSecret: mcpServers.oauthClientSecret,
      connectorId: mcpServers.managedConnectorId,
      workspaceId: mcpServers.workspaceId,
      organizationId: mcpServers.organizationId,
      url: mcpServers.url,
      authType: mcpServers.authType,
      groupId: mcpServers.credentialGroupId,
      enabled: mcpServers.enabled,
      deletedAt: mcpServers.deletedAt,
    })
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .limit(1)
  if (!row) return undefined
  if (row.connectorId === 'zoom') {
    if (
      row.url !== MANAGED_MCP_CONNECTORS.zoom.url ||
      row.authType !== 'oauth' ||
      !row.groupId ||
      !row.enabled ||
      row.deletedAt
    )
      return undefined
    if (!(await isSearchProviderEnabled('zoom', resourceScopeFromOwner(row))))
      throw new Error('Zoom Search is not available for this organization')
    if (row.clientId || row.clientSecret)
      throw new Error('Zoom Search uses the deployment OAuth registration')
    const shared = getSharedZoomMcpClient()
    if (!shared)
      throw new Error(
        'Zoom sign-in is not configured. Ask your Sim administrator to configure the Zoom MCP OAuth client.'
      )
    return shared
  }
  if (row.connectorId === 'hubspot') {
    if (
      row.url !== MANAGED_MCP_CONNECTORS.hubspot.url ||
      row.authType !== 'oauth' ||
      !row.groupId ||
      !row.enabled ||
      row.deletedAt
    )
      return undefined
    if (!row.clientId && !row.clientSecret) {
      const shared = getSharedHubSpotMcpClient()
      if (!shared)
        throw new Error(
          'HubSpot sign-in is not configured. Ask your Sim administrator to configure the HubSpot MCP OAuth client.'
        )
      return shared
    }
    if (!row.clientId || !row.clientSecret)
      throw new Error('HubSpot OAuth registration is incomplete')
  }
  if (!row.clientId) return undefined
  let clientSecret: string | undefined
  if (row.clientSecret) {
    try {
      const { decrypted } = await decryptSecret(row.clientSecret)
      clientSecret = decrypted
    } catch (error) {
      logger.error('Failed to decrypt preregistered MCP OAuth client secret', {
        serverId,
        error: toError(error).message,
      })
      throw new Error('Failed to decrypt preregistered MCP OAuth client secret')
    }
  }
  return { clientId: row.clientId, clientSecret }
}
