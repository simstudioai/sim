import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import {
  clearInheritedDatabaseUrls,
  readTestDatabaseUrl,
  readTestRedisUrl,
} from '@sim/db/testing/test-infrastructure'
import Redis from 'ioredis'
import { afterAll } from 'vitest'

/**
 * Setup for `vitest run --mode integration`. Suites run against real PostgreSQL and Redis with
 * real application modules: none of the unit-test global mocks are installed here, so a suite
 * that needs a fixture declares it itself.
 */
const databaseUrl = readTestDatabaseUrl()
const redisUrl = readTestRedisUrl()
const encryptionKey = process.env.TEST_ENCRYPTION_KEY ?? '0'.repeat(64)
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
  throw new Error('TEST_ENCRYPTION_KEY must be a 64-character hexadecimal fixture key')
}

/** Never inherit an application secret or transport endpoint from the developer's shell. */
const environmentSource = readFileSync(new URL('./lib/core/config/env.ts', import.meta.url), 'utf8')
for (const entry of environmentSource.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm)) {
  delete process.env[entry[1]]
}
clearInheritedDatabaseUrls()
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
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

/**
 * Every file starts from an empty Redis database, so keys one file leaves behind never decide
 * another's outcome. Files run one at a time (`fileParallelism: false`). `readTestRedisUrl` only
 * accepts a credential-free loopback URL, and the flush additionally requires the URL to select a
 * non-zero database (`redis://127.0.0.1:6379/15`): a local Redis left on its default database 0 is
 * someone's dev data, and pointing TEST_REDIS_URL at it must fail here rather than wipe it.
 */
const redisDatabase = Number(new URL(redisUrl).pathname.slice(1) || '0')
if (!Number.isInteger(redisDatabase) || redisDatabase <= 0) {
  throw new Error(
    'TEST_REDIS_URL must select a non-zero database (e.g. redis://127.0.0.1:6379/15): every integration file flushes it'
  )
}
const redisReset = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
try {
  await redisReset.connect()
  await redisReset.flushdb()
} finally {
  redisReset.disconnect()
}

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
