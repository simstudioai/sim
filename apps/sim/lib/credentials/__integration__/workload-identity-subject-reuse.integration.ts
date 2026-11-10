/**
 * A keyless trust setup (subject plus its day-long proof) binds to one live
 * credential: saving it onto a second credential is refused, even concurrently,
 * while the credential that holds it can still be reconnected.
 */

import { db } from '@sim/db'
import { credential, credentialMember, permissions, user, workspace } from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { jsonResponse } from '@sim/testing/helpers/http'
import { posthogServerMock } from '@sim/testing/mocks/posthog-server.mock'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/posthog/server', () => posthogServerMock)
vi.mock('@/lib/credentials/workload-identity/issuer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/credentials/workload-identity/issuer')>()),
  mintWorkloadIdentityToken: async ({ subject }: { subject: string }) => `token-for:${subject}`,
}))

import { updateCredentialRecord } from '@/lib/credentials/orchestration'
import { createCredentialRecord } from '@/lib/credentials/orchestration/credential-create'
import { issueWorkloadIdentitySubject } from '@/lib/credentials/workload-identity/subject'
import { DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'

const HOST = 'dbc-1234abcd-5678.cloud.databricks.com'
const CLIENT_ID = '00000000-0000-0000-0000-000000000000'
const userId = generateId()
const workspaceId = generateId()
const owner = { workspaceId }
const originalFetch = globalThis.fetch

/** Subjects the fixture service principal's federation policy pins. */
const pinnedSubjects = new Set<string>()

function grant() {
  const issued = issueWorkloadIdentitySubject('databricks', owner, userId)
  pinnedSubjects.add(issued.subject)
  return issued
}

function keyless(subject?: { subject: string; subjectProof: string }) {
  return JSON.stringify({
    authType: 'oidc_federation',
    host: HOST,
    clientId: CLIENT_ID,
    ...(subject ? { subject: subject.subject, subjectProof: subject.subjectProof } : {}),
  })
}

function create(displayName: string, serviceAccountJson: string) {
  return createCredentialRecord(
    {
      workspaceId,
      type: 'service_account',
      userId,
      providerId: DATABRICKS_SERVICE_ACCOUNT_PROVIDER_ID,
      displayName,
      serviceAccountJson,
    },
    { authorizeWorkspace: true }
  )
}

async function reconnect(credentialId: string, serviceAccountJson: string) {
  const [row] = await db.select().from(credential).where(eq(credential.id, credentialId))
  return updateCredentialRecord({
    credentialId,
    credential: row,
    actorUserId: userId,
    serviceAccountJson,
  })
}

describe('reusing a keyless trust setup', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values({
      id: userId,
      name: 'Subject reuse fixture',
      email: `${userId}@subject-reuse.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await insertWorkspaceFixture(db, {
      id: workspaceId,
      name: 'Subject reuse fixture',
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

    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input.url
      if (target === `https://${HOST}/oidc/v1/token`) {
        const subjectToken = new URLSearchParams(String(init?.body)).get('subject_token') ?? ''
        const subject = subjectToken.replace(/^token-for:/, '')
        return pinnedSubjects.has(subject)
          ? jsonResponse({ access_token: `access-for:${subject}` })
          : jsonResponse({ error: 'invalid_client' }, 401)
      }
      if (target === `https://${HOST}/api/2.0/preview/scim/v2/Me`) {
        return jsonResponse({ userName: 'service-principal@example.com' })
      }
      return originalFetch(input, init)
    })
  }, 60_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await db.delete(credential).where(eq(credential.workspaceId, workspaceId))
    await deleteWorkspaceFixture(db, eq(workspace.id, workspaceId))
    await db.delete(user).where(eq(user.id, userId))
  })

  it('refuses a second credential with a subject another credential holds', async () => {
    const setup = grant()
    const first = await create('Lakehouse', keyless(setup))
    expect(first.success).toBe(true)

    const second = await create('Lakehouse again', keyless(setup))

    expect(second).toMatchObject({ success: false, errorCode: 'conflict' })
    const rows = await db
      .select({ id: credential.id })
      .from(credential)
      .where(eq(credential.workspaceId, workspaceId))
    expect(rows.map((row) => row.id)).toEqual([first.credential?.id])
  })

  it('refuses reconnecting another credential onto a subject that is held', async () => {
    const held = grant()
    expect((await create('Held', keyless(held))).success).toBe(true)
    const other = await create('Other', keyless(grant()))
    const otherId = other.credential?.id ?? ''

    const result = await reconnect(otherId, keyless(held))

    expect(result).toMatchObject({ success: false, errorCode: 'conflict' })
  })

  it('lets the holding credential reconnect with the subject it already has', async () => {
    const setup = grant()
    const created = await create('Reconnects', keyless(setup))
    const credentialId = created.credential?.id ?? ''

    expect((await reconnect(credentialId, keyless())).success).toBe(true)
    expect((await reconnect(credentialId, keyless(setup))).success).toBe(true)
  })

  it('lets only one of two concurrent creates of one subject through', async () => {
    const setup = grant()

    const results = await Promise.all([
      create('Racer one', keyless(setup)),
      create('Racer two', keyless(setup)),
    ])

    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.filter((result) => result.errorCode === 'conflict')).toHaveLength(1)
  })

  it('lets only one of two concurrent reconnects onto one subject through', async () => {
    const first = await create('Reconnect racer one', keyless(grant()))
    const second = await create('Reconnect racer two', keyless(grant()))
    const setup = grant()

    const results = await Promise.all([
      reconnect(first.credential?.id ?? '', keyless(setup)),
      reconnect(second.credential?.id ?? '', keyless(setup)),
    ])

    expect(results.filter((result) => result.success)).toHaveLength(1)
    expect(results.filter((result) => result.errorCode === 'conflict')).toHaveLength(1)
  })

  it('frees the subject once the credential holding it is deleted', async () => {
    const setup = grant()
    const created = await create('Deleted holder', keyless(setup))
    const credentialId = created.credential?.id ?? ''
    await db.delete(credentialMember).where(eq(credentialMember.credentialId, credentialId))
    await db.delete(credential).where(eq(credential.id, credentialId))

    expect((await create('Successor', keyless(setup))).success).toBe(true)
  })
})
