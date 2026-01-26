import { execFileSync } from 'child_process'
import path from 'path'
import { createLogger } from '@sim/logger'
import postgres from 'postgres'

const logger = createLogger('IntegrationTestGlobalSetup')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const requireEnv = (name: string) => {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} for IRIS integration tests`)
  }
  return process.env[name] as string
}

const waitForDatabase = async (databaseUrl: string) => {
  const client = postgres(databaseUrl, {
    prepare: false,
    fetch_types: false, // Skip pg_type introspection for IRIS
    max: 1,
    idle_timeout: 5,
    connect_timeout: 5,
  })

  try {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await client`SELECT 1`
        logger.info('IRIS database is ready')
        return
      } catch (error) {
        logger.warn(`Waiting for IRIS database (attempt ${attempt}/30)`, {
          error: error instanceof Error ? error.message : 'Unknown error',
        })
        await sleep(1000)
      }
    }
  } finally {
    await client.end({ timeout: 5 })
  }

  throw new Error('IRIS database did not become ready in time')
}

export async function setup() {
  const env = process.env as Record<string, string | undefined>

  env.NODE_ENV = env.NODE_ENV ?? 'test'
  env.DB_TYPE = env.DB_TYPE ?? 'iris'
  env.DB_DEFAULT_SCHEMA = env.DB_DEFAULT_SCHEMA ?? 'SQLUser'
  env.DB_METADATA_SCHEMA = env.DB_METADATA_SCHEMA ?? 'drizzle'
  env.DATABASE_POOL_MAX = env.DATABASE_POOL_MAX ?? '1'
  env.DISABLE_AUTH = 'true'

  if (env.DB_TYPE !== 'iris') {
    throw new Error('IRIS integration tests require DB_TYPE=iris')
  }

  const databaseUrl = requireEnv('DATABASE_URL')

  logger.info('Waiting for IRIS database connection')
  await waitForDatabase(databaseUrl)

  logger.info('Running IRIS migrations via custom script')
  execFileSync('bun', ['run', path.resolve(__dirname, '../../scripts/apply-iris-migration.ts')], {
    cwd: path.resolve(__dirname, '../../packages/db'),
    env: process.env,
    stdio: 'inherit',
  })
}

export async function teardown() {
  logger.info('Integration test teardown complete')
}
