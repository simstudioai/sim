import {
  clearInheritedDatabaseUrls,
  readTestDatabaseUrl,
  readTestRedisUrl,
} from '@sim/db/testing/test-infrastructure'

const redisUrl = readTestRedisUrl()
if (!redisUrl) throw new Error('Realtime integration tests require disposable TEST_REDIS_URL')

clearInheritedDatabaseUrls()
Object.assign(process.env, {
  NODE_ENV: 'test',
  SIM_DB_ROLE: 'realtime',
  DATABASE_URL: readTestDatabaseUrl(),
  REDIS_URL: redisUrl,
  BETTER_AUTH_URL: 'http://localhost:3000',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'isolated-realtime-fixture-secret-not-a-real-credential',
  INTERNAL_API_SECRET: 'isolated-realtime-fixture-internal-secret',
})
