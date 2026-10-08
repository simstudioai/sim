import { generateId } from '@sim/utils/id'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

async function loadRuntime() {
  const [
    { db },
    schema,
    { eq, inArray },
    { auditLogsSource },
    { copilotChatsSource },
    { copilotRunsSource },
  ] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
    import('@/lib/data-drains/sources/audit-logs'),
    import('@/lib/data-drains/sources/copilot-chats'),
    import('@/lib/data-drains/sources/copilot-runs'),
  ])
  return { db, schema, eq, inArray, auditLogsSource, copilotChatsSource, copilotRunsSource }
}

describe('Drain source coverage and payload safety in PostgreSQL', () => {
  let runtime: Awaited<ReturnType<typeof loadRuntime>>
  const userId = generateId()
  const organizationId = generateId()
  const otherOrganizationId = generateId()
  const chatId = generateId()
  const otherChatId = generateId()
  const oversizedEventId = generateId()
  const runId = generateId()
  const old = new Date('2026-01-01T00:00:00.000Z')

  beforeAll(async () => {
    runtime = await loadRuntime()
    const { db, schema } = runtime
    await db.insert(schema.user).values({
      id: userId,
      name: 'Drain fixture',
      email: `${userId}@drain-source.test`,
      emailVerified: true,
      createdAt: old,
      updatedAt: old,
    })
    await db.insert(schema.organization).values(
      [organizationId, otherOrganizationId].map((id) => ({
        id,
        name: 'Drain fixture',
        slug: id,
        createdAt: old,
      }))
    )
    await db.insert(schema.copilotChats).values([
      { id: chatId, userId, organizationId, createdAt: old, updatedAt: old },
      {
        id: otherChatId,
        userId,
        organizationId: otherOrganizationId,
        createdAt: old,
        updatedAt: old,
      },
    ])
    await db.insert(schema.copilotMessages).values({
      id: generateId(),
      messageId: generateId(),
      chatId,
      role: 'user',
      content: { text: 'Organization chat' },
      createdAt: old,
    })
    await db.insert(schema.copilotRuns).values({
      id: runId,
      chatId,
      userId,
      organizationId,
      executionId: generateId(),
      streamId: generateId(),
      status: 'complete',
      startedAt: old,
      completedAt: old,
      createdAt: old,
      updatedAt: old,
      requestContext: {
        requestId: 'public-correlation-id',
        controllerToken: 'private-controller-token',
        recovery: { billingAdmission: { serializedAttribution: 'private-billing-receipt' } },
      },
    })
  }, 30_000)

  afterAll(async () => {
    if (!runtime) return
    const { db, schema, eq, inArray } = runtime
    await db.delete(schema.auditLog).where(eq(schema.auditLog.id, oversizedEventId))
    await db.delete(schema.user).where(eq(schema.user.id, userId))
    await db
      .delete(schema.organization)
      .where(inArray(schema.organization.id, [organizationId, otherOrganizationId]))
  })

  function input() {
    return { organizationId, cursor: null, chunkSize: 100, signal: new AbortController().signal }
  }

  it('includes organization-owned chats and runs without including another tenant', async () => {
    const chats: string[] = []
    for await (const rows of runtime.copilotChatsSource.pages(input()))
      chats.push(...rows.map((row) => row.id))
    expect(chats).toEqual([chatId])
    const runs: string[] = []
    for await (const rows of runtime.copilotRunsSource.pages(input()))
      runs.push(...rows.map((row) => row.id))
    expect(runs).toEqual([runId])
  })

  it('exports correlation metadata without internal controller tokens or billing receipts', async () => {
    const [row] = await runtime.db
      .select()
      .from(runtime.schema.copilotRuns)
      .where(runtime.eq(runtime.schema.copilotRuns.id, runId))
    const exported = runtime.copilotRunsSource.serialize(row)
    expect(exported.requestContext).toEqual({ requestId: 'public-correlation-id' })
    expect(JSON.stringify(exported)).not.toContain('private-controller-token')
    expect(JSON.stringify(exported)).not.toContain('private-billing-receipt')
  })

  it('refuses an oversized transcript before loading its messages', async () => {
    const messageId = generateId()
    await runtime.db.insert(runtime.schema.copilotMessages).values({
      id: messageId,
      messageId: generateId(),
      chatId,
      role: 'user',
      content: { text: 'x'.repeat(1024 * 1024 + 1) },
      createdAt: old,
    })
    try {
      await expect(async () => {
        for await (const _rows of runtime.copilotChatsSource.pages(input())) {
        }
      }).rejects.toThrow(/record.*(bytes|size|limit)/i)
    } finally {
      await runtime.db
        .delete(runtime.schema.copilotMessages)
        .where(runtime.eq(runtime.schema.copilotMessages.id, messageId))
    }
  })

  it('refuses metadata and transcript that together exceed the record budget', async () => {
    const { db, schema, eq } = runtime
    const [original] = await db
      .select()
      .from(schema.copilotChats)
      .where(eq(schema.copilotChats.id, chatId))
    const messageId = generateId()
    await db
      .update(schema.copilotChats)
      .set({ config: { fixture: 'x'.repeat(550_000) } })
      .where(eq(schema.copilotChats.id, chatId))
    await db.insert(schema.copilotMessages).values({
      id: messageId,
      messageId: generateId(),
      chatId,
      role: 'user',
      content: { text: 'x'.repeat(550_000) },
      createdAt: old,
    })
    try {
      await expect(async () => {
        for await (const _rows of runtime.copilotChatsSource.pages(input())) {
        }
      }).rejects.toThrow(/record.*(bytes|size|limit)/i)
    } finally {
      await db.delete(schema.copilotMessages).where(eq(schema.copilotMessages.id, messageId))
      await db
        .update(schema.copilotChats)
        .set({ config: original.config })
        .where(eq(schema.copilotChats.id, chatId))
    }
  })

  it('keeps paging when a caller requests more rows than the source page budget', async () => {
    const scope = generateId()
    const eventIds = Array.from({ length: 101 }, () => generateId())
    await runtime.db.insert(runtime.schema.auditLog).values(
      eventIds.map((id) => ({
        id,
        actorId: null,
        action: 'organization.updated',
        resourceType: 'organization',
        resourceId: scope,
        metadata: { organizationId: scope },
        createdAt: old,
      }))
    )
    try {
      const seen: string[] = []
      for await (const rows of runtime.auditLogsSource.pages({
        ...input(),
        organizationId: scope,
        chunkSize: 1000,
      })) {
        seen.push(...rows.map((row) => row.id))
      }
      expect(new Set(seen)).toEqual(new Set(eventIds))
      expect(seen).toHaveLength(eventIds.length)
    } finally {
      await runtime.db
        .delete(runtime.schema.auditLog)
        .where(runtime.inArray(runtime.schema.auditLog.id, eventIds))
    }
  })

  it('refuses an oversized database record at the source boundary', async () => {
    await runtime.db.insert(runtime.schema.auditLog).values({
      id: oversizedEventId,
      actorId: null,
      action: 'organization.updated',
      resourceType: 'organization',
      resourceId: organizationId,
      createdAt: old,
      metadata: { organizationId, value: 'x'.repeat(1024 * 1024 + 1) },
    })
    await expect(async () => {
      for await (const _rows of runtime.auditLogsSource.pages(input())) {
      }
    }).rejects.toThrow(/record.*(bytes|size|limit)/i)
  })
})
