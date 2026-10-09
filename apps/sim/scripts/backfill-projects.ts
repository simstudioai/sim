#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import { link, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  assertProjectBackfillDatabase,
  assignProjectBackfillBatch,
  discoverProjectBackfill,
  ProjectBackfillBusy,
  ProjectBackfillConflict,
  projectBackfillDatabaseId,
  verifyProjectBackfill,
} from '@sim/db/maintenance/project-backfill'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { createLogger } from '@sim/logger'
import { describeError, getTransientDatabaseFailure } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import postgres from 'postgres'
import { z } from 'zod'

const logger = createLogger('ProjectBackfillOperator', { enabled: true, logLevel: 'INFO' })
const text = z.string().min(1).max(1024)
const member = z
  .object({
    id: text,
    parentId: text.nullable(),
    ownerId: text,
    organizationId: text.nullable(),
    archivedAt: text.nullable(),
    projectId: text.nullable(),
  })
  .strict()
const manifestSchema = z
  .object({
    version: z.literal(1),
    databaseId: text,
    createdAt: text,
    families: z
      .array(z.object({ rootId: text, members: z.array(member).min(1).max(1000) }).strict())
      .max(250000),
    repairs: z
      .array(
        z
          .object({
            workspaceId: text,
            archivedAt: text,
            workflowIds: z.array(text).min(1).max(1000),
          })
          .strict()
      )
      .max(250000),
    conflicts: z.array(z.object({ id: text, reason: text }).strict()).max(250000),
  })
  .strict()
const progressSchema = z
  .object({
    version: z.literal(1),
    manifestHash: text,
    databaseId: text,
    codeHash: text,
    runId: text,
    nextIndex: z.number().int().min(0),
    deferred: z.array(z.number().int().min(0)),
    repairsCompleted: z.array(text),
    assigned: z.number().int().min(0),
    projectsCreated: z.number().int().min(0),
    alreadyAssigned: z.number().int().min(0),
    batches: z.number().int().min(0),
    problems: z.array(z.object({ id: text, reason: text })),
    status: z.enum(['running', 'paused', 'incomplete', 'complete', 'failed']),
    updatedAt: text,
  })
  .strict()

async function readJson(path: string): Promise<unknown> {
  if ((await stat(path)).size > 128 * 1024 * 1024)
    throw new Error('Backfill artifact exceeds 128 MiB')
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path: string, value: unknown, replace = true): Promise<void> {
  const temporary = `${path}.${generateId()}.partial`
  const file = await open(temporary, 'wx', 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
  try {
    if (replace) await rename(temporary, path)
    else await link(temporary, path)
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    })
  }
}

function boundedInteger(value: string | undefined, fallback: number, max: number): number {
  const result = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > max)
    throw new Error(`Expected integer between 1 and ${max}`)
  return result
}

