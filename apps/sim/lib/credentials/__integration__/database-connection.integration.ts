/**
 * A saved PostgreSQL connection end to end against a real server: saving
 * proves the login with SELECT 1 through the PostgreSQL tools' own guarded
 * connection path, and a run through the registered tool operation reads the
 * stored connection, bound to the run's workspace, whatever connection fields the
 * call carries.
 */

import { db } from '@sim/db'
import { credential, permissions, user, workspace } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)

import { env } from '@/lib/core/config/env'
import { createCredentialRecord } from '@/lib/credentials/orchestration/credential-create'
import { getInternalToolOperationHandler } from '@/lib/internal/tool-operations/registry.server'
import { POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const databaseUrl = new URL(readTestDatabaseUrl())
const connection = {
  host: '127.0.0.1',
  port: Number(databaseUrl.port || 5432),
  database: decodeURIComponent(databaseUrl.pathname.slice(1)),
  username: decodeURIComponent(databaseUrl.username),
  // The disposable server trusts loopback logins, so any non-empty password is accepted.
  password: decodeURIComponent(databaseUrl.password) || 'unused-under-trust-auth',
  ssl: 'disabled',
}
const userId = generateId()
const workspaceId = generateId()
const otherWorkspaceId = generateId()

function save(displayName: string, serviceAccountJson: string) {
  return createCredentialRecord(
    {
      workspaceId,
      type: 'service_account',
      userId,
      providerId: POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
      displayName,
      serviceAccountJson,
    },
    { authorizeWorkspace: true }
  )
}

async function run(credentialId: string, runWorkspaceId: string) {
  const handler = await getInternalToolOperationHandler('postgresql_query')
  if (!handler) throw new Error('postgresql_query has no registered operation')
  const result = await handler({
    toolId: 'postgresql_query',
    input: {
      host: 'unreachable.invalid',
      port: 1,
      database: 'other',
      username: 'other',
      password: 'inline',
      ssl: 'required',
      query: 'SELECT current_user AS who, current_database() AS db',
    },
    headers: new Headers(),
    context: {
      workflowId: generateId(),
      workspaceId: runWorkspaceId,
      authorizedServiceAccountCredential: { credentialId, service: 'postgresql' },
    },
    requestId: generateId(),
  })
  if (!(result instanceof Response)) throw new Error('postgresql_query returned a file')
  return result
}

describe('saved PostgreSQL connection', () => {
  let credentialId: string

  beforeAll(async () => {
    Object.assign(env, { EGRESS_ALLOWED_HOSTS: '127.0.0.1' })
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Database connection fixture',
      email: `${userId}@database-connection.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    for (const id of [workspaceId, otherWorkspaceId]) {
      await insertWorkspaceFixture(db, {
        id,
        name: 'Database connection fixture',
        ownerId: userId,
        billedAccountUserId: userId,
      })
      await db.insert(permissions).values({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId: id,
        permissionType: 'admin',
      })
    }
  }, 60_000)

  afterAll(async () => {
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('saves a connection the server accepts', async () => {
    const result = await save('Primary database', JSON.stringify(connection))

    expect(result).toMatchObject({ success: true })
    const [row] = await db
      .select()
      .from(credential)
      .where(eq(credential.displayName, 'Primary database'))
    expect(row).toMatchObject({
      type: 'service_account',
      providerId: POSTGRESQL_SERVICE_ACCOUNT_PROVIDER_ID,
      workspaceId,
    })
    expect(row.encryptedServiceAccountKey).not.toContain(connection.password)
    credentialId = row.id
  })

  it('refuses to save a connection the server rejects', async () => {
    const result = await save(
      'Missing database',
      JSON.stringify({ ...connection, database: `${connection.database}_missing` })
    )

    expect(result).toMatchObject({ success: false })
    const rows = await db
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.displayName, 'Missing database'))
    expect(rows).toHaveLength(0)
  })

  it('runs on the saved connection whatever connection fields the call carries', async () => {
    const response = await run(credentialId, workspaceId)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      rows: [{ who: connection.username, db: connection.database }],
    })
  })

  it('refuses the connection to a run in another workspace', async () => {
    const response = await run(credentialId, otherWorkspaceId)

    expect(response.status).toBe(403)
  })

  it('refuses a revoked connection', async () => {
    await db
      .update(credential)
      .set({ revokedAt: new Date() })
      .where(eq(credential.id, credentialId))

    const response = await run(credentialId, workspaceId)

    expect(response.status).toBe(403)
  })
})
