import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { sha256Hex } from '@sim/security/hash'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { CredentialGroupMcpOAuthContext } from '@/lib/credential-groups/enrollments'
import { createCredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import { encryptManagedMcpTokens, persistManagedMcpCredential } from '@/lib/credentials/managed-mcp'
import {
  assertSafeOauthServerUrl,
  getOrCreateOauthRow,
  loadPreregisteredClient,
  McpOauthRedirectRequired,
  mcpAuthGuarded,
  withMcpOauthRefreshLock,
} from '@/lib/mcp/oauth'
import { ManagedMcpOauthProvider } from '@/lib/mcp/oauth/managed-provider'
import { mcpService } from '@/lib/mcp/service'

export async function startCredentialGroupMcpOAuth(
  context: CredentialGroupMcpOAuthContext,
  invitationToken: string
): Promise<string> {
  assertSafeOauthServerUrl(context.server.url)
  return withMcpOauthRefreshLock(context.server.id, async () => {
    const clientRow = await getOrCreateOauthRow({
      mcpServerId: context.server.id,
      ...resourceScopeFields(resourceScopeFromOwner(context)),
    })
    const preregistered = await loadPreregisteredClient(context.server.id)
    const provider = new ManagedMcpOauthProvider({
      clientRow,
      preregistered,
      async onSaveTokens() {
        throw new Error('Managed MCP OAuth start cannot persist grant tokens')
      },
    })

    try {
      const result = await mcpAuthGuarded(provider, { serverUrl: context.server.url })
      if (result === 'AUTHORIZED') {
        throw new Error('Managed MCP OAuth unexpectedly authorized without an enrollment grant')
      }
      throw new Error('Managed MCP OAuth did not produce an authorization redirect')
    } catch (error) {
      if (!(error instanceof McpOauthRedirectRequired)) throw error
      const attempt = provider.requireAuthorizationAttempt()
      await createCredentialGroupMcpOAuthAttempt({
        oauthConfigVersion: context.server.oauthConfigVersion,
        ...attempt,
        userId: context.userId,
        ...resourceScopeFields(resourceScopeFromOwner(context)),
        email: context.email,
        enrollmentId: context.enrollmentId,
        credentialGroupId: context.credentialGroupId,
        mcpServerId: context.server.id,
        invitationToken,
      })
      return error.authorizationUrl
    }
  })
}

export async function completeCredentialGroupMcpOAuth(
  context: CredentialGroupMcpOAuthContext,
  codeVerifier: string,
  authorizationCode: string,
  invitationToken: string
) {
  assertSafeOauthServerUrl(context.server.url)
  const clientRow = await getOrCreateOauthRow({
    mcpServerId: context.server.id,
    ...resourceScopeFields(resourceScopeFromOwner(context)),
  })
  const preregistered = await loadPreregisteredClient(context.server.id)
  let grantedTokens: OAuthTokens | undefined
  const provider = new ManagedMcpOauthProvider({
    clientRow,
    preregistered,
    codeVerifier,
    async onSaveTokens(tokens) {
      if (!tokens) {
        grantedTokens = undefined
        return
      }
      await encryptManagedMcpTokens(tokens)
      grantedTokens = tokens
    },
  })
  const result = await mcpAuthGuarded(provider, {
    serverUrl: context.server.url,
    authorizationCode,
  })
  if (result !== 'AUTHORIZED' || !grantedTokens) {
    throw new Error('Managed MCP OAuth token exchange did not return usable tokens')
  }
  const tools = await mcpService.discoverManagedMcpTools(
    context.server.id,
    resourceScopeFromOwner(context),
    provider,
    undefined,
    { requireComplete: true }
  )
  const completion = await persistManagedMcpCredential({
    invitationTokenHash: sha256Hex(invitationToken),
    oauthConfigVersion: context.server.oauthConfigVersion,
    enrollmentId: context.enrollmentId,
    credentialGroupId: context.credentialGroupId,
    email: context.email,
    userId: context.userId,
    ...resourceScopeFields(resourceScopeFromOwner(context)),
    mcpServerId: context.server.id,
    mcpServerName: context.server.name,
    tokens: grantedTokens,
    tools: tools.map((tool) => ({
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    })),
  })
  return { ...completion, mcpServerId: context.server.id }
}
