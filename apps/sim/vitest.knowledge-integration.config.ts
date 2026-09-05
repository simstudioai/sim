import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

/** This suite deliberately omits vitest.setup.ts: database and authorization stay real. */
const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL
const encryptionKey = process.env.KNOWLEDGE_ACL_TEST_ENCRYPTION_KEY ?? '0'.repeat(64)
if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) {
  throw new Error(
    'KNOWLEDGE_ACL_TEST_ENCRYPTION_KEY must be a 64-character hexadecimal fixture key'
  )
}
if (!databaseUrl)
  throw new Error('Set KNOWLEDGE_ACL_TEST_DATABASE_URL to a disposable local database')
const target = new URL(databaseUrl)
if (
  !['localhost', '127.0.0.1'].includes(target.hostname) ||
  !target.pathname.startsWith('/sim_acl_test')
) {
  throw new Error('Knowledge integration tests require a local sim_acl_test database')
}

/** Never inherit an application secret or transport endpoint from the developer's shell. */
const environmentSource = readFileSync(path.resolve(__dirname, 'lib/core/config/env.ts'), 'utf8')
for (const entry of environmentSource.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*:/gm)) {
  delete process.env[entry[1]]
}
for (const key of Object.keys(process.env)) {
  if (key.startsWith('DATABASE_URL') || key.startsWith('DATABASE_REPLICA_URL'))
    delete process.env[key]
}
process.env.DATABASE_URL = databaseUrl
Object.assign(process.env, { NODE_ENV: 'test' })

export default defineConfig({
  css: { postcss: {} },
  test: {
    environment: 'node',
    include: ['lib/knowledge/__integration__/*.integration.ts'],
    setupFiles: [],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      DATABASE_URL: databaseUrl,
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      NEXT_PUBLIC_FORCE_HOSTED: 'false',
      INTERNAL_API_BASE_URL: 'http://localhost:3000',
      BILLING_ENABLED: 'false',
      KNOWLEDGE_MEMBER_ACCESS: 'true',
      CREDENTIAL_GROUPS: 'true',
      ACCESS_CONTROL_ENABLED: 'true',
      STORAGE_PROVIDER: 'local',
      OCR_PROVIDER: 'local',
      DISABLE_AUTH: 'false',
      DISABLE_TELEMETRY: 'true',
      BETTER_AUTH_SECRET: 'isolated-integration-fixture-secret-not-a-real-credential',
      ENCRYPTION_KEY: encryptionKey,
      API_ENCRYPTION_KEY: '1111111111111111111111111111111111111111111111111111111111111111',
      /** Only the opt-in disposable GitLab fixture may reach a private provider endpoint. */
      EGRESS_ALLOWED_HOSTS: process.env.GITLAB_LIVE_FIXTURE_FILE ? 'localhost' : '',
    },
  },
  resolve: {
    tsconfigPaths: true,
    alias: [
      { find: '@sim/db', replacement: path.resolve(__dirname, '../../packages/db') },
      { find: '@sim/logger', replacement: path.resolve(__dirname, '../../packages/logger/src') },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
})
