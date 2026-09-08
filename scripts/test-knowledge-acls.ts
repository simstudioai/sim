import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'

/**
 * Run with `bun scripts/test-knowledge-acls.ts` from the repository root.
 * Creates and removes its own Postgres and Redis containers; never reads an application DSN.
 * Set KNOWLEDGE_SCALE_TEST=true for the opt-in scale suite; its JSON report is saved in tmpdir.
 */
const logger = createLogger('KnowledgeAclIntegration')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const container = `sim-acl-test-${generateId()}`
const redisContainer = `${container}-redis`
const database = 'sim_acl_test_application'
const scale = process.env.KNOWLEDGE_SCALE_TEST === 'true'
const keepScaleDatabase = scale && process.env.KNOWLEDGE_SCALE_KEEP_DATABASE === 'true'
const scaleReportFile =
  process.env.KNOWLEDGE_SCALE_REPORT_FILE ?? path.join(tmpdir(), `${container}.json`)

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean } = {}
) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed (${result.status ?? result.error?.message})`)
  return result.stdout?.trim() ?? ''
}

let started = false
let redisStarted = false
try {
  run(
    'docker',
    [
      'run',
      '--rm',
      '--detach',
      ...(scale ? ['--shm-size', '3g'] : []),
      '--name',
      container,
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '--publish',
      '127.0.0.1::5432',
      'pgvector/pgvector:pg17',
    ],
    { capture: true }
  )
  started = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    /** The image's initialization server accepts Unix sockets before restarting into its final TCP server. */
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
  if (!ready) throw new Error('Disposable Postgres did not become ready')
  run('docker', ['exec', container, 'createdb', '-U', 'postgres', database])
  run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'postgres',
    '-d',
    database,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    'CREATE EXTENSION vector; CREATE EXTENSION btree_gin; CREATE EXTENSION pg_trgm',
  ])
  const endpoint = run('docker', ['port', container, '5432/tcp'], { capture: true })
  if (!/^127\.0\.0\.1:\d+$/.test(endpoint))
    throw new Error('Unexpected disposable Postgres endpoint')
  const databaseUrl = `postgresql://postgres@${endpoint}/${database}`
  if (keepScaleDatabase)
    logger.info('Retaining disposable scale database for follow-up measurements', {
      container,
      databaseUrl,
    })
  run(
    'docker',
    [
      'run',
      '--rm',
      '--detach',
      '--name',
      redisContainer,
      '--publish',
      '127.0.0.1::6379',
      'redis:8.2-alpine',
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    ],
    { capture: true }
  )
  redisStarted = true
  let redisReady = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', redisContainer, 'redis-cli', 'ping'], {
      stdio: 'ignore',
    })
    if (result.status === 0) {
      redisReady = true
      break
    }
    await sleep(500)
  }
  if (!redisReady) throw new Error('Disposable Redis did not become ready')
  const redisEndpoint = run('docker', ['port', redisContainer, '6379/tcp'], { capture: true })
  if (!/^127\.0\.0\.1:\d+$/.test(redisEndpoint))
    throw new Error('Unexpected disposable Redis endpoint')
  const environment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    KNOWLEDGE_ACL_TEST_DATABASE_URL: databaseUrl,
    KNOWLEDGE_ACL_TEST_REDIS_URL: `redis://${redisEndpoint}`,
    ...(scale ? { KNOWLEDGE_SCALE_REPORT_FILE: scaleReportFile } : {}),
  }
  run('bunx', ['drizzle-kit', 'push', '--config=./drizzle.config.ts', '--force'], {
    cwd: path.join(root, 'packages/db'),
    env: environment,
  })
  run('bun', ['./scripts/reconcile-credential-group-resource-policies.ts'], {
    cwd: path.join(root, 'packages/db'),
    env: environment,
  })
  run(
    'bunx',
    [
      'vitest',
      'run',
      '--mode',
      'integration',
      ...(scale ? ['lib/knowledge/__integration__/scale.integration.ts'] : []),
    ],
    {
      cwd: path.join(root, 'apps/sim'),
      env: environment,
    }
  )
  if (!scale)
    run(
      'bunx',
      [
        'vitest',
        'run',
        'lib/knowledge/access/predicate.postgres.test.ts',
        'lib/knowledge/application/search-index.postgres.test.ts',
        'lib/knowledge/connectors/external-directory.postgres.test.ts',
      ],
      {
        cwd: path.join(root, 'apps/sim'),
        env: environment,
      }
    )
  logger.info(
    scale
      ? 'Opt-in knowledge scale measurements passed'
      : 'Real ingestion, application access, ACL persistence, shared provider admission, and additive migration tests passed'
  )
  if (scale) logger.info('Scale query plans and measurements', { reportFile: scaleReportFile })
} finally {
  try {
    if (redisStarted) run('docker', ['stop', redisContainer], { capture: true })
  } finally {
    if (started && !keepScaleDatabase) run('docker', ['stop', container], { capture: true })
  }
}
