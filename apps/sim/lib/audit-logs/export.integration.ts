import { authMock, authMockFns } from '@sim/testing/mocks/auth.mock'
import { envFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { generateId } from '@sim/utils/id'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/config/env-flags', () => envFlagsMock)

async function loadRuntime() {
  const [{ db }, schema, { eq, inArray, sql }, { GET }] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/app/api/audit-logs/export/route'),
  ])
  return { db, schema, eq, inArray, sql, GET }
}

describe('Organization audit CSV export in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  const organizationId = generateId()
  const adminId = generateId()
  const departedId = generateId()
  const eventId = generateId()

  beforeAll(async () => {
    runtime = await loadRuntime()
    setEnvFlags({ isAuditLogsEnabled: true, isBillingEnabled: false })
    const { db, schema } = runtime
    const now = new Date()
    await db.insert(schema.user).values(
      [adminId, departedId].map((id) => ({
        id,
        name: id,
        email: `${id}@audit-export.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await db.insert(schema.organization).values({
      id: organizationId,
      name: 'Audit export fixture',
      slug: organizationId,
      createdAt: now,
    })
    await db.insert(schema.member).values({
      id: generateId(),
      userId: adminId,
      organizationId,
      role: 'owner',
      createdAt: now,
    })
    await db.insert(schema.auditLog).values({
      id: eventId,
      actorId: departedId,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: { organizationId, changedFields: ['name'] },
      ipAddress: '203.0.113.20',
      userAgent: 'Audit export fixture',
      surface: 'web',
    })
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: adminId },
      session: { id: generateId() },
    })
  }, 30_000)

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.actorId, [adminId, departedId]))
    await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
    await db.delete(schema.user).where(inArray(schema.user.id, [adminId, departedId]))
  })

  it('includes departed actors and forensic identifiers, and records the export', async () => {
    const response = await runtime.GET(
      new NextRequest(
        `http://localhost:3000/api/audit-logs/export?organizationId=${organizationId}&includeDeparted=true&actorId=${departedId}`
      )
    )
    expect(response.status).toBe(200)
    const csv = await response.text()
    expect(csv).toContain(eventId)
    expect(csv).toContain(organizationId)
    expect(csv).toContain('203.0.113.20')
    expect(csv).toContain('changedFields')
    expect(response.headers.get('cache-control')).toBe('no-store')
    await vi.waitFor(async () => {
      const events = await runtime.db
        .select()
        .from(runtime.schema.auditLog)
        .where(runtime.eq(runtime.schema.auditLog.actorId, adminId))
      expect(events).toHaveLength(1)
      expect(events[0].action).toBe('audit_logs.exported')
      expect(events[0].metadata).toMatchObject({ organizationId, rowCount: 1, truncated: false })
    })
  })
  it('rejects workspace filters outside the authorized organization', async () => {
    const response = await runtime.GET(
      new NextRequest(
        `http://localhost:3000/api/audit-logs/export?organizationId=${organizationId}&workspaceId=${generateId()}`
      )
    )
    expect(response.status).toBe(400)
  })

  it('rejects a departed actor unless historical access was requested', async () => {
    const response = await runtime.GET(
      new NextRequest(
        `http://localhost:3000/api/audit-logs/export?organizationId=${organizationId}&actorId=${departedId}`
      )
    )
    expect(response.status).toBe(400)
  })

  it('bounds encoded CSV bytes and marks quote-heavy metadata as truncated', async () => {
    const { db, schema, eq } = runtime
    await db
      .update(schema.auditLog)
      .set({
        metadata: { organizationId, fixture: '"'.repeat(24_000_000) },
      })
      .where(eq(schema.auditLog.id, eventId))
    try {
      const response = await runtime.GET(
        new NextRequest(
          `http://localhost:3000/api/audit-logs/export?organizationId=${organizationId}&includeDeparted=true&actorId=${departedId}`
        )
      )
      expect(response.status).toBe(200)
      const csv = await response.arrayBuffer()
      expect(csv.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024)
      expect(response.headers.get('x-export-truncated')).toBe('1')
      expect(Buffer.from(csv).toString('utf8')).not.toContain(eventId)
    } finally {
      await db
        .update(schema.auditLog)
        .set({ metadata: { organizationId, changedFields: ['name'] } })
        .where(eq(schema.auditLog.id, eventId))
    }
  })

  it('keeps the valid prefix without decoding an oversized database record', async () => {
    const { db, schema, eq, sql } = runtime
    const prefixId = generateId()
    await db.insert(schema.auditLog).values({
      id: prefixId,
      actorId: departedId,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: { organizationId },
      createdAt: new Date(Date.now() + 1000),
    })
    await db
      .update(schema.auditLog)
      .set({
        metadata: sql`jsonb_build_object('organizationId', ${organizationId}::text, 'fixture', repeat('x', 70 * 1024 * 1024))`,
      })
      .where(eq(schema.auditLog.id, eventId))
    const parse = JSON.parse
    let largestDecodedValue = 0
    const decoding = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      largestDecodedValue = Math.max(largestDecodedValue, Buffer.byteLength(text, 'utf8'))
      return parse(text, reviver)
    })
    try {
      const response = await runtime.GET(
        new NextRequest(
          `http://localhost:3000/api/audit-logs/export?organizationId=${organizationId}&includeDeparted=true&actorId=${departedId}`
        )
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('x-export-truncated')).toBe('1')
      const csv = await response.text()
      expect(csv).toContain(prefixId)
      expect(csv).not.toContain(eventId)
      expect(largestDecodedValue).toBeLessThanOrEqual(64 * 1024 * 1024)
    } finally {
      decoding.mockRestore()
      await db.delete(schema.auditLog).where(eq(schema.auditLog.id, prefixId))
      await db
        .update(schema.auditLog)
        .set({ metadata: { organizationId, changedFields: ['name'] } })
        .where(eq(schema.auditLog.id, eventId))
    }
  })
})
