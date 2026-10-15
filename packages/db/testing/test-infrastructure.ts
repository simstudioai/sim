/**
 * Environment contract for the real-infrastructure test layer (`*.integration.ts`).
 *
 * `TEST_DATABASE_URL` names a disposable PostgreSQL database and `TEST_REDIS_URL` a disposable
 * Redis (optional locally, required in CI). Both must use a loopback host, and the database name
 * must contain a `test` segment (`sim_test`, `sim_test_knowledge`, `sim_workflow_test`), so a stray
 * shell variable can never point destructive fixtures at a real database. Every integration run's
 * setup file calls these readers before any suite loads.
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

/**
 * Deletes every inherited database URL. `@sim/db` prefers a role-specific `DATABASE_URL_<ROLE>`
 * over `DATABASE_URL`, so one left in the shell would bypass the test database.
 */
export function clearInheritedDatabaseUrls(): void {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('DATABASE_URL') ||
      key.startsWith('DATABASE_REPLICA_URL') ||
      key === 'MIGRATION_DATABASE_URL'
    ) {
      delete process.env[key]
    }
  }
}

/**
 * Returns the validated `TEST_REDIS_URL`, or undefined when a local run has no Redis. In CI a
 * missing value throws: every Redis-gated suite would otherwise pass by skipping.
 *
 * Any query string is rejected, not just `username`/`password` params: Redis clients read
 * connection options (credentials, TLS, sentinels) from it, so an allowlist would have to track
 * each client's option set, and a local disposable Redis never needs one.
 */
export function readTestRedisUrl(): string | undefined {
  const value = process.env.TEST_REDIS_URL
  if (!value) {
    if (process.env.CI) {
      throw new Error(
        'Set TEST_REDIS_URL in CI: Redis-gated integration suites would silently skip'
      )
    }
    return undefined
  }
  const url = new URL(value)
  if (
    url.protocol !== 'redis:' ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.search
  ) {
    throw new Error(
      'TEST_REDIS_URL must be a credential-free redis:// URL on a loopback host with no query string'
    )
  }
  return value
}
