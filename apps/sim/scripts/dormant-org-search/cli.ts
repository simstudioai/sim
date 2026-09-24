import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import postgres, { type Sql } from 'postgres'

/**
 * Whether a run may write. Every script in this directory reads and reports unless the operator
 * passes `--execute`; `--dry-run` is accepted for explicitness, and passing both is refused rather
 * than resolved in either direction.
 */
export function resolveExecuteFlag(flags: { execute?: boolean; 'dry-run'?: boolean }): boolean {
  if (flags.execute && flags['dry-run']) {
    throw new Error('Pass either --execute or --dry-run, not both')
  }
  return flags.execute === true
}

/** Parses a positive integer flag, refusing anything a typo could turn into an unbounded run. */
export function parsePositiveInteger(name: string, value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer, got ${value}`)
  }
  return parsed
}

/** Parses a non-negative integer flag, such as a pause in milliseconds. */
export function parseNonNegativeInteger(name: string, value: string | undefined, fallback: number) {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer, got ${value}`)
  }
  return parsed
}

/**
 * One dedicated connection on the migrations role (`MIGRATION_DATABASE_URL`, else `DATABASE_URL`),
 * the role that owns the knowledge tables and can therefore drop their triggers, truncate, reindex
 * and vacuum them. One connection keeps session settings on the connection that uses them.
 */
export function connectMigrationRole(): Sql {
  const url = resolveMigrationDatabaseUrl()
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required')
  return postgres(url, {
    max: 1,
    max_lifetime: null,
    onnotice: () => undefined,
    connection: { application_name: 'sim-dormant-org-search-ops' },
  })
}