async function main() {
  const { positionals, values } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      report: { type: 'string' },
      'batch-size': { type: 'string' },
      'max-batches': { type: 'string' },
      seconds: { type: 'string' },
      'pause-ms': { type: 'string' },
      'ack-release-drained': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help || !positionals.length) {
    process.stdout.write(`Operator-controlled Project preparation; never runs automatically on deployment.\n
From apps/sim: bun --no-env-file scripts/backfill-projects.ts <command> [options]\n
plan    Read-only discovery; atomically writes a new --manifest PATH (never overwrites).\nrepair  Repair only archived environments listed in --manifest; requires --report PATH.\napply   Assign reviewed families from --manifest; requires --report PATH.\nverify  Validate the database and repair completion; requires --manifest and --report.\nstatus  Read --report; does not connect or resume.\n
Writes require MIGRATION_DATABASE_URL pointing directly to the primary and --ack-release-drained.\nDeploy #8830 and verify old servers/workers drained first. Keep the reviewed manifest and report\nin durable private job storage. Review conflicts and repairs before repair/apply. Repair requires\nthe app runtime environment (DATABASE_URL must target the same database) for provider cleanup.\n
Defaults: --batch-size 50 (1–50), --max-batches 100 (1–10000), --seconds 60 (1–3600), --pause-ms 100 (1–60000).\nA budget limits scheduling. Transactions use 3s statement limits and a 5s total limit on PG17+,\notherwise a 5s idle-transaction limit on PG16. Reuse the same report\nto resume; lost reports can be recreated safely from the same manifest. Changed families need a\nnew plan/report. Complete verify plus deployment evidence is required before #8590 enforcement.\nExit: 0 complete, 2 paused/incomplete, 1 failure. Never run db:migrate to launch this tool.\n`)
    return
  }
  const [command] = positionals
  if (
    positionals.length !== 1 ||
    !['plan', 'repair', 'apply', 'verify', 'status'].includes(command)
  )
    throw new Error('Unknown command; use --help')
  const manifestPath = values.manifest ? resolve(values.manifest) : null
  const reportPath = values.report ? resolve(values.report) : null
  if (manifestPath && manifestPath === reportPath)
    throw new Error('Manifest and report must be different files')
  if (command === 'status') {
    if (!reportPath) throw new Error('status requires --report')
    logger.info('Project backfill status', progressSchema.parse(await readJson(reportPath)))
    return
  }
  const rawUrl = process.env.MIGRATION_DATABASE_URL
  if (!rawUrl) throw new Error('MIGRATION_DATABASE_URL is required; no application DSN fallback')
  const url = new URL(rawUrl)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.slice(1))
    throw new Error('Invalid PostgreSQL connection')
  const databaseId = projectBackfillDatabaseId(rawUrl)
  const live = command === 'repair' || command === 'apply'
  if (live && !values['ack-release-drained'])
    throw new Error('Verify #8830 server/worker drainage and pass --ack-release-drained')
  const batchSize = boundedInteger(values['batch-size'], 50, 50)
  const maxBatches = boundedInteger(values['max-batches'], 100, 10000)
  const seconds = boundedInteger(values.seconds, 60, 3600)
  const pauseMs = boundedInteger(values['pause-ms'], 100, 60000)
  const sql = postgres(
    rawUrl,
    withUtcTimestamps({
      max: 1,
      idle_timeout: 0,
      max_lifetime: null,
      connect_timeout: 10,
      onnotice: () => {},
      connection: {
        application_name: 'sim-project-backfill',
        statement_timeout: 10000,
        lock_timeout: 250,
      },
    })
  )
  let stop = false
  const requestStop = () => {
    stop = true
  }
  process.on('SIGINT', requestStop)
  process.on('SIGTERM', requestStop)
  let lockPid: number | undefined
  let repairRuntimeLoaded = false
  async function assertLock() {
    const [row] = await sql`SELECT pg_backend_pid() AS pid, EXISTS (SELECT 1 FROM pg_locks
      WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted
        AND classid = ((hashtextextended('sim:project-backfill-operator',0) >> 32) & 4294967295)::oid
        AND objid = (hashtextextended('sim:project-backfill-operator',0) & 4294967295)::oid
        AND objsubid = 1) AS held`
    if (row.pid !== lockPid || !row.held)
      throw new Error('Operator session lock was lost; stop and resume with a fresh connection')
  }
  try {
    await assertProjectBackfillDatabase(sql, live)
    if (command === 'plan') {
      if (!manifestPath) throw new Error('plan requires --manifest')
      const manifest = await discoverProjectBackfill(sql, databaseId)
      await writeJson(manifestPath, manifest, false)
      logger.info('Reviewable Project plan written', {
        databaseId,
        manifestPath,
        families: manifest.families.length,
        repairs: manifest.repairs.length,
        conflicts: manifest.conflicts.length,
      })
      if (manifest.conflicts.length) process.exitCode = 2
      return
    }
    if (command === 'verify') {
      if (!manifestPath || !reportPath)
        throw new Error('Verification requires both --manifest and --report')
      const counts = await verifyProjectBackfill(sql)
      const manifest = manifestSchema.parse(await readJson(manifestPath))
      const report = progressSchema.parse(await readJson(reportPath))
      const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
      if (
        manifest.databaseId !== databaseId ||
        report.databaseId !== databaseId ||
        report.manifestHash !== hash
      )
        throw new Error('Verification artifacts do not match this database and manifest')
      counts.pendingCleanup = manifest.repairs.filter(
        (repair) => !report.repairsCompleted.includes(repair.workspaceId)
      ).length
      logger.info('Project verification', { databaseId, ...counts })
      if (Object.values(counts).some((count) => count !== 0)) process.exitCode = 2
      return
    }
    if (!manifestPath || !reportPath) throw new Error('Writes require --manifest and --report')
    const manifest = manifestSchema.parse(await readJson(manifestPath))
    if (manifest.databaseId !== databaseId) throw new Error('Manifest belongs to another database')
    const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
    const codeHash = createHash('sha256')
      .update(await readFile(import.meta.filename))
      .update(
        await readFile(
          new URL('../../../packages/db/maintenance/project-backfill.ts', import.meta.url)
        )
      )
      .update(await readFile(new URL('../lib/projects/backfill-repair.ts', import.meta.url)))
      .digest('hex')
    let progress: z.infer<typeof progressSchema>
    try {
      progress = progressSchema.parse(await readJson(reportPath))
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      progress = {
        version: 1,
        manifestHash,
        databaseId,
        codeHash,
        runId: generateId(),
        nextIndex: 0,
        deferred: [],
        repairsCompleted: [],
        assigned: 0,
        alreadyAssigned: 0,
        projectsCreated: 0,
        batches: 0,
        problems: [],
        status: 'running',
        updatedAt: new Date().toISOString(),
      }
    }
    if (progress.manifestHash !== manifestHash || progress.databaseId !== databaseId)
      throw new Error('Report does not match the reviewed manifest')
    if (
      progress.nextIndex > manifest.families.length ||
      progress.deferred.some((index) => index >= manifest.families.length)
    )
      throw new Error('Invalid report cursor')
    const [lock] =
      await sql`SELECT pg_try_advisory_lock(hashtextextended('sim:project-backfill-operator',0)) AS held, pg_backend_pid() AS pid`
    if (!lock.held) throw new Error('Another Project preparation or enforcement runner is active')
    lockPid = lock.pid
    progress.runId = generateId()
    progress.codeHash = codeHash
    progress.status = 'running'
    const started = performance.now()
    let attempts = 0
    let currentBatchSize = batchSize
    const pending = [
      ...new Set(progress.deferred),
      ...Array.from(
        { length: manifest.families.length - progress.nextIndex },
        (_, i) => progress.nextIndex + i
      ),
    ]
    const singleRetry = new Set<number>()
    const retryCounts = new Map<number, number>()
    const deferred = new Set(progress.deferred)
    const completedRepairs = new Set(progress.repairsCompleted)
    async function checkpoint() {
      progress.updatedAt = new Date().toISOString()
      progress.deferred = [...deferred].sort((a, b) => a - b)
      progress.repairsCompleted = [...completedRepairs]
      await writeJson(reportPath as string, progress)
    }
    logger.info('Project operator run started', {
      command,
      databaseId,
      runId: progress.runId,
      codeHash,
      batchSize,
      maxBatches,
      seconds,
    })
    await checkpoint()
    try {
      if (command === 'repair') {
        if (
          !process.env.DATABASE_URL ||
          projectBackfillDatabaseId(process.env.DATABASE_URL) !== databaseId
        )
          throw new Error(
            'Repair requires DATABASE_URL and MIGRATION_DATABASE_URL to identify the same database'
          )
        repairRuntimeLoaded = true
        const { repairArchivedProjectEnvironment } = await import('@/lib/projects/backfill-repair')
        for (const repair of manifest.repairs) {
          if (completedRepairs.has(repair.workspaceId)) continue
          if (stop || attempts >= maxBatches || performance.now() - started >= seconds * 1000) break
          await assertLock()
          attempts++
          await repairArchivedProjectEnvironment(sql, repair, progress.runId)
          await assertLock()
          completedRepairs.add(repair.workspaceId)
          await checkpoint()
          logger.info('Archive repair completed', {
            workspaceId: repair.workspaceId,
            workflows: repair.workflowIds.length,
          })
          await sleep(pauseMs)
        }
      } else {
        for (let position = 0; position < pending.length; ) {
          if (stop || attempts >= maxBatches || performance.now() - started >= seconds * 1000) break
          await assertLock()
          const indices = [pending[position++]]
          if (manifest.families[indices[0]].members.length === 1 && !singleRetry.has(indices[0])) {
            while (
              indices.length < currentBatchSize &&
              position < pending.length &&
              manifest.families[pending[position]].members.length === 1 &&
              !singleRetry.has(pending[position])
            )
              indices.push(pending[position++])
          }
          attempts++
          const batchStarted = performance.now()
          try {
            const result = await assignProjectBackfillBatch(
              sql,
              indices.map((index) => manifest.families[index])
            )
            await assertLock()
            progress.assigned += result.assigned
            progress.alreadyAssigned += result.alreadyAssigned
            progress.projectsCreated += result.projectsCreated
            progress.batches++
            if (performance.now() - batchStarted > 250 && currentBatchSize > 1) {
              currentBatchSize = Math.max(1, Math.floor(currentBatchSize / 2))
              logger.warn('Reducing Project batch size after a slow transaction', {
                currentBatchSize,
              })
            }
            for (const index of indices) deferred.delete(index)
            progress.problems = progress.problems.filter(
              (problem) => !indices.some((index) => manifest.families[index].rootId === problem.id)
            )
            logger.info('Project batch committed', {
              runId: progress.runId,
              ...result,
              elapsedMs: performance.now() - batchStarted,
              totalAssigned: progress.assigned,
              batches: progress.batches,
            })
          } catch (error) {
            const transient = getTransientDatabaseFailure(error)
            if (
              !(error instanceof ProjectBackfillBusy) &&
              !(error instanceof ProjectBackfillConflict) &&
              !transient
            )
              throw error
            await assertLock()
            for (const index of indices) {
              deferred.add(index)
              if (error instanceof ProjectBackfillConflict) {
                const id = manifest.families[index].rootId
                progress.problems = progress.problems.filter((problem) => problem.id !== id)
                progress.problems.push({ id, reason: error.message })
              }
            }
            if (indices.length > 1) {
              for (const index of indices) singleRetry.add(index)
              pending.splice(position, 0, ...indices)
            } else if (!(error instanceof ProjectBackfillConflict)) {
              const index = indices[0]
              const retries = (retryCounts.get(index) ?? 0) + 1
              retryCounts.set(index, retries)
              if (retries < 3) pending.push(index)
            }
            logger.warn('Project batch deferred', {
              roots: indices.map((index) => manifest.families[index].rootId),
              failure: transient ?? (error instanceof Error ? error.name : 'unknown'),
              error: describeError(error),
            })
            await sleep(backoffWithJitter(1, null, { baseMs: 250, maxMs: 1000 }))
          }
          progress.nextIndex = Math.max(progress.nextIndex, ...indices.map((index) => index + 1))
          await checkpoint()
          await sleep(pauseMs)
        }
      }
      const counts = await verifyProjectBackfill(sql)
      const pendingRepairs = manifest.repairs.filter(
        (repair) => !completedRepairs.has(repair.workspaceId)
      ).length
      const workLeft =
        progress.nextIndex < manifest.families.length || deferred.size > 0 || pendingRepairs > 0
      progress.status =
        !workLeft &&
        !manifest.conflicts.length &&
        Object.values(counts).every((count) => count === 0)
          ? 'complete'
          : stop || attempts >= maxBatches || performance.now() - started >= seconds * 1000
            ? 'paused'
            : 'incomplete'
      await checkpoint()
      logger.info('Project operator run finished', {
        ...progress,
        problems: progress.problems.length,
        deferred: deferred.size,
        repairsCompleted: completedRepairs.size,
        elapsedMs: performance.now() - started,
        verification: counts,
      })
      if (progress.status !== 'complete') process.exitCode = 2
    } catch (error) {
      progress.status = 'failed'
      await checkpoint()
      throw error
    }
  } finally {
    process.off('SIGINT', requestStop)
    process.off('SIGTERM', requestStop)
    await sql.end({ timeout: 5 })
    if (repairRuntimeLoaded) {
      const { mcpPubSub } = await import('@/lib/mcp/pubsub')
      const { closeRedisConnection } = await import('@/lib/core/config/redis')
      const { db, dbReplica } = await import('@sim/db')
      mcpPubSub?.dispose()
      await closeRedisConnection()
      await Promise.all(
        [...new Set([db.$client, dbReplica.$client])].map((client) => client.end({ timeout: 5 }))
      )
    }
  }
}
await main().catch((error) => {
  logger.error('Project operator run failed', { error: describeError(error) })
  process.exitCode = 1
})
