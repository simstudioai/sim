/** Chat's in-process CLI reaching selectors whose options are owned by another domain. */

import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  mcpServers,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withWorkspaceInvocationScope } from '@/lib/core/application/workspace-invocation-scope'
import { ensureWorkspaceAccountsGroup } from '@/lib/credential-groups/service'
import { encryptManagedMcpTokens } from '@/lib/credentials/managed-mcp'
import { generateManagedMcpConnectionId } from '@/lib/mcp/utils'
import { createScopedCliTransport } from '@/lib/mothership/agent-cli/scoped-transport'

const ORIGIN = 'http://localhost:3000'
const userId = generateId()
const workspaceId = generateId()
const connectionId = generateManagedMcpConnectionId()

function listSelector(selectorKey: string, context: Record<string, string>) {
  const transport = createScopedCliTransport(ORIGIN, { userId, workspaceId, chatId: generateId() })
  return withWorkspaceInvocationScope({ workspaceId }, () =>
    transport(`${ORIGIN}/api/v2/selectors/list`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceId, selectorKey, context }),
    })
  )
}

describe('Copilot selectors backed by another domain', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Selector fixture',
      email: `${userId}@selector.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(workspace).values({
      id: workspaceId,
      name: 'Selector fixture',
      ownerId: userId,
      billedAccountUserId: userId,
    })
    await db.insert(permissions).values({
      id: generateId(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
    })
    const group = await ensureWorkspaceAccountsGroup(workspaceId, userId)
    const serverId = generateId()
    await db.insert(mcpServers).values({
      id: serverId,
      workspaceId,
      credentialGroupId: group.id,
      managedConnectorId: 'notion',
      name: 'Notion',
      transport: 'streamable-http',
      url: 'https://mcp.notion.com/mcp',
      authType: 'oauth',
      createdBy: userId,
    })
    const enrollmentId = generateId()
    await db.insert(credentialGroupEnrollment).values({
      id: enrollmentId,
      credentialGroupId: group.id,
      userId,
      email: `${userId}@selector.test`,
      status: 'completed',
      invitationTokenHash: sha256Hex(generateId()),
      invitationExpiresAt: new Date(Date.now() + 60_000),
      invitedAt: now,
    })
    await db.insert(credential).values({
      id: connectionId,
      workspaceId,
      type: 'managed_mcp',
      displayName: 'Notion',
      grantedAt: now,
      mcpTools: [],
      credentialGroupEnrollmentId: enrollmentId,
      mcpServerId: serverId,
      managedOauthStatus: 'active',
      encryptedOauthTokenSet: await encryptManagedMcpTokens({
        access_token: 'fixture-access',
        token_type: 'Bearer',
      }),
    })
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
    await db.$client.end()
  })

  it('decides a managed MCP connection by its credential-group rule instead of concealing it', async () => {
    const response = await listSelector('mcp.tools', { mcpServerId: connectionId })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(403)
    expect(body.error.message).toBe('Credential Group credential access denied')
  })
})
