/**
 * Sends real TCP resets through a proxy between postgres.js and real PostgreSQL, using the pool
 * options `@sim/db` uses, because the error a reset produces depends on what the connection was
 * doing and no mock can stand in for that. Rows live in a session-independent scratch table.
 */
import net, { type Socket } from 'node:net'
import { readTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withDatabaseReadRetry, withIdempotentWriteRetry } from '@/lib/db/read-retry'

const TABLE = sql.identifier(
  `connection_loss_${generateShortId(8).replace(/\W/g, '').toLowerCase()}`
)

const live = new Set<Socket>()
let proxy: net.Server
let client: ReturnType<typeof postgres>
let db: ReturnType<typeof drizzle>
let admin: ReturnType<typeof postgres>
let adminDb: ReturnType<typeof drizzle>

const resetEverySocket = () => {
  for (const socket of live) socket.resetAndDestroy()
}

/** Lets the statement reach the server before the socket is reset under it. */
const shortly = () => sleep(75)

beforeAll(async () => {
  const url = new URL(readTestDatabaseUrl())
  proxy = net.createServer((downstream) => {
    const upstream = net.connect(Number(url.port || 5432), url.hostname.replace(/^\[|\]$/g, ''))
    live.add(downstream)
    downstream.pipe(upstream)
    upstream.pipe(downstream)
    downstream.on('error', () => {})
    upstream.on('error', () => downstream.destroy())
    downstream.on('close', () => {
      live.delete(downstream)
      upstream.destroy()
    })
  })
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
  const { port } = proxy.address() as net.AddressInfo
  const proxied = new URL(url)
  proxied.hostname = '127.0.0.1'
  proxied.port = String(port)

  const poolOptions = { prepare: false, fetch_types: false, idle_timeout: 20, onnotice: () => {} }
  client = postgres(proxied.toString(), { ...poolOptions, max: 5 })
  db = drizzle(client)
  admin = postgres(url.toString(), { ...poolOptions, max: 1 })
  adminDb = drizzle(admin)
  await adminDb.execute(
    sql`CREATE TABLE ${TABLE} (id text PRIMARY KEY, status text NOT NULL, writes integer NOT NULL)`
  )
})

afterAll(async () => {
  await adminDb.execute(sql`DROP TABLE IF EXISTS ${TABLE}`)
  await client.end({ timeout: 1 })
  await admin.end({ timeout: 1 })
  await new Promise((resolve) => proxy.close(resolve))
})

describe('real connection resets', () => {
  it('recovers a read reset while its statement is running', async () => {
    let attempts = 0
    const rows = await withDatabaseReadRetry(async () => {
      attempts++
      const statement =
        attempts === 1
          ? db.execute(sql`SELECT pg_sleep(1), 1 AS answer`).then((result) => result)
          : db.execute(sql`SELECT 1 AS answer`).then((result) => result)
      if (attempts === 1) {
        await shortly()
        resetEverySocket()
      }
      return statement
    })

    expect(attempts).toBe(2)
    expect(rows[0]).toMatchObject({ answer: 1 })
  })

  it('reuses the pool after every idle socket in it is reset', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => db.execute(sql`SELECT pg_sleep(0.02)`).then((rows) => rows))
    )
    resetEverySocket()

    const rows = await Promise.all(
      Array.from({ length: 5 }, () =>
        withDatabaseReadRetry(() => db.execute(sql`SELECT 1 AS answer`).then((result) => result))
      )
    )

    expect(rows).toHaveLength(5)
  })

  it('completes a transactional write reset before it commits, applying it once', async () => {
    let attempts = 0
    await withIdempotentWriteRetry(async () => {
      attempts++
      await db.transaction(async (trx) => {
        await trx.execute(sql`
          INSERT INTO ${TABLE} (id, status, writes) VALUES ('uncommitted', 'completed', 1)
          ON CONFLICT (id) DO UPDATE SET writes = ${TABLE}.writes + 1
        `)
        if (attempts === 1) {
          resetEverySocket()
          await trx.execute(sql`SELECT pg_sleep(1)`)
        }
      })
    })

    const rows = await adminDb.execute(sql`SELECT writes FROM ${TABLE} WHERE id = 'uncommitted'`)
    expect(attempts).toBe(2)
    expect(rows[0]).toMatchObject({ writes: 1 })
  })

  it('does not repeat a write the database rejected', async () => {
    let attempts = 0
    await expect(
      withIdempotentWriteRetry(async () => {
        attempts++
        await db.execute(
          sql`INSERT INTO ${TABLE} (id, status, writes) VALUES ('rejected', NULL, 1)`
        )
      })
    ).rejects.toThrow()
    expect(attempts).toBe(1)
  })
})
