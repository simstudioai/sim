import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

const logger = createLogger('SocketPreflight')

/**
 * Maximum attempts for the schema canary when the database is merely unreachable.
 * Connection-class failures are retried; schema-class failures fail immediately.
 */
const MAX_CONNECT_ATTEMPTS = 5

/**
 * Postgres SQLSTATE codes meaning the deployed image's compiled schema disagrees
 * with the live database (undefined column, table, or function). These never
 * self-heal, so retrying only delays an inevitable startup failure.
 */
const SCHEMA_MISMATCH_CODES = new Set(['42703', '42P01', '42883'])

/**
 * Walks the `cause` chain so a SQLSTATE code is found even when drizzle wraps the
 * driver error (the code commonly lives on the inner `cause`, not the outer throw).
 */
function isSchemaMismatch(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && SCHEMA_MISMATCH_CODES.has(code)) {
      return true
    }
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * Verifies, before the server accepts traffic, that the deployed image's schema
 * is compatible with the live database — throwing if it is not.
 *
 * Every socket is authorized against the `workflow` table through a full-row
 * drizzle projection. If the image's compiled schema is ahead of (or behind) the
 * database — e.g. a column dropped by a migration the image predates — that query
 * fails on every request and silently breaks persistence, yet the process stays
 * up and the shallow `/health` probe keeps returning 200. The fleet looks healthy
 * while serving nothing.
 *
 * Running one representative query at startup turns that latent, per-request
 * failure into an immediate startup failure: the throw propagates to the server
 * entrypoint, the task exits non-zero and never becomes healthy, and the deploy's
 * health gate never flips — so CodeDeploy auto-rolls-back instead of shifting
 * traffic onto broken tasks.
 *
 * Deliberately invoked once at startup and never from the per-probe load-balancer
 * health check: a deep dependency check on every probe would let a transient
 * database blip mass-terminate the whole fleet (cascading failure).
 *
 * @throws when the schema is incompatible, or the database stays unreachable
 *   across {@link MAX_CONNECT_ATTEMPTS} attempts.
 */
export async function assertSchemaCompatibility(): Promise<void> {
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
    try {
      await db.select().from(workflow).limit(1)
      logger.info('Schema-compatibility check passed')
      return
    } catch (error) {
      lastError = error

      if (isSchemaMismatch(error)) {
        throw new Error(
          `Deployed image is incompatible with the live database schema: ${getErrorMessage(error)}`
        )
      }

      if (attempt === MAX_CONNECT_ATTEMPTS) {
        break
      }

      const delay = backoffWithJitter(attempt, null)
      logger.warn(
        `Schema-compatibility check could not reach the database (attempt ${attempt}/${MAX_CONNECT_ATTEMPTS}), retrying in ${Math.round(delay)}ms`,
        getErrorMessage(error)
      )
      await sleep(delay)
    }
  }

  throw new Error(
    `Schema-compatibility check failed after ${MAX_CONNECT_ATTEMPTS} attempts — database unreachable: ${getErrorMessage(lastError)}`
  )
}
