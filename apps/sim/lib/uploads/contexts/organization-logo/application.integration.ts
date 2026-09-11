/** Real PostgreSQL verifies cross-session registration and durable logo retention. */
import { db } from '@sim/db'
import { withInsertColumns } from '@sim/db/insert-columns'
import { member, organization, organizationColumns, uploadSession } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  schema: '',
  connection: undefined as Sql | undefined,
  deleteObject: vi.fn(),
  headObject: vi.fn(),
}))

vi.mock('@sim/db', async () => {
  const { drizzle } = await import('drizzle-orm/postgres-js')
  const { default: postgres } = await import('postgres')
  const { withUtcTimestamps } = await import('@sim/db/timestamps')
  const { generateId } = await import('@sim/utils/id')
  fixture.schema = `logo_test_${generateId().replaceAll('-', '')}`
  fixture.connection = postgres(
    process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL!,
    withUtcTimestamps({
      max: 4,
      prepare: false,
      fetch_types: false,
      connection: { search_path: fixture.schema },
      onnotice: () => {},
    })
  )
  const database = drizzle(fixture.connection)
  return { db: database, dbFor: () => database }
})

vi.mock('@/lib/permission-groups/resolve.server', () => ({
  getUserPermissionConfigForOrganization: async () => null,
}))
vi.mock('@sim/audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sim/audit')>()),
  recordAudit: vi.fn(),
}))
vi.mock('@/lib/uploads/upload-session/cleanup', () => ({
  maybeCleanupLocalUploadArtifacts: async () => ({ scanned: 0, removed: 0 }),
}))
vi.mock('@/lib/uploads/upload-session/provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads/upload-session/provider')>()),
  createPutProviderTransfer: async () => ({
    method: 'put',
    url: 'http://localhost/upload',
    headers: {},
  }),
  headProviderObject: fixture.headObject,
  deleteProviderObjectVersion: fixture.deleteObject,
}))

import {
  createOrganizationLogoUpload,
  finalizeOrganizationLogoUpload,
} from '@/lib/uploads/contexts/organization-logo/application'
import { cleanupExpiredUploadSessions } from '@/lib/uploads/upload-session/service'

describe('organization logo concurrency and retention', () => {
  const organizationId = generateId()
  const principals = [
    { kind: 'session', userId: generateId(), sessionId: generateId() },
    { kind: 'session', userId: generateId(), sessionId: generateId() },
  ] as const
  const request = { headers: new Headers() }

  beforeAll(async () => {
    const connection = fixture.connection!
    await connection`CREATE SCHEMA ${connection(fixture.schema)}`
    for (const table of ['user', 'member', 'organization', 'upload_session']) {
      await connection`CREATE TABLE ${connection(table)} (LIKE ${connection(`public.${table}`)} INCLUDING ALL)`
    }
    await db.insert(withInsertColumns(organization, organizationColumns)).values({
      id: organizationId,
      name: 'Logo test organization',
      slug: generateId(),
      createdAt: new Date(),
    })
    await db.insert(member).values(
      principals.map((principal) => ({
        id: generateId(),
        organizationId,
        userId: principal.userId,
        role: 'admin',
      }))
    )
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.delete(uploadSession)
    await db.update(organization).set({ logo: null }).where(eq(organization.id, organizationId))
  })

  afterAll(async () => {
    const connection = fixture.connection
    if (!connection) return
    try {
      await connection`DROP SCHEMA ${connection(fixture.schema)} CASCADE`
    } finally {
      await connection.end()
    }
  })

  async function start(principal = principals[0]) {
    const session = await createOrganizationLogoUpload(principal, {
      organizationId,
      name: 'logo.png',
      contentType: 'image/png',
      size: 100,
      localOrigin: 'http://localhost',
    })
    await db
      .update(uploadSession)
      .set({ status: 'finalizing' })
      .where(eq(uploadSession.id, session.id))
    return session
  }

  async function currentLogo() {
    const [row] = await db
      .select({ logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, organizationId))
    return row.logo
  }

  it('rejects an older upload after a different administrator completes a newer one', async () => {
    const older = await start()
    const newer = await start(principals[1])
    const result = await finalizeOrganizationLogoUpload(principals[1], newer, request)
    await expect(
      finalizeOrganizationLogoUpload(principals[0], older, request)
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(await currentLogo()).toBe(result.value.path)
  })

  it('allows only one concurrent completion from the same starting logo', async () => {
    const sessions = await Promise.all(principals.map((principal) => start(principal)))
    const results = await Promise.allSettled(
      sessions.map((session, index) =>
        finalizeOrganizationLogoUpload(principals[index], session, request)
      )
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'conflict' })
  })

  it('retains the active logo and retries deletion of a replaced logo before purging its record', async () => {
    const first = await start()
    await finalizeOrganizationLogoUpload(principals[0], first, request)
    const second = await start(principals[1])
    const current = await finalizeOrganizationLogoUpload(principals[1], second, request)
    await finalizeOrganizationLogoUpload(principals[0], first, request)
    expect(await currentLogo()).toBe(current.value.path)
    await db.update(uploadSession).set({
      status: 'completed',
      completedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    })
    fixture.headObject.mockImplementation(async ({ key }: { key: string }) => {
      expect(key).toBe(first.finalKey)
      return {
        size: first.fileSize,
        contentType: first.contentType,
        uploadId: first.id,
        version: 'v1',
      }
    })
    fixture.deleteObject.mockRejectedValueOnce(new Error('Storage unavailable'))
    expect(await cleanupExpiredUploadSessions()).toEqual({ expired: 0, failed: 1, purged: 0 })
    expect(await db.select({ id: uploadSession.id }).from(uploadSession)).toHaveLength(2)
    fixture.deleteObject.mockResolvedValue(undefined)
    expect(await cleanupExpiredUploadSessions()).toEqual({ expired: 0, failed: 0, purged: 1 })
    expect(await db.select({ id: uploadSession.id }).from(uploadSession)).toEqual([
      { id: second.id },
    ])
    expect(await currentLogo()).toBe(current.value.path)
    expect(fixture.deleteObject).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: first.finalKey,
        context: 'organization-logos',
        version: 'v1',
      })
    )
  })
})
