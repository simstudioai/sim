import { migrationTestDatabaseUrl } from '@sim/db/scripts/migration-fixture'
import { classifyDatabaseFailure } from '@sim/utils/errors'
import { sql as statement } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { describe, expect, it } from 'vitest'

/** A port on the database host with nothing listening, so a connection is refused at once. */
function closedPortUrl(): string {
  const url = new URL(migrationTestDatabaseUrl!)
  url.port = '1'
  return url.toString()
}

async function rejectionOf(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
  } catch (error) {
    return error
  }
  throw new Error('Expected the work to fail')
}

/**
 * Classifies the errors postgres.js and Drizzle actually raise, rather than hand-built shapes:
 * a transaction that loses its connection is rejected with the driver's bare connection error,
 * with no query attached and no Drizzle wrapper, and must still read as a connection failure.
 */
describe.skipIf(!migrationTestDatabaseUrl)('database failure classification', () => {
  it('reads a connection terminated mid-transaction as a connection failure', async () => {
    const admin = postgres(migrationTestDatabaseUrl!, { max: 1 })
    const client = postgres(migrationTestDatabaseUrl!, { max: 1 })
    try {
      const error = await rejectionOf(() =>
        drizzle(client).transaction(async (tx) => {
          const [row] = await tx.execute<{ pid: number }>(statement`SELECT pg_backend_pid() AS pid`)
          await admin`SELECT pg_terminate_backend(${row.pid})`
          await tx.execute(statement`SELECT pg_sleep(0.2)`)
        })
      )
      expect(classifyDatabaseFailure(error)).toBe('connection')
    } finally {
      await client.end({ timeout: 1 }).catch(() => {})
      await admin.end()
    }
  })

  it('reads a refused connection as a connection failure, in a query and in a transaction', async () => {
    const client = postgres(closedPortUrl(), { max: 1, connect_timeout: 2 })
    try {
      const db = drizzle(client)
      expect(
        classifyDatabaseFailure(await rejectionOf(() => db.execute(statement`SELECT 1`)))
      ).toBe('connection')
      expect(
        classifyDatabaseFailure(
          await rejectionOf(() => db.transaction((tx) => tx.execute(statement`SELECT 1`)))
        )
      ).toBe('connection')
    } finally {
      await client.end({ timeout: 1 }).catch(() => {})
    }
  })

  it('reads a transaction begun on an ending pool as a connection failure', async () => {
    const client = postgres(migrationTestDatabaseUrl!, { max: 1 })
    await client`SELECT 1`
    const ending = client.end({ timeout: 5 })
    const error = await rejectionOf(() =>
      drizzle(client).transaction((tx) => tx.execute(statement`SELECT 1`))
    )
    await ending
    expect(classifyDatabaseFailure(error)).toBe('connection')
  })

  it('does not read a refused connection from another client as a database failure', async () => {
    const error = await rejectionOf(() => fetch(`http://${new URL(closedPortUrl()).host}/`))
    expect(classifyDatabaseFailure(error)).toBe('permanent')
  })
})
