import { readFile } from 'node:fs/promises'
import { getPostgresErrorCode } from '@sim/utils/errors'
import type { Sql } from 'postgres'

/** Installs the same bounded, replayable contract for migrations and fresh schema pushes. */
export async function enforceProjectMembership(sql: Sql): Promise<void> {
  const source = await readFile(new URL('./project-membership.sql', import.meta.url), 'utf8')
  const connection = await sql.reserve()
  try {
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
    connection.release()
  }
}
