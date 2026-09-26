/** Tagged advisory locks must keep blocking semantics on real PostgreSQL and carry their tag to the server. */
import * as schema from '@sim/db/schema'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { acquireAdvisoryXactLock, tryAcquireAdvisoryXactLock } from '@/lib/db/advisory-locks'

const connection = postgres(readTestDatabaseUrl(), { max: 4, prepare: false, onnotice: () => {} })
const db = drizzle(connection, { schema })

/**
 * Holds `key` in an open transaction until the returned release function is
 * called. Rejects if the holder transaction fails before taking the lock.
 */
async function holdLock(tag: string, key: string): Promise<() => Promise<void>> {
  let release!: () => void
  let acquired!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const held = new Promise<void>((resolve) => {
    acquired = resolve
  })
  const transaction = db.transaction(async (tx) => {
    await acquireAdvisoryXactLock(tx, tag, key)
    acquired()
    await released
  })
  await Promise.race([held, transaction])
  return async () => {
    release()
    await transaction
  }
}

async function acquireWithTimeout(tag: string, key: string, timeoutMs: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('lock_timeout', ${`${timeoutMs}ms`}, true)`)
    await acquireAdvisoryXactLock(tx, tag, key)
  })
}

describe('advisory xact locks', () => {
  afterAll(async () => {
    await connection.end()
  })

  it('blocks a second transaction on the same key until the holder commits', async () => {
    const key = `lock-test:${generateId()}`
    const release = await holdLock('lock_test', key)
    try {
      const error = await acquireWithTimeout('lock_test', key, 200).catch((e: unknown) => e)
      expect(getPostgresErrorCode(error)).toBe('55P03')
    } finally {
      await release()
    }
    await expect(acquireWithTimeout('lock_test', key, 200)).resolves.toBeUndefined()
  })

  it('does not block a transaction on a different key', async () => {
    const release = await holdLock('lock_test', `lock-test:${generateId()}`)
    try {
      await expect(
        acquireWithTimeout('lock_test', `lock-test:${generateId()}`, 200)
      ).resolves.toBeUndefined()
    } finally {
      await release()
    }
  })

  it('reports whether the non-blocking variant acquired the lock', async () => {
    const key = `lock-test:${generateId()}`
    const release = await holdLock('lock_test', key)
    let whileHeld: boolean
    try {
      whileHeld = await db.transaction((tx) => tryAcquireAdvisoryXactLock(tx, 'lock_test', key))
    } finally {
      await release()
    }
    const afterRelease = await db.transaction((tx) =>
      tryAcquireAdvisoryXactLock(tx, 'lock_test', key)
    )
    expect({ whileHeld, afterRelease }).toEqual({ whileHeld: false, afterRelease: true })
  })

  it('sends the caller tag with the waiting statement', async () => {
    const key = `lock-test:${generateId()}`
    const release = await holdLock('lock_test', key)
    const waiter = acquireWithTimeout('lock_test_waiter', key, 5_000)
    let waitingQuery: string | undefined
    try {
      for (let attempt = 0; attempt < 50 && !waitingQuery; attempt++) {
        const [row] = await connection<{ query: string }[]>`
          SELECT query FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND wait_event = 'advisory' AND query LIKE ${'%lock_test_waiter%'}`
        waitingQuery = row?.query
        if (!waitingQuery) await sleep(20)
      }
    } finally {
      await release()
      await waiter
    }
    expect(waitingQuery).toMatch(/pg_advisory_xact_lock\(.*\) \/\*lock='lock_test_waiter'\*\/$/)
  })

  it('rejects a tag that would escape the SQL comment', async () => {
    await expect(
      db.transaction((tx) => acquireAdvisoryXactLock(tx, "x'*/; SELECT 1; /*", 'lock-test'))
    ).rejects.toThrow('Invalid advisory lock tag')
  })
})
