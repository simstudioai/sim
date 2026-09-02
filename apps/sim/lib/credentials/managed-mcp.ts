import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  type ManagedMcpToolSnapshot,
  mcpServers,
} from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { getWorkspaceOwnerSubscriptionAccess } from '@/lib/billing/core/workspace-access'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { isCredentialGroupsAvailable } from '@/lib/credential-groups/availability'
import { lockCredentialGroupEnrollmentLifecycle } from '@/lib/credential-groups/enrollments'
import { getManagedMcpConnector } from '@/lib/credential-groups/managed-mcp-connectors'
import { generateManagedMcpConnectionId } from '@/lib/mcp/utils'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const MANAGED_MCP_TOKEN_SET_TYPE = 'managed-mcp-oauth-token-set' as const
const MANAGED_MCP_TOKEN_SET_VERSION = 1 as const

interface ManagedMcpTokenEnvelope {
  type: typeof MANAGED_MCP_TOKEN_SET_TYPE
  version: typeof MANAGED_MCP_TOKEN_SET_VERSION
  tokens: OAuthTokens
}

export interface ManagedMcpCredentialApplicationContext extends WorkspaceAuthorizationContext {
  credentialId: string
  credentialGroupId: string
  credentialGroupEnrollmentId: string
  mcpServerId: string
  mcpServerName: string
}

export interface ManagedMcpRuntimeCredential {
  credentialId: string
  mcpServerId: string
  mcpServerName: string
  workspaceId: string
  tokenVersion: string
  tokens: OAuthTokens
  tools: ManagedMcpToolSnapshot[]
}

export class ManagedMcpCredentialError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403 | 404 | 500
  ) {
    super(message)
    this.name = 'ManagedMcpCredentialError'
  }
}

function isOAuthTokens(value: unknown): value is OAuthTokens {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.access_token === 'string' &&
    candidate.access_token.length > 0 &&
    (candidate.refresh_token === undefined || typeof candidate.refresh_token === 'string') &&
    (candidate.token_type === undefined || typeof candidate.token_type === 'string') &&
    (candidate.expires_in === undefined || typeof candidate.expires_in === 'number')
  )
}

export async function encryptManagedMcpTokens(tokens: OAuthTokens): Promise<string> {
  if (!isOAuthTokens(tokens)) throw new ManagedMcpCredentialError('Invalid MCP OAuth tokens', 500)
  const envelope: ManagedMcpTokenEnvelope = {
    type: MANAGED_MCP_TOKEN_SET_TYPE,
    version: MANAGED_MCP_TOKEN_SET_VERSION,
    tokens,
  }
  return (await encryptSecret(JSON.stringify(envelope))).encrypted
}

export async function decryptManagedMcpTokens(encrypted: string): Promise<OAuthTokens> {
  try {
    const { decrypted } = await decryptSecret(encrypted)
    const parsed: unknown = JSON.parse(decrypted)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid token envelope')
    const envelope = parsed as Record<string, unknown>
    if (
      envelope.type !== MANAGED_MCP_TOKEN_SET_TYPE ||
      envelope.version !== MANAGED_MCP_TOKEN_SET_VERSION ||
      !isOAuthTokens(envelope.tokens)
    ) {
      throw new Error('Invalid token envelope')
    }
    return envelope.tokens
  } catch (error) {
    throw new ManagedMcpCredentialError(
      `Managed MCP credential token data is invalid: ${getErrorMessage(error)}`,
      500
    )
  }
}

