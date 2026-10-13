import { readFile } from 'node:fs/promises'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { Sql } from 'postgres'

/** Installs the same bounded, replayable contract for migrations and fresh schema pushes. */
export async function enforceProjectMembership(sql: Sql): Promise<void> {
  const source = await readFile(new URL('./project-membership.sql', import.meta.url), 'utf8')
  const connection = await sql.reserve()
  let previousSearchPath: string | undefined
  try {
    const [settings] = await connection<{ search_path: string }[]>`SHOW search_path`
    previousSearchPath = settings.search_path
    /** The SQL spans committed phases, so pin this reserved session until all phases finish. */
    await connection`SELECT set_config('search_path', 'public, pg_temp', false)`
    for (const statement of source.split('--> statement-breakpoint')) {
      if (statement.trim()) await connection.unsafe(statement)
    }
  } catch (error) {
    if (!['25P03', '25P04', 'CONNECTION_CLOSED'].includes(getPostgresErrorCode(error) ?? '')) {
      await connection.unsafe('ROLLBACK')
    }
    throw error
  } finally {
    await connection
      .unsafe("SELECT pg_advisory_unlock(hashtextextended('sim:project-backfill-operator', 0))")
      .catch(() => undefined)
    try {
      if (previousSearchPath !== undefined) {
        await connection`SELECT set_config('search_path', ${previousSearchPath}, false)`
      }
    } finally {
      connection.release()
    }
  }
}
