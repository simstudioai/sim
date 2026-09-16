import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { afterAll } from 'vitest'

const databaseUrl = process.env.WORKFLOW_TEST_DATABASE_URL
if (!databaseUrl)
  throw new Error('WORKFLOW_TEST_DATABASE_URL must name a disposable local test database')
const target = new URL(databaseUrl)
if (
  !['127.0.0.1', 'localhost'].includes(target.hostname) ||
  !target.pathname.startsWith('/sim_workflow_test')
) {
  throw new Error('Workflow integration tests refuse nonlocal or nonfixture databases')
}
const environmentSource = readFileSync(new URL('./lib/core/config/env.ts', import.meta.url), 'utf8')
for (const entry of environmentSource.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm))
  delete process.env[entry[1]]
for (const key of Object.keys(process.env)) {
  if (
    key.startsWith('DATABASE_URL') ||
    key.startsWith('DATABASE_REPLICA_URL') ||
    key === 'MIGRATION_DATABASE_URL'
  )
    delete process.env[key]
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DB_TX_TRIPWIRE: 'throw',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  INTERNAL_API_BASE_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_FORCE_HOSTED: 'false',
  BILLING_ENABLED: 'false',
  FORKING_ENABLED: 'true',
  ACCESS_CONTROL_ENABLED: 'true',
  STORAGE_PROVIDER: 'local',
  OCR_PROVIDER: 'local',
  DISABLE_AUTH: 'false',
  DISABLE_TELEMETRY: 'true',
  BETTER_AUTH_SECRET: 'workflow-integration-fixture-authentication-secret',
  INTERNAL_API_SECRET: 'workflow-integration-fixture-internal-secret',
  ENCRYPTION_KEY: '0'.repeat(64),
  API_ENCRYPTION_KEY: '1'.repeat(64),
})

/** Local stand-in for the realtime process; deployment still performs its real HTTP notification. */
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
