import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import {
  abortSearchRetirement,
  advanceSearchRetirement,
  beginSearchRetirementPurge,
  cutoverSearchRetirement,
  finalizeSearchRetirement,
  getSearchRetirementStatus,
  initializeSearchRetirement,
  RetireSearchHealthError,
  readSearchRetirementHealth,
  readSearchRetirementHealthLimits,
  SearchRetirementError,
} from '@sim/db/maintenance'
import { createLogger, LogLevel } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import postgres from 'postgres'

class RetirementCommandError extends Error {}

const logger = createLogger('SearchDataRetirement', { enabled: true, logLevel: LogLevel.INFO })
const HELP = `Operator-only indexed Search retirement. No work runs on deployment.

bun --no-env-file packages/db/scripts/retire-indexed-search.ts <command> [options]

Commands:
  identity     Print the non-secret connection fingerprint for the health policy/collector.
  status       Read progress; never initialize or resume work.
  prepare      Create empty indexed replacement and capture writes (requires --ack-release-drained).
  run          Advance bounded pages; stops at each manual gate (default: one page).
  cutover      Attempt NOWAIT swap after validation (requires --ack-release-drained).
  begin-purge  Retire the backup and allow chunk deletion (requires --ack-retire-backup).
  finalize     Remove capture after deletion and a separate DDL health clearance.
  abort        Remove capture and discard the replacement before cutover.

Every write except abort requires --health-file PATH --health-policy PATH.
Policy databaseId must equal the identity command's fingerprint.
Run options: --page-size 25 (1–100), --pages 1 (1–120), --seconds 60 (1–600).
A fixed pause of at least 5 seconds follows each page. Timeouts stop; no automatic retry.
Connection: MIGRATION_DATABASE_URL, PostgreSQL 17+, verified PlanetScale primary on port 5432.
Other endpoints are refused; loopback databases with a test name segment are for local fixtures only.

Deploy the code-removal release and drain old workers first. Then:
  prepare -> run until ready -> cutover -> verify behavior -> begin-purge
  -> run until finalize -> finalize. Repeat run if late writes return the phase to purge.
Start with default one-page runs and watch telemetry before requesting longer runs.
Before begin-purge, verify ordinary-KB retrieval, ACL denials, connector ingestion and live Search.
Reads use the old projection until cutover. The retained backup is not an instant rollback.
Cutover requires pg_read_all_stats and no old snapshots; never automatically retry DDL gates.
Abort, backup removal and finalization cap implicit DROP lock waits at 1 ms.
After retirement starts, use versioned migrations; db:push would restore old projection machinery.

Health files are UTF-8 JSON, at most 8 KiB, atomically refreshed by trusted telemetry.
Sample fields: observedAt (oldest metric timestamp, UTC ISO), databaseId, healthy,
  maintenanceAllowed, cutoverAllowed, replicaLagBytes, replicaLagSeconds,
  walBytesPerSecond, databaseP95Ms, cpuPercent, freeStorageBytes.
Policy fields: databaseId, maxReplicaLagBytes, maxReplicaLagSeconds, maxWalBytesPerSecond,
  maxDatabaseP95Ms, maxCpuPercent, minFreeStorageBytes, maxSampleAgeMs (at most 30000).
Choose limits from actual capacity and latency requirements; missing/stale telemetry stops work.
Use worst replica lag and CPU, and minimum free storage; healthy includes application error/latency checks.
Set cutoverAllowed only after primary and replica snapshots are clear for DDL.
Pacing limits load but cannot eliminate latency or replica-conflict risk.`

