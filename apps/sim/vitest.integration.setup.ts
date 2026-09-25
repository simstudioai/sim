import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readTestDatabaseUrl, readTestRedisUrl } from '@sim/db/testing/test-infrastructure'
import { afterAll } from 'vitest'

/**
 * Setup for `vitest run --mode integration`. Suites run against real PostgreSQL (and Redis when
 * `TEST_REDIS_URL` is set) with real application modules: none of the unit-test global mocks are
 * installed here, so a suite that needs a fixture declares it itself.
 */
const databaseUrl = readTestDatabaseUrl()
readTestRedisUrl()
const encryptionKey = process.env.TEST_ENCRYPTION_KEY ?? '0'.repeat(64)
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
  throw new Error('TEST_ENCRYPTION_KEY must be a 64-character hexadecimal fixture key')
}

/** Never inherit an application secret or transport endpoint from the developer's shell. */
const environmentSource = readFileSync(new URL('./lib/core/config/env.ts', import.meta.url), 'utf8')
for (const entry of environmentSource.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm)) {
  delete process.env[entry[1]]
}
for (const key of Object.keys(process.env)) {
  if (
    key.startsWith('DATABASE_URL') ||
    key.startsWith('DATABASE_REPLICA_URL') ||
    key === 'MIGRATION_DATABASE_URL'
  ) {
    delete process.env[key]
  }
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DB_TX_TRIPWIRE: 'throw',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_FORCE_HOSTED: 'false',
  INTERNAL_API_BASE_URL: 'http://localhost:3000',
  BILLING_ENABLED: 'false',
  FORKING_ENABLED: 'true',
  KNOWLEDGE_MEMBER_ACCESS: 'true',
  CREDENTIAL_GROUPS: 'true',
  ACCESS_CONTROL_ENABLED: 'true',
  STORAGE_PROVIDER: 'local',
  OCR_PROVIDER: 'local',
  DISABLE_AUTH: 'false',
  DISABLE_TELEMETRY: 'true',
  BETTER_AUTH_SECRET: 'isolated-integration-fixture-secret-not-a-real-credential',
  INTERNAL_API_SECRET: 'isolated-integration-fixture-internal-secret',
  ENCRYPTION_KEY: encryptionKey,
  API_ENCRYPTION_KEY: '1'.repeat(64),
  /** Only the opt-in disposable GitLab fixture may reach a private provider endpoint. */
  EGRESS_ALLOWED_HOSTS: process.env.GITLAB_LIVE_FIXTURE_FILE ? 'localhost' : '',
})

/** Local stand-in for the realtime process; deployments still perform their real HTTP notification. */
const realtime = createServer(async (request, response) => {
  for await (const _chunk of request) {
  }
  if (request.headers['x-api-key'] !== process.env.INTERNAL_API_SECRET) {
    response.writeHead(401).end()
    return
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ success: true }))
})
await new Promise<void>((resolve) => realtime.listen(0, '127.0.0.1', resolve))
const address = realtime.address()
if (!address || typeof address === 'string') throw new Error('Realtime fixture failed to bind')
process.env.SOCKET_SERVER_URL = `http://127.0.0.1:${address.port}`
afterAll(
  () =>
    new Promise<void>((resolve, reject) => {
      realtime.close((error) => (error ? reject(error) : resolve()))
      realtime.closeAllConnections()
    })
)
