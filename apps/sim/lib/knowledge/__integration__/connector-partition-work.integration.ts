/** Real PostgreSQL coverage for provider-independent partition work and atomic checkpoint advancement. */
import { db } from '@sim/db'
import {
  knowledgeConnector,
  knowledgeConnectorPartition,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import { beginListingCheckpoint } from '@/lib/knowledge/connectors/listing-checkpoint'
import {
  commitConnectorPartitionWork,
  connectorPartitionWorkStore,
} from '@/lib/knowledge/connectors/partition-store'
import type { ConnectorPartitionWorkUpdate } from '@/lib/knowledge/connectors/partition-work'
import { assertSyncLeaseHeldInTx, stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'

const spaceContextSchema = z
  .object({
    spaceKey: z.string().min(1).max(128),
    siteId: z.string().min(1).max(256),
  })
  .strict()
const parseContext = (value: unknown) => spaceContextSchema.parse(value)

describe('Connector partition checkpoint storage', () => {
  let owner: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  const generationId = 'partition-fixture-generation'
  const generationStartedAt = new Date(Date.now() - 13 * 60 * 60 * 1000)
  const permissionRefreshAt = new Date(generationStartedAt.getTime() + 12 * 60 * 60_000)
  const first = {
    partitionKey: 'first',
    context: { spaceKey: 'FIRST', siteId: 'fixture-site' },
    cursor: 'saved-provider-page-91',
  }
  const second = {
    partitionKey: 'second',
    context: { spaceKey: 'SECOND', siteId: 'fixture-site' },
    cursor: 'provider-first-page',
  }
  const checkpoint = beginListingCheckpoint({
    fingerprint: 'a'.repeat(64),
    generationId,
    startedAt: generationStartedAt,
  })

  beforeEach(async () => {
    owner = await seedKnowledgeAclFixture(undefined, { connectorType: 'confluence' })
    await db.transaction(async (tx) => {
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        { enqueue: [first, second] },
        permissionRefreshAt
      )
      await tx
        .update(knowledgeConnector)
        .set({ listingCheckpoint: checkpoint })
        .where(eq(knowledgeConnector.id, owner.connectorId))
    })
  })
  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(workspace).where(eq(workspace.id, owner.workspaceId))
    await db.delete(organization).where(eq(organization.id, owner.organizationId))
    await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
  })
  afterAll(() => db.$client.end())

  it('round-trips provider-owned space metadata without Google identity fields', async () => {
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    expect(await store.get('first', 'content')).toMatchObject({
      partitionKey: first.partitionKey,
      context: first.context,
      cursor: first.cursor,
    })
    expect((await store.next('content', new Date()))?.context).toEqual(first.context)
    const [row] = await db
      .select({ permissionRetryAt: knowledgeConnectorPartition.permissionRetryAt })
      .from(knowledgeConnectorPartition)
      .where(
        and(
          eq(knowledgeConnectorPartition.connectorId, owner.connectorId),
          eq(knowledgeConnectorPartition.partitionKey, first.partitionKey)
        )
      )
    expect(row.permissionRetryAt).toEqual(permissionRefreshAt)
  })

  it('rejects malformed stored provider metadata before exposing work to its caller', async () => {
    await db
      .update(knowledgeConnectorPartition)
      .set({ context: { spaceKey: 7, siteId: 'fixture-site' } })
      .where(eq(knowledgeConnectorPartition.connectorId, owner.connectorId))
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    await expect(store.get('first', 'content')).rejects.toMatchObject({ name: 'ZodError' })
    await expect(store.next('content', new Date())).rejects.toMatchObject({ name: 'ZodError' })
  })

  it.each([
    { label: 'null', context: null },
    { label: 'array', context: [] },
    { label: 'string', context: 'not-an-object' },
    { label: 'number', context: 7 },
  ])('rejects non-object JSON metadata: $label', async ({ context }) => {
    await expect(
      db.execute(sql`
        UPDATE ${knowledgeConnectorPartition}
        SET context = ${JSON.stringify(context)}::jsonb
        WHERE connector_id = ${owner.connectorId}
      `)
    ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'kcp_context_check' } })
  })

  it('requires context rather than silently inserting empty metadata', async () => {
    await expect(
      db.execute(sql`
        INSERT INTO ${knowledgeConnectorPartition}
          (connector_id, partition_key, generation_id, permission_retry_at)
        VALUES (${owner.connectorId}, 'missing-context', ${generationId}, now())
      `)
    ).rejects.toMatchObject({ cause: { code: '23502', column_name: 'context' } })
  })

  it('accepts the context byte limit and rejects larger ASCII and multibyte objects', async () => {
    await db.execute(sql`
      UPDATE ${knowledgeConnectorPartition}
      SET context = jsonb_build_object(
        'payload', repeat('a', 16384 - octet_length(jsonb_build_object('payload', '')::text))
      )
      WHERE connector_id = ${owner.connectorId}
    `)
    const [row] = await db
      .select({ bytes: sql<number>`octet_length(${knowledgeConnectorPartition.context}::text)` })
      .from(knowledgeConnectorPartition)
      .where(eq(knowledgeConnectorPartition.connectorId, owner.connectorId))
      .limit(1)
    expect(row.bytes).toBe(16384)
    for (const payload of ['a'.repeat(16384), 'あ'.repeat(5500)]) {
      await expect(
        db
          .update(knowledgeConnectorPartition)
          .set({ context: { payload } })
          .where(eq(knowledgeConnectorPartition.connectorId, owner.connectorId))
      ).rejects.toMatchObject({ cause: { code: '23514', constraint_name: 'kcp_context_check' } })
    }
  })

  it.each([
    ['empty', ''],
    ['oversized ASCII', 'a'.repeat(1025)],
    ['oversized multibyte', 'あ'.repeat(342)],
  ])('rejects %s partition keys', async (_label, partitionKey) => {
    await expect(
      db
        .update(knowledgeConnectorPartition)
        .set({ partitionKey })
        .where(
          and(
            eq(knowledgeConnectorPartition.connectorId, owner.connectorId),
            eq(knowledgeConnectorPartition.partitionKey, first.partitionKey)
          )
        )
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'kcp_partition_key_check' },
    })
  })

  it('accepts a partition key at the byte limit', async () => {
    const partitionKey = 'a'.repeat(1024)
    await db
      .update(knowledgeConnectorPartition)
      .set({ partitionKey })
      .where(
        and(
          eq(knowledgeConnectorPartition.connectorId, owner.connectorId),
          eq(knowledgeConnectorPartition.partitionKey, first.partitionKey)
        )
      )
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    expect((await store.get(partitionKey, 'content'))?.context).toEqual(first.context)
  })

  it('rolls back partition progress and the owning checkpoint together', async () => {
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    const before = await store.get('first', 'content')
    await expect(
      db.transaction(async (tx) => {
        await assertSyncLeaseHeldInTx(tx, owner.connectorId, {
          stillHeld: () => stillHoldsSyncLock(owner.connectorId, owner.lockId),
        })
        await commitConnectorPartitionWork(
          tx,
          owner.connectorId,
          generationId,
          {
            update: {
              partitionKey: 'first',
              kind: 'content',
              cursor: 'next-page-92',
              completed: false,
              retryAt: new Date(),
              attempts: 0,
              failure: null,
            },
          },
          permissionRefreshAt
        )
        await tx
          .update(knowledgeConnector)
          .set({ listingCheckpoint: { ...checkpoint, cursor: 'outer-next-page' } })
          .where(eq(knowledgeConnector.id, owner.connectorId))
        throw new Error('simulated worker transaction failure')
      })
    ).rejects.toThrow('simulated worker transaction failure')
    expect(await store.get('first', 'content')).toEqual(before)
    const [connector] = await db
      .select({ checkpoint: knowledgeConnector.listingCheckpoint })
      .from(knowledgeConnector)
      .where(eq(knowledgeConnector.id, owner.connectorId))
    expect(connector.checkpoint).toEqual(checkpoint)
  })

  it('pins provider replay, preserves it during repeated partition discovery and refreshes old evidence promptly', async () => {
    await db.transaction(async (tx) => {
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        { pin: { partitionKey: 'first', kind: 'content', cursor: 'stable-listing-snapshot' } },
        permissionRefreshAt
      )
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        { enqueue: [{ ...first, cursor: 'must-not-overwrite' }] },
        permissionRefreshAt
      )
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            partitionKey: 'first',
            kind: 'content',
            cursor: 'next-content-page',
            completed: false,
            retryAt: new Date(),
            attempts: 0,
            failure: null,
          },
        },
        permissionRefreshAt
      )
    })
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    expect((await store.get('first', 'content'))?.cursor).toBe('next-content-page')
    expect((await store.next('content', new Date()))?.partitionKey).toBe('second')
    expect((await store.next('permissions', new Date()))?.partitionKey).toBe('first')
    expect(await store.get('first', 'permissions')).toMatchObject({
      cursor: undefined,
      attempts: 0,
    })
  })

  it('retains blocked work independently of healthy completions and excludes another generation', async () => {
    await db.transaction(async (tx) => {
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            partitionKey: 'first',
            kind: 'content',
            cursor: 'next-content-page',
            completed: false,
            retryAt: new Date(Date.now() + 60 * 60 * 1000),
            attempts: 1,
            failure: {
              scope: first.context.spaceKey,
              operation: 'confluence.pages.list',
              status: 403,
              reasons: [],
            },
          },
        },
        permissionRefreshAt
      )
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            partitionKey: 'second',
            kind: 'content',
            cursor: null,
            completed: true,
            retryAt: new Date(Date.now() + 60 * 60 * 1000),
            attempts: 0,
            failure: null,
          },
        },
        permissionRefreshAt
      )
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        'different-generation',
        {
          enqueue: [
            { partitionKey: 'other', context: { spaceKey: 'OTHER', siteId: 'fixture-site' } },
          ],
        },
        permissionRefreshAt
      )
    })
    const store = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    expect(await store.next('content', new Date())).toBeNull()
    expect(await store.remaining()).toMatchObject({
      count: 1,
      failures: { count: 1, samples: [{ scope: first.context.spaceKey, status: 403 }] },
    })
    expect((await store.get('first', 'content'))?.cursor).toBe('next-content-page')
    expect(await store.get('other', 'content')).toBeNull()
    expect(
      await connectorPartitionWorkStore('other-connector', generationId, parseContext).remaining()
    ).toEqual({
      count: 0,
      retryAt: null,
    })
  })

  it('does not rescan completed manual work or use its past retry time to wake blocked work', async () => {
    await commitConnectorPartitionWork(
      db,
      owner.connectorId,
      generationId,
      {
        update: {
          partitionKey: 'first',
          kind: 'content',
          cursor: 'blocked-partition-page',
          completed: false,
          retryAt: new Date(Date.now() + 60 * 60_000),
          attempts: 1,
          failure: {
            scope: first.context.spaceKey,
            operation: 'confluence.pages.list',
            reasons: [],
          },
        },
      },
      permissionRefreshAt
    )
    await commitConnectorPartitionWork(
      db,
      owner.connectorId,
      generationId,
      {
        update: {
          partitionKey: 'second',
          kind: 'content',
          cursor: null,
          completed: true,
          retryAt: new Date(Date.now() - 60_000),
          attempts: 0,
          failure: null,
        },
      },
      permissionRefreshAt
    )
    const automatic = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
    const manual = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext, false)
    expect((await automatic.next('content', new Date()))?.partitionKey).toBe('second')
    expect(await manual.next('content', new Date())).toBeNull()
    expect((await manual.remaining()).retryAt!.getTime()).toBeGreaterThan(Date.now())
    expect((await manual.next('permissions', new Date()))?.partitionKey).toBe('first')
    await commitConnectorPartitionWork(
      db,
      owner.connectorId,
      generationId,
      {
        update: {
          partitionKey: 'first',
          kind: 'content',
          cursor: null,
          completed: true,
          retryAt: new Date(Date.now() - 60_000),
          attempts: 0,
          failure: null,
        },
      },
      permissionRefreshAt
    )
    expect(await automatic.next('content', new Date())).toBeNull()
    expect((await automatic.remaining()).count).toBe(0)
  })

  it.each(['continuation', 'failure'] as const)(
    'retains a deferred permission %s after all content completes without keeping future refreshes open',
    async (pending) => {
      vi.stubEnv('TZ', 'Pacific/Honolulu')
      const now = new Date()
      const retryAt = new Date(now.getTime() + 30 * 60_000)
      const nextPeriodicRefresh = new Date(now.getTime() + 12 * 60 * 60_000)
      const update = (
        partitionKey: string,
        kind: ConnectorPartitionWorkUpdate['kind'],
        changes: Partial<ConnectorPartitionWorkUpdate> = {}
      ) =>
        commitConnectorPartitionWork(
          db,
          owner.connectorId,
          generationId,
          {
            update: {
              partitionKey,
              kind,
              cursor: null,
              completed: true,
              retryAt: nextPeriodicRefresh,
              attempts: 0,
              failure: null,
              permissionStartedAt: null,
              ...changes,
            },
          },
          permissionRefreshAt
        )
      for (const partitionKey of ['first', 'second']) {
        await update(partitionKey, 'permissions')
        await update(partitionKey, 'content', { retryAt: new Date(now.getTime() - 60_000) })
      }
      await update('first', 'permissions', {
        cursor: pending === 'continuation' ? 'permission-page-9' : null,
        completed: false,
        retryAt,
        attempts: pending === 'failure' ? 1 : 0,
        failure:
          pending === 'failure'
            ? {
                scope: first.context.spaceKey,
                operation: 'confluence.pages.list',
                status: 403,
                reasons: [],
              }
            : null,
      })
      const automatic = connectorPartitionWorkStore(owner.connectorId, generationId, parseContext)
      const manual = connectorPartitionWorkStore(
        owner.connectorId,
        generationId,
        parseContext,
        false
      )
      expect(await manual.remaining()).toMatchObject({ count: 1, retryAt })
      expect(await manual.next('content', now)).toBeNull()
      expect(await automatic.next('content', now)).not.toBeNull()
      expect(await automatic.next('permissions', now)).toBeNull()
      expect((await automatic.next('permissions', retryAt))?.partitionKey).toBe('first')
      for (const partitionKey of ['first', 'second']) {
        await update(partitionKey, 'content', {
          retryAt: new Date(now.getTime() + 2 * 60 * 60_000),
        })
      }
      expect(await automatic.remaining()).toMatchObject({ count: 1, retryAt })
      await update('first', 'permissions')
      expect(await automatic.remaining()).toEqual({ count: 0, retryAt: null })
      expect(await manual.remaining()).toEqual({ count: 0, retryAt: null })
      expect(await automatic.next('content', new Date(now.getTime() + 3 * 60 * 60_000))).toBeNull()
    }
  )

  it('resets both provider continuations while preserving due permissions, and cascades on connector deletion', async () => {
    const permissionDueAt = new Date(Date.now() - 60_000)
    await db
      .update(knowledgeConnectorPartition)
      .set({ permissionRetryAt: permissionDueAt })
      .where(eq(knowledgeConnectorPartition.connectorId, owner.connectorId))
    await db.transaction(async (tx) => {
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        generationId,
        {
          pin: {
            partitionKey: 'first',
            kind: 'permissions',
            cursor: 'old-config-permission-page',
            permissionStartedAt: generationStartedAt,
          },
        },
        permissionRefreshAt
      )
      await commitConnectorPartitionWork(
        tx,
        owner.connectorId,
        'new-config',
        { enqueue: [{ ...first, cursor: 'new-config-first-page' }] },
        new Date(Date.now() + 12 * 60 * 60_000)
      )
    })
    const store = connectorPartitionWorkStore(owner.connectorId, 'new-config', parseContext)
    expect(await store.get('first', 'content')).toMatchObject({
      cursor: 'new-config-first-page',
      attempts: 0,
    })
    expect(await store.get('first', 'permissions')).toMatchObject({
      cursor: undefined,
      permissionStartedAt: undefined,
    })
    const [progress] = await db
      .select({ permissionRetryAt: knowledgeConnectorPartition.permissionRetryAt })
      .from(knowledgeConnectorPartition)
      .where(
        and(
          eq(knowledgeConnectorPartition.connectorId, owner.connectorId),
          eq(knowledgeConnectorPartition.partitionKey, 'first')
        )
      )
    expect(progress.permissionRetryAt).toEqual(permissionDueAt)
    await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, owner.connectorId))
    expect(
      await db
        .select()
        .from(knowledgeConnectorPartition)
        .where(eq(knowledgeConnectorPartition.connectorId, owner.connectorId))
    ).toEqual([])
  })
})