function integerOption(value: string | undefined, fallback: number, ceiling: number): number {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > ceiling) {
    throw new RetirementCommandError(`Expected an integer between 1 and ${ceiling}`)
  }
  return parsed
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean', default: false },
      'health-file': { type: 'string' },
      'health-policy': { type: 'string' },
      'page-size': { type: 'string' },
      pages: { type: 'string' },
      seconds: { type: 'string' },
      'ack-release-drained': { type: 'boolean', default: false },
      'ack-retire-backup': { type: 'boolean', default: false },
    },
  })
  if (values.help || positionals.length === 0) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  const [command] = positionals
  if (
    positionals.length !== 1 ||
    ![
      'identity',
      'status',
      'prepare',
      'run',
      'cutover',
      'begin-purge',
      'finalize',
      'abort',
    ].includes(command)
  ) {
    throw new RetirementCommandError('Unknown command; use --help')
  }
  const rawUrl = process.env.MIGRATION_DATABASE_URL
  if (!rawUrl)
    throw new RetirementCommandError(
      'MIGRATION_DATABASE_URL is required; there is no application DSN fallback'
    )
  const url = new URL(rawUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new RetirementCommandError('Expected a PostgreSQL URL')
  if (!url.username || !url.pathname.slice(1)) {
    throw new RetirementCommandError('The connection URL must include its role and database name')
  }
  const localFixture =
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
    /(^|_)test(_|$)/.test(decodeURIComponent(url.pathname.slice(1)))
  const hosted =
    /^[a-z0-9-]+\.(?:pg|horizon)\.psdb\.cloud$/.test(url.hostname) &&
    (url.port || '5432') === '5432' &&
    !decodeURIComponent(url.username).includes('|')
  if (!hosted && !localFixture) {
    throw new RetirementCommandError(
      'Use a direct PlanetScale primary endpoint on port 5432; unverified endpoints and poolers are unsupported'
    )
  }
  if (
    [...url.searchParams.keys()].some(
      (key) => !['sslmode', 'sslrootcert', 'sslnegotiation'].includes(key)
    )
  ) {
    throw new RetirementCommandError(
      'Connection overrides are unsupported; only TLS URL parameters are allowed'
    )
  }
  if (
    hosted &&
    (url.searchParams.get('sslmode') !== 'verify-full' ||
      url.searchParams.get('sslrootcert') !== 'system')
  ) {
    throw new RetirementCommandError(
      'PlanetScale requires sslmode=verify-full and sslrootcert=system'
    )
  }
  const databaseId = createHash('sha256')
    .update(
      JSON.stringify([url.hostname.toLowerCase(), url.port || '5432', url.pathname, url.username])
    )
    .digest('hex')
  if (command === 'identity') {
    process.stdout.write(`${databaseId}\n`)
    return
  }
  const pageSize = integerOption(values['page-size'], 25, 100)
  const pages = integerOption(values.pages, 1, 120)
  const budgetMs = integerOption(values.seconds, 60, 600) * 1_000
  if (['prepare', 'cutover'].includes(command) && !values['ack-release-drained']) {
    throw new RetirementCommandError(
      'Confirm the code-removal release is fully deployed and old workers/maintenance jobs drained with --ack-release-drained'
    )
  }
  if (command === 'begin-purge' && !values['ack-retire-backup']) {
    throw new RetirementCommandError(
      'Confirm ordinary KB retrieval and live Search after cutover with --ack-retire-backup'
    )
  }
  let checkHealth = async () => {}
  if (!['status', 'abort'].includes(command)) {
    const healthFile = values['health-file']
    const policyFile = values['health-policy']
    if (!healthFile || !policyFile)
      throw new RetirementCommandError('--health-file and --health-policy are required')
    const limits = await readSearchRetirementHealthLimits(policyFile)
    if (limits.databaseId !== databaseId) {
      throw new RetirementCommandError('Health policy does not match this database connection')
    }
    checkHealth = async () => {
      await readSearchRetirementHealth(healthFile, limits, {
        cutover: ['cutover', 'begin-purge', 'finalize'].includes(command),
      })
    }
    await checkHealth()
  }
  const sql = postgres(rawUrl, {
    port: Number(url.port || '5432'),
    ssl: hosted ? 'verify-full' : false,
    max: 1,
    prepare: false,
    connect_timeout: 5,
    max_lifetime: null,
    connection: {
      application_name: 'sim-search-data-retirement',
      statement_timeout: 2_000,
      lock_timeout: 100,
      idle_in_transaction_session_timeout: 5_000,
    },
    onnotice: () => undefined,
    onclose: () => {
      void sql.end({ timeout: 0 }).catch(() => undefined)
    },
  })
  try {
    if (command === 'status') {
      logger.info('Search retirement status', { progress: await getSearchRetirementStatus(sql) })
      return
    }
    const [{ writable }] = await sql<{ writable: boolean }[]>`
      SELECT NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS writable`
    if (!writable)
      throw new RetirementCommandError('Maintenance requires a writable primary connection')
    const [{ acquired }] = await sql<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtextextended('sim:search-retirement-maintenance', 0)) AS acquired`
    if (!acquired)
      throw new RetirementCommandError('Another retirement or index-maintenance command is running')
    await checkHealth()
    if (command === 'prepare') await initializeSearchRetirement(sql)
    else if (command === 'cutover') await cutoverSearchRetirement(sql)
    else if (command === 'begin-purge') await beginSearchRetirementPurge(sql)
    else if (command === 'finalize') await finalizeSearchRetirement(sql)
    else if (command === 'abort') await abortSearchRetirement(sql)
    else {
      const started = performance.now()
      for (let page = 0; page < pages && performance.now() - started < budgetMs; page++) {
        await checkHealth()
        const before = performance.now()
        const progress = await advanceSearchRetirement(sql, { pageSize })
        logger.info('Search retirement page committed', { page: page + 1, progress })
        if (['ready', 'cutover', 'finalize', 'done'].includes(progress.phase)) break
        await sleep(Math.max(5_000, (performance.now() - before) * 9))
      }
    }
    logger.info('Search retirement command finished', {
      progress: await getSearchRetirementStatus(sql),
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

try {
  await main()
} catch (error) {
  // PostgreSQL errors may contain row values or credentials; never log their query, detail or stack.
  const code = getPostgresErrorCode(error)
  logger.error('Search retirement stopped; committed pages remain resumable', {
    reason:
      error instanceof RetireSearchHealthError ||
      error instanceof RetirementCommandError ||
      error instanceof SearchRetirementError
        ? error.message
        : code
          ? 'Database refused the operation'
          : 'Preflight or command failed; use --help to check options',
    ...(code ? { code } : {}),
  })
  process.exitCode = 1
}
