import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

async function loadRuntime() {
  const [{ db }, { auditLog }, { eq, inArray, sql }, query, { auditLogsSource }] =
    await Promise.all([
      import('@sim/db'),
      import('@sim/db/schema'),
      import('drizzle-orm'),
      import('@/lib/audit-logs/query'),
      import('@/lib/data-drains/sources/audit-logs'),
    ])
  return { db, auditLog, eq, inArray, sql, query, auditLogsSource }
}

describe('Audit pagination and drain tenant coverage in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  const prefix = generateId()
  const organizationId = generateId()
  const ids = ['a', 'b', 'c', 'other'].map((suffix) => `${prefix}-${suffix}`)

  beforeAll(async () => {
    runtime = await loadRuntime()
    await runtime.db.insert(runtime.auditLog).values(
      ids.map((id, index) => ({
        id,
        actorId: null,
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: index === 3 ? generateId() : organizationId,
        metadata: index === 0 ? { organizationId } : {},
        createdAt: new Date('2026-01-01T12:00:00.123Z'),
      }))
    )
    for (const [index, id] of ids.entries()) {
      await runtime.db
        .update(runtime.auditLog)
        .set({
          createdAt: runtime.sql`timestamp '2026-01-01 12:00:00.123' + ${index + 1} * interval '100 microseconds'`,
        })
        .where(runtime.eq(runtime.auditLog.id, id))
    }
  }, 30_000)

  afterAll(async () => {
    if (runtime) {
      await runtime.db.delete(runtime.auditLog).where(runtime.inArray(runtime.auditLog.id, ids))
    }
  })

  it('returns every event once when pages split within a PostgreSQL millisecond', async () => {
    const seen: string[] = []
    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < ids.length + 1; pageIndex++) {
      const page = await runtime.query.queryAuditLogs(
        [runtime.inArray(runtime.auditLog.id, ids)],
        1,
        cursor
      )
      seen.push(...page.data.map((row) => row.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(ids.length)
    expect(new Set(seen)).toEqual(new Set(ids))
  })

  it('drains all organization-resource events and excludes the other tenant', async () => {
    const seen: string[] = []
    for await (const page of runtime.auditLogsSource.pages({
      organizationId,
      cursor: null,
      chunkSize: 1,
      signal: new AbortController().signal,
    })) {
      seen.push(...page.map((row) => row.id))
    }
    expect(new Set(seen)).toEqual(new Set(ids.slice(0, 3)))
    expect(seen).toHaveLength(3)
  })
})
