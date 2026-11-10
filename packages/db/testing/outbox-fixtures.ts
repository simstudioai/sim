import type { db } from '@sim/db'
import { outboxEvent } from '@sim/db/schema'
import { or, sql } from 'drizzle-orm'

type FixtureDatabase = typeof db

/**
 * Removes the outbox events a suite's fixtures queued, found by any of the suite's own ids in their
 * payload. An integration suite calls it in `afterAll` with the user and organization ids it
 * created, so events for rows it deleted do not pile up in the shared database.
 */
export async function deleteOutboxEventsNaming(database: FixtureDatabase, ids: readonly string[]) {
  if (ids.length === 0) return
  await database
    .delete(outboxEvent)
    .where(or(...ids.map((id) => sql`strpos(${outboxEvent.payload}::text, ${id}) > 0`)))
}
