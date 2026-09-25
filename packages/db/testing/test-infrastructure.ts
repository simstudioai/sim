/**
 * Environment contract for the real-infrastructure test layer (`*.integration.ts`).
 *
 * `TEST_DATABASE_URL` names a disposable PostgreSQL database and `TEST_REDIS_URL` an optional
 * disposable Redis. Both must use a loopback host, and the database name must contain a `test`
 * segment (`sim_test`, `sim_test_knowledge`, `sim_workflow_test`), so a stray shell variable can
 * never point destructive fixtures at a real database. Every integration run's setup file calls
 * these readers before any suite loads.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const DISPOSABLE_DATABASE_NAME = /(^|_)test(_|$)/

/** Rejects a PostgreSQL URL that is not a loopback, disposable test database. */
export function assertDisposableTestDatabaseUrl(value: string): URL {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('TEST_DATABASE_URL must be a postgres:// or postgresql:// URL')
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error('TEST_DATABASE_URL must use a loopback host (localhost, 127.0.0.1, [::1])')
  }
  const database = decodeURIComponent(url.pathname.slice(1))
  if (!DISPOSABLE_DATABASE_NAME.test(database)) {
    throw new Error(
      `TEST_DATABASE_URL must name a disposable database with a "test" segment, got "${database}"`
    )
  }
  return url
}

/** Returns the validated `TEST_DATABASE_URL`, failing loudly when it is missing. */
export function readTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL
  if (!value) {
    throw new Error('Set TEST_DATABASE_URL to a disposable local PostgreSQL test database')
  }
  assertDisposableTestDatabaseUrl(value)
  return value
}

/** Returns the validated `TEST_REDIS_URL`, or undefined when the run has no Redis. */
export function readTestRedisUrl(): string | undefined {
  const value = process.env.TEST_REDIS_URL
  if (!value) return undefined
  const url = new URL(value)
  if (
    url.protocol !== 'redis:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error('TEST_REDIS_URL must be a credential-free redis:// URL on a loopback host')
  }
  return value
}
