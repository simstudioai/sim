import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'

/** Runs workflow tests against a disposable PostgreSQL 17 container, never an application DSN. */
const logger = createLogger('WorkflowSyncIntegration')
const root = resolve(import.meta.dir, '..')
const container = `sim-workflow-test-${generateId()}`
const fixtureEnv = { ...process.env }
for (const key of Object.keys(fixtureEnv)) {
  if (key.startsWith('DATABASE_') || key === 'MIGRATION_DATABASE_URL') delete fixtureEnv[key]
}
function run(command: string, args: string[], cwd = root, capture = false): string {
  const result = spawnSync(command, args, {
    cwd,
    env: fixtureEnv,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
  return result.stdout?.trim() ?? ''
}
let started = false
try {
  run(
    'docker',
    [
      'run',
      '--rm',
      '--detach',
      '--name',
      container,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '--publish',
      '127.0.0.1::5432',
      'pgvector/pgvector:pg17',
    ],
    root,
    true
  )
  started = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(
      'docker',
      ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'],
      { stdio: 'ignore' }
    )
    if (result.status === 0) {
      ready = true
      break
    }
    await sleep(500)
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready')
  run('docker', ['exec', container, 'createdb', '-U', 'postgres', 'sim_workflow_test'])
  run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'sim_workflow_test',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'CREATE EXTENSION vector; CREATE EXTENSION pg_trgm; CREATE EXTENSION btree_gin;',
  ])
  const endpoint = run('docker', ['port', container, '5432/tcp'], root, true)
  if (!/^127\.0\.0\.1:\d+$/.test(endpoint)) throw new Error('Unexpected fixture database endpoint')
  const databaseUrl = `postgresql://postgres@${endpoint}/sim_workflow_test`
  Object.assign(fixtureEnv, { DATABASE_URL: databaseUrl, WORKFLOW_TEST_DATABASE_URL: databaseUrl })
  run(
    'bun',
    ['--no-env-file', 'x', 'drizzle-kit', 'push', '--config=./drizzle.config.ts', '--force'],
    resolve(root, 'packages/db')
  )
  run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    'sim_workflow_test',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'SELECT count(*) FROM workspace_operation_receipt',
  ])
  run(
    'bun',
    ['--no-env-file', 'x', 'vitest', 'run', '--config', 'vitest.workflows-integration.config.ts'],
    resolve(root, 'apps/sim')
  )
} finally {
  if (started) {
    run('docker', ['stop', container], root, true)
    logger.info('Removed disposable workflow database')
  }
}
