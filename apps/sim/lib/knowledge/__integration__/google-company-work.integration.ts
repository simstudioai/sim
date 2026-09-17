/** Real PostgreSQL coverage for resumable Google user work and atomic checkpoint advancement. */
import { db } from '@sim/db'
import {
  knowledgeConnector,
  knowledgeConnectorGoogleUser,
  organization,
  user,
  workspace,
} from '@sim/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedKnowledgeAclFixture } from '@/lib/knowledge/__integration__/seed-source-access-fixture'
import {
  commitGoogleCompanyWork,
  googleCompanyWorkStore,
} from '@/lib/knowledge/connectors/google-company-store'
import { beginListingCheckpoint } from '@/lib/knowledge/connectors/listing-checkpoint'
import { assertSyncLeaseHeldInTx, stillHoldsSyncLock } from '@/lib/knowledge/connectors/sync-lock'

describe('Google company user checkpoint storage', () => {
  let owner: Awaited<ReturnType<typeof seedKnowledgeAclFixture>>
  const generationId = 'google-fixture-generation'
  const generationStartedAt = new Date(Date.now() - 13 * 60 * 60 * 1000)
  const first = {
    user: { id: 'first', email: 'first@fixture.test', customerId: 'customer' },
    cursor: 'saved-provider-page-91',
  }
  const second = {
    user: { id: 'second', email: 'second@fixture.test', customerId: 'customer' },
    cursor: 'provider-first-page',
  }
  const checkpoint = beginListingCheckpoint({
    fingerprint: 'a'.repeat(64),
    generationId,
    startedAt: generationStartedAt,
  })

  beforeAll(async () => {
    owner = await seedKnowledgeAclFixture(undefined, { connectorType: 'google_drive' })
    await db.transaction(async (tx) => {
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        { enqueue: [first, second] },
        generationStartedAt
      )
      await tx
        .update(knowledgeConnector)
        .set({ listingCheckpoint: checkpoint })
        .where(eq(knowledgeConnector.id, owner.connectorId))
    })
  })
  afterAll(async () => {
    await db.delete(workspace).where(eq(workspace.id, owner.workspaceId))
    await db.delete(organization).where(eq(organization.id, owner.organizationId))
    await db.delete(user).where(inArray(user.id, [owner.aliceId, owner.bobId]))
    await db.$client.end()
  })

  it('rolls back user progress and the owning checkpoint together', async () => {
    const store = googleCompanyWorkStore(owner.connectorId, generationId)
    const before = await store.get('first', 'content')
    await expect(
      db.transaction(async (tx) => {
        await assertSyncLeaseHeldInTx(tx, owner.connectorId, {
          stillHeld: () => stillHoldsSyncLock(owner.connectorId, owner.lockId),
        })
        await commitGoogleCompanyWork(
          tx,
          owner.connectorId,
          generationId,
          {
            update: {
              userId: 'first',
              kind: 'content',
              cursor: 'next-page-92',
              completed: false,
              retryAt: new Date(),
              attempts: 0,
              failure: null,
            },
          },
          generationStartedAt
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

  it('pins provider replay, preserves it during repeated Directory discovery and refreshes old evidence promptly', async () => {
    await db.transaction(async (tx) => {
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        { pin: { userId: 'first', kind: 'content', cursor: 'stable-listing-snapshot' } },
        generationStartedAt
      )
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        { enqueue: [{ ...first, cursor: 'must-not-overwrite' }] },
        generationStartedAt
      )
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            userId: 'first',
            kind: 'content',
            cursor: 'next-content-page',
            completed: false,
            retryAt: new Date(),
            attempts: 0,
            failure: null,
          },
        },
        generationStartedAt
      )
    })
    const store = googleCompanyWorkStore(owner.connectorId, generationId)
    expect((await store.get('first', 'content'))?.cursor).toBe('next-content-page')
    expect((await store.next('content', new Date()))?.user.id).toBe('second')
    expect((await store.next('permissions', new Date()))?.user.id).toBe('first')
    expect(await store.get('first', 'permissions')).toMatchObject({
      cursor: undefined,
      attempts: 0,
    })
  })

  it('retains blocked work independently of healthy completions and excludes another generation', async () => {
    await db.transaction(async (tx) => {
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            userId: 'first',
            kind: 'content',
            cursor: 'next-content-page',
            completed: false,
            retryAt: new Date(Date.now() + 60 * 60 * 1000),
            attempts: 1,
            failure: {
              scope: first.user.email,
              operation: 'drive.files.list',
              status: 403,
              reasons: [],
            },
          },
        },
        generationStartedAt
      )
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        {
          update: {
            userId: 'second',
            kind: 'content',
            cursor: null,
            completed: true,
            retryAt: new Date(Date.now() + 60 * 60 * 1000),
            attempts: 0,
            failure: null,
          },
        },
        generationStartedAt
      )
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        'different-generation',
        {
          enqueue: [{ user: { id: 'other', email: 'other@fixture.test', customerId: 'customer' } }],
        },
        generationStartedAt
      )
    })
    const store = googleCompanyWorkStore(owner.connectorId, generationId)
    expect(await store.next('content', new Date())).toBeNull()
    expect(await store.remaining()).toMatchObject({
      count: 1,
      failures: { count: 1, samples: [{ scope: first.user.email, status: 403 }] },
    })
    expect((await store.get('first', 'content'))?.cursor).toBe('next-content-page')
    expect(await store.get('other', 'content')).toBeNull()
    expect(await googleCompanyWorkStore('other-connector', generationId).remaining()).toEqual({
      count: 0,
      retryAt: null,
    })
  })

  it('does not rescan completed manual work or use its past retry time to wake blocked work', async () => {
    await commitGoogleCompanyWork(
      db,
      owner.connectorId,
      generationId,
      {
        update: {
          userId: 'second',
          kind: 'content',
          cursor: null,
          completed: true,
          retryAt: new Date(Date.now() - 60_000),
          attempts: 0,
          failure: null,
        },
      },
      generationStartedAt
    )
    const automatic = googleCompanyWorkStore(owner.connectorId, generationId)
    const manual = googleCompanyWorkStore(owner.connectorId, generationId, false)
    expect((await automatic.next('content', new Date()))?.user.id).toBe('second')
    expect(await manual.next('content', new Date())).toBeNull()
    expect((await manual.remaining()).retryAt!.getTime()).toBeGreaterThan(Date.now())
    expect((await manual.next('permissions', new Date()))?.user.id).toBe('first')
    await commitGoogleCompanyWork(
      db,
      owner.connectorId,
      generationId,
      {
        update: {
          userId: 'first',
          kind: 'content',
          cursor: null,
          completed: true,
          retryAt: new Date(Date.now() - 60_000),
          attempts: 0,
          failure: null,
        },
      },
      generationStartedAt
    )
    expect(await automatic.next('content', new Date())).toBeNull()
    expect((await automatic.remaining()).count).toBe(0)
  })

  it('resets both provider continuations on a new configuration generation and cascades on connector deletion', async () => {
    await db.transaction(async (tx) => {
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        generationId,
        {
          pin: {
            userId: 'first',
            kind: 'permissions',
            cursor: 'old-config-permission-page',
            permissionStartedAt: generationStartedAt,
          },
        },
        generationStartedAt
      )
      await commitGoogleCompanyWork(
        tx,
        owner.connectorId,
        'new-config',
        { enqueue: [{ ...first, cursor: 'new-config-first-page' }] },
        new Date()
      )
    })
    const store = googleCompanyWorkStore(owner.connectorId, 'new-config')
    expect(await store.get('first', 'content')).toMatchObject({
      cursor: 'new-config-first-page',
      attempts: 0,
    })
    expect(await store.get('first', 'permissions')).toMatchObject({
      cursor: undefined,
      permissionStartedAt: undefined,
    })
    await db.delete(knowledgeConnector).where(eq(knowledgeConnector.id, owner.connectorId))
    expect(
      await db
        .select()
        .from(knowledgeConnectorGoogleUser)
        .where(eq(knowledgeConnectorGoogleUser.connectorId, owner.connectorId))
    ).toEqual([])
  })
})
