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
import { decryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
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
    this.scope = scope
    this.preregistered = preregistered
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
      token_endpoint_auth_method: this.preregistered?.clientSecret ? 'client_secret_post' : 'none',
    }
    if (this.scope) meta.scope = this.scope
    return meta
  }

  async state(): Promise<string> {
    const state = generateId()
    await saveState(this.row.id, state)
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
        token_endpoint_auth_method: this.preregistered.clientSecret ? 'client_secret_post' : 'none',
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
      await clearState(this.row.id)
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
    })
    .from(mcpServers)
    .where(eq(mcpServers.id, serverId))
    .limit(1)
  if (!row?.clientId) return undefined
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
