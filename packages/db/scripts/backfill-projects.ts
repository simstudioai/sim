#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { backfillProjects, readProjectBackfillPlan } from '@sim/db/project-backfill'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import postgres from 'postgres'

const logger = createLogger('ProjectBackfillCommand', { enabled: true, logLevel: 'INFO' })
const HELP = `Operator-only Project backfill. Deployment only creates the additive tables.

bun --no-env-file packages/db/scripts/backfill-projects.ts <command> [options]

Commands:
  identity   Print the non-secret database fingerprint; no database writes.
  dry-run    Discover and validate families; write the plan/report.
  apply      Apply --from-file PLAN from a completed, conflict-free dry-run.
  verify     Independently reconcile all environments and Projects; nonzero unless ready.

Required environment: PROJECT_BACKFILL_DATABASE_URL (direct primary connection).
Reports: PROJECT_BACKFILL_REPORT_PATH (required except identity).
Apply requires --writers-drained --project-writers-enabled --release-revision REVISION
and --database-id FINGERPRINT. These are operator assertions, not fleet verification.
Deploy first with PROJECT_WRITES_ENABLED=false and PROJECT_API_ENABLED=false.
Drain old code, enable Project writers on every compatible instance, then backfill.
Keep the Project API off until verification and later contract enforcement.
Once Project data exists, never roll back to code that predates Project support.
Options: --from-file PATH, --seconds 600 (1–3600), --max-family-size 1000 (1–10000).
Run with compatible writers deployed. Pause lineage/ownership writes during apply.
Short NOWAIT table locks exclude concurrent changes during each family transaction.
Interrupted/failed apply: inspect the report, then rerun the SAME dry-run artifact.
Connection loss during writes is never automatically retried; verify the committed state.
No run enables Project consumers or installs the deferred contract constraints.`

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      help: { type: 'boolean' },
      'from-file': { type: 'string' },
      'writers-drained': { type: 'boolean' },
      'project-writers-enabled': { type: 'boolean' },
      'release-revision': { type: 'string' },
      'database-id': { type: 'string' },
      seconds: { type: 'string', default: '600' },
      'max-family-size': { type: 'string', default: '1000' },
    },
  })
  if (values.help) {
    process.stdout.write(`${HELP}\n`)
    return
  }
  const mode = positionals[0] ?? 'dry-run'
  if (positionals.length > 1 || !['identity', 'dry-run', 'apply', 'verify'].includes(mode))
    throw new Error('Unknown command; use --help')
  const rawUrl = process.env.PROJECT_BACKFILL_DATABASE_URL
  if (!rawUrl)
    throw new Error('Set PROJECT_BACKFILL_DATABASE_URL explicitly; no application DSN fallback')
  const url = new URL(rawUrl)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    url.pathname.length < 2
  )
    throw new Error('Expected a direct PostgreSQL database URL')
  const databaseId = createHash('sha256')
    .update(
      JSON.stringify([
        url.hostname.toLowerCase(),
        url.port || '5432',
        decodeURIComponent(url.pathname),
      ])
    )
    .digest('hex')
  if (mode === 'identity') {
    process.stdout.write(`${databaseId}\n`)
    return
  }
  if (mode !== 'dry-run' && mode !== 'apply' && mode !== 'verify')
    throw new Error('Invalid command')
  const reportPath = process.env.PROJECT_BACKFILL_REPORT_PATH
  if (!reportPath) throw new Error('Set PROJECT_BACKFILL_REPORT_PATH explicitly')
  const releaseRevision = values['release-revision']?.trim() ?? ''
  if (
    mode === 'apply' &&
    (!values['writers-drained'] ||
      !values['project-writers-enabled'] ||
      !releaseRevision ||
      values['database-id'] !== databaseId ||
      !values['from-file'])
  )
    throw new Error(
      'Apply requires --writers-drained, --project-writers-enabled, --release-revision, matching --database-id, and --from-file'
    )
  if (
    mode !== 'apply' &&
    (values['writers-drained'] ||
      values['project-writers-enabled'] ||
      values['release-revision'] ||
      values['from-file'])
  )
    throw new Error('Apply-only options used with read-only mode')
  const operatorAssertions =
    mode === 'apply'
      ? {
          oldWritersDrained: true,
          projectWritersEnabled: true,
          releaseRevision,
        }
      : undefined
  const inputPath = values['from-file']
  if (inputPath && resolve(inputPath) === resolve(reportPath))
    throw new Error('Keep the dry-run plan and apply report in separate files')
  const plan = inputPath
    ? await (async () => {
        if ((await stat(inputPath)).size > 32 * 1024 * 1024)
          throw new Error('Dry-run artifact exceeds 32 MiB')
        return readProjectBackfillPlan(JSON.parse(await readFile(inputPath, 'utf8')), databaseId)
      })()
    : undefined
  const sql = postgres(rawUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 0,
    max_lifetime: null,
    connection: {
      application_name: 'sim-project-backfill',
      statement_timeout: 30_000,
      lock_timeout: 2000,
    },
  })
  let interrupted = false
  const stop = () => {
    interrupted = true
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    // Preflight the report destination before opening a transaction that can write.
    const partialPath = `${reportPath}.${process.pid}.partial`
    await writeFile(
      partialPath,
      JSON.stringify({
        databaseId,
        mode,
        operatorAssertions,
        completed: false,
        ready: false,
        stopped: 'Starting',
      }),
      { mode: 0o600 }
    )
    await rename(partialPath, reportPath)
    const report = await backfillProjects(sql, {
      mode,
      databaseId,
      plan,
      seconds: Number(values.seconds),
      maxFamilySize: Number(values['max-family-size']),
      shouldStop: () => interrupted,
      onProgress: async (progress) => {
        await writeFile(partialPath, JSON.stringify({ ...progress, operatorAssertions }, null, 2), {
          mode: 0o600,
        })
        await rename(partialPath, reportPath)
        logger.info('Project backfill progress', {
          mode,
          databaseId,
          scanned: progress.scanned,
          families: progress.families,
          createdProjects: progress.createdProjects,
          assignedWorkspaces: progress.assignedWorkspaces,
          conflicts: progress.conflicts.length,
          retries: progress.retries,
          completed: progress.completed,
        })
      },
    })
    if (!report.completed || report.conflicts.length || (mode === 'verify' && !report.ready))
      process.exitCode = 1
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    await sql.end({ timeout: 5 })
  }
}

try {
  await main()
} catch (error) {
  const code = getPostgresErrorCode(error)
  // Database messages can contain connection details or row values; retain SQLSTATE, not the payload.
  logger.error('Project backfill failed', {
    error: code
      ? `Database error ${code}; inspect the report and reconcile before retrying`
      : getErrorMessage(error),
  })
  process.exitCode = 1
}