export async function loadManagedMcpCredentialApplicationContext(
  credentialId: string
): Promise<ManagedMcpCredentialApplicationContext | null> {
  const [row] = await db
    .select({
      credentialId: credential.id,
      workspaceId: credential.workspaceId,
      credentialGroupId: credentialGroup.id,
      credentialGroupEnrollmentId: credentialGroupEnrollment.id,
      mcpServerId: mcpServers.id,
      mcpServerName: mcpServers.name,
      managedConnectorId: mcpServers.managedConnectorId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
    .where(and(eq(credential.id, credentialId), eq(credential.type, 'managed_mcp')))
    .limit(1)
  if (!row) return null
  if (!row.managedConnectorId) {
    throw new Error(`Managed MCP server ${row.mcpServerId} has no connector ID`)
  }
  getManagedMcpConnector(row.managedConnectorId)
  const workspaceContext = await loadActiveWorkspaceApplicationContext(row.workspaceId)
  return workspaceContext ? { ...workspaceContext, ...row } : null
}

export async function loadManagedMcpRuntimeCredential(
  credentialId: string,
  workspaceId: string
): Promise<ManagedMcpRuntimeCredential> {
  const ownerBilling = await getWorkspaceOwnerSubscriptionAccess(workspaceId)
  if (!(await isCredentialGroupsAvailable({ workspaceId, ownerBilling }))) {
    throw new ManagedMcpCredentialError(
      'Managed MCP credentials are not available for this workspace',
      403
    )
  }

  const [row] = await db
    .select({
      credentialId: credential.id,
      workspaceId: credential.workspaceId,
      status: credential.managedOauthStatus,
      encryptedTokens: credential.encryptedOauthTokenSet,
      tools: credential.mcpTools,
      enrollmentStatus: credentialGroupEnrollment.status,
      groupStatus: credentialGroup.status,
      credentialGroupId: credentialGroup.id,
      linkedCredentialGroupId: mcpServers.credentialGroupId,
      mcpServerId: mcpServers.id,
      mcpServerName: mcpServers.name,
      managedConnectorId: mcpServers.managedConnectorId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .innerJoin(mcpServers, eq(mcpServers.id, credential.mcpServerId))
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.workspaceId, workspaceId),
        eq(credential.type, 'managed_mcp'),
        eq(mcpServers.workspaceId, workspaceId),
        eq(mcpServers.authType, 'oauth'),
        eq(mcpServers.enabled, true),
        isNull(mcpServers.deletedAt)
      )
    )
    .limit(1)
  if (!row) throw new ManagedMcpCredentialError('Managed MCP credential not found', 404)
  if (!row.managedConnectorId) {
    throw new ManagedMcpCredentialError('Managed MCP connector metadata is missing', 500)
  }
  getManagedMcpConnector(row.managedConnectorId)
  if (
    row.status !== 'active' ||
    row.groupStatus !== 'active' ||
    !['in_progress', 'completed'].includes(row.enrollmentStatus) ||
    row.linkedCredentialGroupId !== row.credentialGroupId
  ) {
    throw new ManagedMcpCredentialError('Managed MCP credential needs authorization', 401)
  }
  if (!row.encryptedTokens) {
    throw new ManagedMcpCredentialError('Managed MCP credential token data is missing', 500)
  }
  if (!row.tools) throw new ManagedMcpCredentialError('Managed MCP tool metadata is missing', 500)
  return {
    credentialId: row.credentialId,
    workspaceId: row.workspaceId,
    mcpServerId: row.mcpServerId,
    mcpServerName: row.mcpServerName,
    tokenVersion: row.encryptedTokens,
    tokens: await decryptManagedMcpTokens(row.encryptedTokens),
    tools: row.tools,
  }
}

export async function persistManagedMcpCredential(params: {
  enrollmentId: string
  workspaceId: string
  mcpServerId: string
  mcpServerName: string
  tokens: OAuthTokens
  tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>
}): Promise<string> {
  const encryptedOauthTokenSet = await encryptManagedMcpTokens(params.tokens)
  const now = new Date()
  const accessTokenExpiresAt =
    typeof params.tokens.expires_in === 'number'
      ? new Date(now.getTime() + params.tokens.expires_in * 1000)
      : null
  return db.transaction(async (tx) => {
    await lockCredentialGroupEnrollmentLifecycle(tx, params.enrollmentId)
    const [source] = await tx
      .select({
        enrollmentStatus: credentialGroupEnrollment.status,
        credentialGroupId: credentialGroupEnrollment.credentialGroupId,
        groupStatus: credentialGroup.status,
        linkedCredentialGroupId: mcpServers.credentialGroupId,
        managedConnectorId: mcpServers.managedConnectorId,
      })
      .from(credentialGroupEnrollment)
      .innerJoin(
        credentialGroup,
        eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId)
      )
      .innerJoin(mcpServers, eq(mcpServers.id, params.mcpServerId))
      .where(
        and(
          eq(credentialGroupEnrollment.id, params.enrollmentId),
          eq(credentialGroup.workspaceId, params.workspaceId),
          eq(mcpServers.workspaceId, params.workspaceId),
          eq(mcpServers.authType, 'oauth'),
          eq(mcpServers.enabled, true),
          isNull(mcpServers.deletedAt)
        )
      )
      .limit(1)
      .for('update')
    if (
      !source ||
      !source.managedConnectorId ||
      source.groupStatus !== 'active' ||
      !['invited', 'in_progress', 'completed'].includes(source.enrollmentStatus) ||
      source.linkedCredentialGroupId !== source.credentialGroupId
    ) {
      throw new ManagedMcpCredentialError('Managed MCP connection is no longer available', 404)
    }
    getManagedMcpConnector(source.managedConnectorId)

    const [existing] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.type, 'managed_mcp'),
          eq(credential.credentialGroupEnrollmentId, params.enrollmentId),
          eq(credential.mcpServerId, params.mcpServerId)
        )
      )
      .limit(1)
      .for('update')
    const values = {
      displayName: params.mcpServerName,
      managedOauthStatus: 'active' as const,
      encryptedOauthTokenSet,
      accessTokenExpiresAt,
      mcpTools: params.tools,
      mcpToolsRefreshedAt: now,
      grantedAt: now,
      revokedAt: null,
      updatedAt: now,
    }
    let connectionId: string
    if (existing) {
      const [updated] = await tx
        .update(credential)
        .set(values)
        .where(and(eq(credential.id, existing.id), eq(credential.type, 'managed_mcp')))
        .returning({ id: credential.id })
      if (!updated) throw new Error('Managed MCP credential update returned no row')
      connectionId = updated.id
    } else {
      const id = generateManagedMcpConnectionId()
      const insert: typeof credential.$inferInsert = {
        id,
        workspaceId: params.workspaceId,
        type: 'managed_mcp',
        createdBy: null,
        credentialGroupEnrollmentId: params.enrollmentId,
        mcpServerId: params.mcpServerId,
        ...values,
        createdAt: now,
      }
      const [created] = await tx.insert(credential).values(insert).returning({ id: credential.id })
      if (!created) throw new Error('Managed MCP credential insert returned no row')
      connectionId = created.id
    }

    const [updatedEnrollment] = await tx
      .update(credentialGroupEnrollment)
      .set({
        status: source.enrollmentStatus === 'completed' ? 'completed' : 'in_progress',
        ...(source.enrollmentStatus === 'completed' ? {} : { completedAt: null }),
        updatedAt: now,
      })
      .where(
        and(
          eq(credentialGroupEnrollment.id, params.enrollmentId),
          ne(credentialGroupEnrollment.status, 'revoked')
        )
      )
      .returning({ id: credentialGroupEnrollment.id })
    if (!updatedEnrollment) {
      throw new ManagedMcpCredentialError('Managed MCP enrollment is no longer available', 404)
    }
    return connectionId
  })
}

