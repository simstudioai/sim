import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { generateId } from '@sim/utils/id'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { McpOauthRedirectRequired, type PreregisteredClient } from '@/lib/mcp/oauth/provider'
import { clearClient, type McpOauthRow, saveClientInformation } from '@/lib/mcp/oauth/storage'

interface ManagedMcpOauthProviderInit {
  clientRow: McpOauthRow
  preregistered?: PreregisteredClient
  tokens?: OAuthTokens
  codeVerifier?: string
  onSaveTokens: (tokens: OAuthTokens | null) => Promise<void>
}

/** Shares server client registration while keeping grant tokens scoped to one enrollment. */
export class ManagedMcpOauthProvider implements OAuthClientProvider {
  private readonly clientRow: McpOauthRow
  private readonly preregistered?: PreregisteredClient
  private readonly onSaveTokens: (tokens: OAuthTokens | null) => Promise<void>
  private currentTokens?: OAuthTokens
  private currentState?: string
  private currentCodeVerifier?: string

  constructor({
    clientRow,
    preregistered,
    tokens,
    codeVerifier,
    onSaveTokens,
  }: ManagedMcpOauthProviderInit) {
    this.clientRow = clientRow
    this.preregistered = preregistered
    this.currentTokens = tokens
    this.currentCodeVerifier = codeVerifier
    this.onSaveTokens = onSaveTokens
  }

  get redirectUrl(): string {
    return `${getBaseUrl().replace(/\/$/, '')}/api/mcp/oauth/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Sim',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.preregistered?.clientSecret ? 'client_secret_post' : 'none',
    }
  }

  async state(): Promise<string> {
    this.currentState = `mcp_cg_${generateId()}`
    return this.currentState
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    if (this.clientRow.clientInformation) return this.clientRow.clientInformation
    if (!this.preregistered) return undefined
    return {
      client_id: this.preregistered.clientId,
      client_secret: this.preregistered.clientSecret,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: this.preregistered.clientSecret ? 'client_secret_post' : 'none',
    }
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    if (this.preregistered) return
    await saveClientInformation(this.clientRow.id, info)
    this.clientRow.clientInformation = info
  }

  tokens(): OAuthTokens | undefined {
    return this.currentTokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.onSaveTokens(tokens)
    this.currentTokens = tokens
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    throw new McpOauthRedirectRequired(authorizationUrl.toString())
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.currentCodeVerifier = codeVerifier
  }

  async codeVerifier(): Promise<string> {
    if (!this.currentCodeVerifier) {
      throw new Error('No PKCE code verifier saved for this managed MCP OAuth session')
    }
    return this.currentCodeVerifier
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'
  ): Promise<void> {
    if (scope === 'all' || scope === 'client') {
      await clearClient(this.clientRow.id)
      this.clientRow.clientInformation = null
    }
    if (scope === 'all' || scope === 'tokens') {
      await this.onSaveTokens(null)
      this.currentTokens = undefined
    }
    if (scope === 'all' || scope === 'verifier') {
      this.currentState = undefined
      this.currentCodeVerifier = undefined
    }
  }

  requireAuthorizationAttempt(): { state: string; codeVerifier: string } {
    if (!this.currentState || !this.currentCodeVerifier) {
      throw new Error('Managed MCP OAuth provider did not produce state and PKCE verifier')
    }
    return { state: this.currentState, codeVerifier: this.currentCodeVerifier }
  }
}
