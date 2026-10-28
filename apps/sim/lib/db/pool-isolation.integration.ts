/**
 * Real `@sim/db` pools against the integration database: with every connection of the process
 * pool stuck behind a held advisory lock, usage-ledger writes and auth lookups must still finish
 * on their own pools. postgres.js pipelines new work onto busy connections when none is idle, so
 * anything still on the process pool waits for the lock instead.
 */
import { db, dbFor } from '@sim/db'
import { session, user } from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { randomInt } from '@sim/utils/random'
import { eq, sql } from 'drizzle-orm'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { authenticateApiKeyFromHeader } from '@/lib/api-key/service'
import { createSimAuthAdapter } from '@/lib/auth/sim-auth-adapter'
import { recordCumulativeUsage } from '@/lib/billing/core/usage-log'

/** Covers a new pool's first connect; a stalled operation waits for the lock, which never comes. */
const ISOLATED_BUDGET_MS = 1_500
const SATURATION_PROBE_MS = 300

const control = postgres(readTestDatabaseUrl(), { max: 1, onnotice: () => {} })
const lockKey = randomInt(1, 2 ** 31)
const userId = `pool-isolation-${generateId()}`
const sessionToken = `pool-isolation-${generateId()}`
const now = new Date()

let saturation: Promise<unknown[]> | undefined

async function waitForSaturatedProcessPool(connections: number): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    const [{ waiting }] = await control<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event = 'advisory'
        AND query LIKE '%pg_advisory_xact_lock_shared%'`
    if (waiting >= connections) return
    await sleep(5)
  }
  throw new Error('The process pool never filled with lock waiters')
}

/** Resolves `'done'` when `work` settles within the budget, `'stalled'` otherwise. */
function settlesWithin(work: Promise<unknown>, budgetMs: number): Promise<'done' | 'stalled'> {
  return Promise.race([
    work.then(() => 'done' as const),
    sleep(budgetMs).then(() => 'stalled' as const),
  ])
}

beforeAll(async () => {
  await db.insert(user).values({
    id: userId,
    name: 'Pool isolation',
    email: `${userId}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  await db.insert(session).values({
    id: generateId(),
    token: sessionToken,
    userId,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  })

  await control`SELECT pg_advisory_lock(${lockKey})`
  const connections = db.$client.options.max
  saturation = Promise.all(
    Array.from({ length: connections }, () =>
      db.execute(sql`SELECT pg_advisory_xact_lock_shared(${lockKey})`)
    )
  )
  await waitForSaturatedProcessPool(connections)
})

afterAll(async () => {
  try {
    await control`SELECT pg_advisory_unlock(${lockKey})`
    await saturation
    await db.delete(user).where(eq(user.id, userId))
  } finally {
    await Promise.all([
      db.$client.end(),
      dbFor('billing').$client.end(),
      dbFor('auth').$client.end(),
      control.end(),
    ])
  }
})

describe('dedicated pools under a saturated process pool', () => {
  it('leaves the process pool unable to serve a new query', async () => {
    await expect(settlesWithin(db.execute(sql`SELECT 1`), SATURATION_PROBE_MS)).resolves.toBe(
      'stalled'
    )
  })

  it('records cumulative usage on the billing pool', async () => {
    const write = recordCumulativeUsage({
      userId,
      billingEntity: { type: 'user', id: userId },
      billingPeriod: {
        start: new Date('2026-10-01T00:00:00Z'),
        end: new Date('2026-11-01T00:00:00Z'),
      },
      source: 'workflow',
      model: 'pool-isolation-model',
      cost: 0.25,
      eventKey: `pool-isolation:${generateId()}`,
    })

    await expect(settlesWithin(write, ISOLATED_BUDGET_MS)).resolves.toBe('done')
    await expect(write).resolves.toMatchObject({ billed: true, total: 0.25 })
  })

  it('reads a session through the auth adapter on the auth pool', async () => {
    const lookup = createSimAuthAdapter({}).findOne<{ userId: string }>({
      model: 'session',
      where: [{ field: 'token', value: sessionToken }],
    })

    await expect(settlesWithin(lookup, ISOLATED_BUDGET_MS)).resolves.toBe('done')
    await expect(lookup).resolves.toMatchObject({ userId })
  })

  it('looks up an API key on the auth pool', async () => {
    const lookup = authenticateApiKeyFromHeader(`sk-sim-${generateId()}`)

    await expect(settlesWithin(lookup, ISOLATED_BUDGET_MS)).resolves.toBe('done')
    await expect(lookup).resolves.toEqual({ success: false, error: 'Invalid API key' })
  })

  it('reads workspace key settings on the auth pool', async () => {
    const lookup = authenticateApiKeyFromHeader(`sk-sim-${generateId()}`, {
      workspaceId: generateId(),
    })

    await expect(settlesWithin(lookup, ISOLATED_BUDGET_MS)).resolves.toBe('done')
    await expect(lookup).resolves.toEqual({ success: false, error: 'Workspace not found' })
  })
})