export async function saveManagedMcpRuntimeTokens(
  credentialId: string,
  tokens: OAuthTokens | null,
  expectedTokenVersion: string
): Promise<string | null> {
  const now = new Date()
  const encryptedOauthTokenSet = tokens ? await encryptManagedMcpTokens(tokens) : null
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ enrollmentId: credential.credentialGroupEnrollmentId })
      .from(credential)
      .where(and(eq(credential.id, credentialId), eq(credential.type, 'managed_mcp')))
      .limit(1)
    if (!source?.enrollmentId) {
      throw new ManagedMcpCredentialError('Managed MCP credential is no longer active', 401)
    }
    await lockCredentialGroupEnrollmentLifecycle(tx, source.enrollmentId)
    const updated = await tx
      .update(credential)
      .set(
        tokens
          ? {
              encryptedOauthTokenSet,
              managedOauthStatus: 'active',
              accessTokenExpiresAt:
                typeof tokens.expires_in === 'number'
                  ? new Date(now.getTime() + tokens.expires_in * 1000)
                  : null,
              updatedAt: now,
            }
          : {
              encryptedOauthTokenSet: null,
              managedOauthStatus: 'needs_reauth',
              accessTokenExpiresAt: null,
              updatedAt: now,
            }
      )
      .where(
        and(
          eq(credential.id, credentialId),
          eq(credential.type, 'managed_mcp'),
          eq(credential.managedOauthStatus, 'active'),
          eq(credential.encryptedOauthTokenSet, expectedTokenVersion)
        )
      )
      .returning({ id: credential.id })
    if (updated.length !== 1) {
      throw new ManagedMcpCredentialError('Managed MCP credential grant changed', 401)
    }
    return encryptedOauthTokenSet
  })
}

/** Replaces the editor snapshot only after a complete live tools/list succeeds. */
export async function saveManagedMcpToolSnapshot(
  credentialId: string,
  tools: ManagedMcpToolSnapshot[]
): Promise<void> {
  const updated = await db
    .update(credential)
    .set({ mcpTools: tools, mcpToolsRefreshedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(credential.id, credentialId),
        eq(credential.type, 'managed_mcp'),
        eq(credential.managedOauthStatus, 'active')
      )
    )
    .returning({ id: credential.id })
  if (updated.length !== 1) {
    throw new ManagedMcpCredentialError('Managed MCP credential grant changed', 401)
  }
}
