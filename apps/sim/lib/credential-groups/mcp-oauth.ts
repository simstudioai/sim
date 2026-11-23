import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import { credential } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import type { CredentialGroupMcpOAuthContext } from '@/lib/credential-groups/enrollments'
import { managedMcpAccountIdentityCall } from '@/lib/credential-groups/managed-mcp-connectors'
import {
  type ManagedMcpAccountIdentity,
  readManagedMcpAccountIdentity,
} from '@/lib/credential-groups/mcp-account-identity'
import { createCredentialGroupMcpOAuthAttempt } from '@/lib/credential-groups/mcp-oauth-state'
import type { CredentialGroupConnectionIntent } from '@/lib/credential-groups/oauth-intent'
import {
  encryptManagedMcpTokens,
  loadScopedManagedMcpRuntimeCredential,
  persistManagedMcpCredential,
  recordManagedMcpAccountIdentity,
} from '@/lib/credentials/managed-mcp'
import { createManagedMcpAuthProvider } from '@/lib/mcp/application/managed-auth-provider'
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
import { toManagedMcpToolSnapshots } from '@/lib/mcp/tool-snapshot'

const logger = createLogger('CredentialGroupMcpOAuth')

export async function startCredentialGroupMcpOAuth(
  context: CredentialGroupMcpOAuthContext,
  invitationToken: string,
  completion: {
    completionId?: string
    returnTo?: 'integrations'
    connectionIntent?: CredentialGroupConnectionIntent
  } = {}
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
        configurationFingerprint: preregistered?.configurationFingerprint,
        ...attempt,
        userId: context.userId,
        ...resourceScopeFields(resourceScopeFromOwner(context)),
        email: context.email,
        enrollmentId: context.enrollmentId,
        credentialGroupId: context.credentialGroupId,
        mcpServerId: context.server.id,
        invitationToken,
        ...completion,
      })
      return error.authorizationUrl
    }
  })
}

/**
 * Identifies this person's connections made before accounts were identified, through their stored
 * tokens, so adding another account does not first require reconnecting them. A connection whose
 * tokens no longer work stays unidentified, and the add is then refused with a reconnect prompt.
 */
export async function identifyStoredManagedMcpConnections({
  organizationId,
  workspaceId,
  enrollmentId,
  server,
}: {
  organizationId?: string
  workspaceId?: string
  enrollmentId: string
  server: { id: string; connectorId: string }
}) {
  const identityCall = managedMcpAccountIdentityCall(server.connectorId)
  if (!identityCall) return
  const scope = resourceScopeFromOwner({ organizationId, workspaceId })
  const unidentified = await db
    .select({ id: credential.id })
    .from(credential)
    .where(
      and(
        eq(credential.type, 'managed_mcp'),
        eq(credential.credentialGroupEnrollmentId, enrollmentId),
        eq(credential.mcpServerId, server.id),
        isNull(credential.providerSubjectId),
        isNull(credential.revokedAt)
      )
    )
  for (const { id } of unidentified) {
    try {
      const runtime = await loadScopedManagedMcpRuntimeCredential(id, scope)
      const identity = readManagedMcpAccountIdentity(
        server.connectorId,
        await mcpService.executeManagedMcpTool({
          connectionId: id,
          serverId: server.id,
          scope,
          toolCall: identityCall,
          loadAuthProvider: () => createManagedMcpAuthProvider(runtime),
        })
      )
      if (identity) await recordManagedMcpAccountIdentity(id, identity)
    } catch (error) {
      logger.warn('Could not identify a stored managed MCP connection', {
        connectorId: server.connectorId,
        error: getErrorMessage(error),
      })
    }
  }
}

export async function completeCredentialGroupMcpOAuth(
  context: CredentialGroupMcpOAuthContext,
  codeVerifier: string,
  authorizationCode: string,
  invitationToken: string,
  expectedConfigurationFingerprint?: string,
  connectionIntent?: CredentialGroupConnectionIntent
) {
  assertSafeOauthServerUrl(context.server.url)
  const clientRow = await getOrCreateOauthRow({
    mcpServerId: context.server.id,
    ...resourceScopeFields(resourceScopeFromOwner(context)),
  })
  const preregistered = await loadPreregisteredClient(context.server.id)
  if (expectedConfigurationFingerprint !== preregistered?.configurationFingerprint)
    throw new OrchestrationError('conflict', 'MCP setup changed. Start authorization again.')
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
  const identityCall = managedMcpAccountIdentityCall(context.server.connectorId)
  let identity: ManagedMcpAccountIdentity | null = null
  if (identityCall && tools.some((tool) => tool.name === identityCall.name)) {
    try {
      identity = readManagedMcpAccountIdentity(
        context.server.connectorId,
        await mcpService.callManagedMcpToolWithGrant(
          context.server.id,
          resourceScopeFromOwner(context),
          provider,
          identityCall
        )
      )
    } catch (error) {
      logger.warn('Could not identify the connected managed MCP account', {
        connectorId: context.server.connectorId,
        error: getErrorMessage(error),
      })
    }
  }
  if (identity && connectionIntent?.kind === 'create')
    await identifyStoredManagedMcpConnections({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      enrollmentId: context.enrollmentId,
      server: context.server,
    })
  const completion = await persistManagedMcpCredential({
    invitationTokenHash: sha256Hex(invitationToken),
    oauthConfigVersion: context.server.oauthConfigVersion,
    configurationFingerprint: preregistered?.configurationFingerprint,
    enrollmentId: context.enrollmentId,
    credentialGroupId: context.credentialGroupId,
    email: context.email,
    userId: context.userId,
    ...resourceScopeFields(resourceScopeFromOwner(context)),
    mcpServerId: context.server.id,
    mcpServerName: context.server.name,
    tokens: grantedTokens,
    tools: toManagedMcpToolSnapshots(tools),
    identity,
    connectionIntent,
  })
  return { ...completion, mcpServerId: context.server.id }
}
