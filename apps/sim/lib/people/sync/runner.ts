import { db } from '@sim/db'
import { peopleDirectoryScimChange as change, peopleDirectorySync as sync } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { chunkArray } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, isNotNull, isNull, lte, not, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret } from '@/lib/core/security/encryption'
import type { DbTransaction } from '@/lib/db/types'
import { requirePeopleEnabled } from '@/lib/people/feature-flag'
import { lockProfiles } from '@/lib/people/repository'
import { publishStagedSnapshot } from '@/lib/people/sync/projection'
import { DirectoryRetryError } from '@/lib/people/sync/provider-request'
import { pendingScimChange, scimSyncPaused } from '@/lib/people/sync/scim-changes'
import { openDirectoryReader } from '@/lib/people/sync/snapshot'
import {
  discardStage,
  pendingManagers,
  type StageRun,
  stageRelationships,
  stageUsers,
} from '@/lib/people/sync/stage'
import type { DirectoryReader } from '@/lib/people/sync/types'
import { stageScimDirectory } from '@/ee/scim/lib/repository/people-profiles'

const logger = createLogger('PeopleDirectorySync')
const SYNC_INTERVAL_MS = 60 * 60_000
const RETRY_INTERVAL_MS = 15 * 60_000
const LEASE_MS = 5 * 60_000
const RUN_LIFETIME_MS = 7 * 24 * SYNC_INTERVAL_MS
const SLICES = {
  manual: { durationMs: 20_000, steps: 16 },
  cron: { durationMs: 65_000, steps: 128 },
} as const
export const CLEARED_RUN = {
  runId: null,
  runStartedAt: null,
  phase: null,
  cursor: null,
  usersRead: 0,
} as const
export const RELEASED = { leaseToken: null, leaseExpiresAt: null } as const
const available = (at: Date) => or(isNull(sync.leaseToken), lte(sync.leaseExpiresAt, at))
const due = (at: Date) => or(lte(sync.nextSyncAt, at), isNotNull(pendingScimChange))
type Connection = typeof sync.$inferSelect
type Worker = StageRun & { token: string }
const checkpointColumns = {
  organizationId: sync.organizationId,
  sourceTarget: sync.sourceTarget,
  retryCount: sync.retryCount,
}
type Checkpoint = Pick<Connection, keyof typeof checkpointColumns>

async function connectReader(row: Connection) {
  if (!row.encryptedCredential)
    throw new OrchestrationError('validation', 'Update the directory credentials before syncing.')
  const { decrypted } = await decryptSecret(row.encryptedCredential)
  if (row.source === 'okta')
    return openDirectoryReader({ source: 'okta', domain: row.sourceTarget, token: decrypted })
  if (row.source !== 'entra' || !row.clientId)
    throw new OrchestrationError('validation', 'Update the directory client ID before syncing.')
  return openDirectoryReader({
    source: 'entra',
    tenantId: row.sourceTarget,
    clientId: row.clientId,
    clientSecret: decrypted,
  })
}

const ownsLease = (worker: Worker) =>
  and(
    eq(sync.organizationId, worker.organizationId),
    eq(sync.runId, worker.runId),
    eq(sync.leaseToken, worker.token)
  )

/** Every page and its next cursor commit together, after checking that the same run still owns the source. */
async function checkpoint(
  worker: Worker,
  write: (tx: DbTransaction, row: Checkpoint) => Promise<void>,
  options: { lockProfiles?: boolean } = {}
) {
  return db.transaction(async (tx) => {
    if (options.lockProfiles) await lockProfiles(tx, worker.organizationId)
    const [row] = await tx
      .select(checkpointColumns)
      .from(sync)
      .where(ownsLease(worker))
      .for('update')
    if (!row) return false
    await write(tx, row)
    return true
  })
}

async function publish(tx: DbTransaction, worker: Worker, source: Connection['source']) {
  await publishStagedSnapshot(tx, worker, source)
  await discardStage(tx, worker.organizationId)
  await tx
    .update(sync)
    .set({
      ...CLEARED_RUN,
      ...RELEASED,
      lastSuccessAt: new Date(),
      lastError: null,
      retryCount: 0,
      nextSyncAt: new Date(Date.now() + SYNC_INTERVAL_MS),
    })
    .where(ownsLease(worker))
}

function retryUpdate(row: Checkpoint, providerDelay: number, reason: string) {
  const retryCount = Math.min(row.retryCount + 1, 16)
  const delay = Math.max(
    providerDelay,
    backoffWithJitter(retryCount, null, { baseMs: 30_000, maxMs: SYNC_INTERVAL_MS })
  )
  return {
    ...RELEASED,
    retryCount,
    nextSyncAt: new Date(Date.now() + delay),
    lastFailedAt: new Date(),
    lastError: reason,
  }
}

async function checkpointUsers(worker: Worker, reader: DirectoryReader, cursor: string | null) {
  const page = await reader.users(cursor)
  return checkpoint(worker, async (tx) => {
    await stageUsers(tx, worker, cursor, page.people)
    await tx
      .update(sync)
      .set({
        cursor: page.next,
        phase: page.next ? 'users' : reader.reports ? 'relationships' : 'publish',
        usersRead: sql`${sync.usersRead} + ${page.people.length}`,
        retryCount: 0,
        lastError: null,
      })
      .where(ownsLease(worker))
  })
}

async function checkpointReports(worker: Worker, reader: DirectoryReader) {
  if (!reader.reports)
    throw new OrchestrationError('validation', 'The directory cannot read reporting lines.')
  const items = await pendingManagers(db, worker)
  if (!items.length) {
    return checkpoint(worker, async (tx) => {
      await tx.update(sync).set({ phase: 'publish' }).where(ownsLease(worker))
    })
  }
  const results = await reader.reports(items)
  const cursors = new Map(items.map((item) => [item.managerId, item.cursor]))
  const pages = results.flatMap((result) =>
    'reportIds' in result
      ? [
          {
            managerId: result.managerId,
            cursor: cursors.get(result.managerId) ?? null,
            reportIds: result.reportIds,
            nextCursor: result.next,
          },
        ]
      : []
  )
  const delays = results.flatMap((result) =>
    'retryAfterMs' in result ? [result.retryAfterMs] : []
  )
  const applied = await checkpoint(worker, async (tx, row) => {
    await stageRelationships(tx, worker, pages)
    const update = delays.length
      ? retryUpdate(
          row,
          Math.max(...delays),
          'Some reporting lines could not be read yet. Sync will resume automatically.'
        )
      : { retryCount: 0, lastError: null }
    await tx.update(sync).set(update).where(ownsLease(worker))
  })
  return applied && !delays.length
}

/** A local SCIM generation captures, validates, and publishes atomically. New provisioning changes have their own marker. */
async function runScim(worker: Worker) {
  await checkpoint(
    worker,
    async (tx, row) => {
      await discardStage(tx, row.organizationId)
      const count = await stageScimDirectory(tx, row.organizationId, worker.runId, row.sourceTarget)
      if (count === null) {
        await tx
          .update(sync)
          .set({ ...CLEARED_RUN, ...RELEASED })
          .where(ownsLease(worker))
        return
      }
      await tx.update(sync).set({ phase: 'publish', usersRead: count }).where(ownsLease(worker))
      await publish(tx, worker, 'scim')
    },
    { lockProfiles: true }
  )
}

async function handleFailure(worker: Worker, error: unknown) {
  const retry = error instanceof DirectoryRetryError
  const temporary =
    retry ||
    !(error instanceof OrchestrationError) ||
    error.code === 'internal' ||
    error.code === 'locked'
  const reason =
    retry || (error instanceof OrchestrationError && error.code !== 'internal')
      ? error.message
      : 'Directory sync was interrupted. Sim will retry automatically.'
  const applied = await checkpoint(worker, async (tx, row) => {
    if (temporary) {
      await tx
        .update(sync)
        .set(retryUpdate(row, retry ? error.retryAfterMs : 0, reason))
        .where(ownsLease(worker))
    } else {
      await discardStage(tx, row.organizationId)
      await tx
        .update(sync)
        .set({
          ...CLEARED_RUN,
          ...RELEASED,
          retryCount: 0,
          lastFailedAt: new Date(),
          lastError: reason,
          nextSyncAt: new Date(Date.now() + RETRY_INTERVAL_MS),
        })
        .where(ownsLease(worker))
    }
  })
  if (applied)
    logger.warn('Directory refresh interrupted', {
      organizationId: worker.organizationId,
      temporary,
      reason,
    })
}

function claim(organizationId: string, trigger: keyof typeof SLICES, token: string, now: Date) {
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(sync)
      .set({
        leaseToken: token,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        lastAttemptAt: now,
        runId: sql`coalesce(${sync.runId},${generateId()})`,
        phase: sql`coalesce(${sync.phase},'users')`,
        runStartedAt: sql`coalesce(${sync.runStartedAt},${now.toISOString()}::timestamp)`,
      })
      .where(
        and(
          eq(sync.organizationId, organizationId),
          available(now),
          not(scimSyncPaused),
          trigger === 'manual' ? or(eq(sync.retryCount, 0), due(now)) : due(now)
        )
      )
      .returning()
    if (claimed?.source === 'scim')
      await tx.delete(change).where(eq(change.organizationId, organizationId))
    if (!claimed?.runStartedAt || claimed.runStartedAt.getTime() + RUN_LIFETIME_MS > now.getTime())
      return claimed
    await discardStage(tx, organizationId)
    const [fresh] = await tx
      .update(sync)
      .set({
        ...CLEARED_RUN,
        runId: generateId(),
        phase: 'users',
        runStartedAt: now,
        retryCount: 0,
        lastError: null,
      })
      .where(eq(sync.organizationId, organizationId))
      .returning()
    return fresh
  })
}

/** Resumes private pages within the request budget. Only a fully validated generation may publish. */
export async function runDirectorySync(organizationId: string, trigger: keyof typeof SLICES) {
  const token = generateId()
  const now = new Date()
  const row = await claim(organizationId, trigger, token, now)
  if (!row?.runId) return false
  const worker = { organizationId, runId: row.runId, token }
  try {
    await requirePeopleEnabled(organizationId)
    if (row.source === 'scim') {
      await runScim(worker)
      return true
    }
    let reader: DirectoryReader | undefined
    const { durationMs, steps } = SLICES[trigger]
    const deadline = now.getTime() + durationMs
    for (let i = 0; i < steps && Date.now() < deadline; i++) {
      const [current] = await db
        .select({ phase: sync.phase, cursor: sync.cursor })
        .from(sync)
        .where(ownsLease(worker))
      if (!current) return true
      await requirePeopleEnabled(organizationId)
      if (current.phase === 'publish') {
        await checkpoint(worker, (tx) => publish(tx, worker, row.source), { lockProfiles: true })
        return true
      }
      reader ??= await connectReader(row)
      const expected = row.source === 'okta' ? `https://${row.sourceTarget}` : row.sourceTarget
      if (reader.sourceId !== expected)
        throw new OrchestrationError(
          'conflict',
          'Disconnect the current directory before changing tenants.'
        )
      const more =
        current.phase === 'relationships'
          ? await checkpointReports(worker, reader)
          : await checkpointUsers(worker, reader, current.cursor)
      if (!more) return true
    }
    await db
      .update(sync)
      .set({ ...RELEASED, nextSyncAt: new Date() })
      .where(ownsLease(worker))
  } catch (error) {
    await handleFailure(worker, error)
  }
  return true
}

export async function syncDueDirectories() {
  const deadline = Date.now() + 90_000
  let attempted = 0
  const now = new Date()
  const connections = await db.execute<{ organizationId: string }>(sql`
    WITH candidates AS (
      (SELECT ${sync.organizationId} AS organization_id, ${sync.nextSyncAt} AS due_at FROM ${sync}
       WHERE ${and(available(now), not(scimSyncPaused), lte(sync.nextSyncAt, now))}
       ORDER BY ${sync.nextSyncAt}, ${sync.organizationId} LIMIT 50)
      UNION ALL
      (SELECT ${change.organizationId}, ${change.changedAt} FROM ${change}
       JOIN ${sync} ON ${sync.organizationId}=${change.organizationId} AND ${sync.source}='scim'
       WHERE ${and(available(now), not(scimSyncPaused))}
       ORDER BY ${change.changedAt}, ${change.organizationId} LIMIT 50)
    )
    SELECT organization_id AS "organizationId" FROM candidates
    GROUP BY organization_id ORDER BY min(due_at), organization_id LIMIT 50
  `)
  for (const slice of chunkArray(connections, 2)) {
    if (Date.now() >= deadline) break
    const results = await Promise.allSettled(
      slice.map(({ organizationId }) => runDirectorySync(organizationId, 'cron'))
    )
    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        logger.error('Could not process a due directory', {
          organizationId: slice[index].organizationId,
          code: getPostgresErrorCode(result.reason),
        })
      } else if (result.value) {
        attempted++
      }
    }
  }
  return { attempted }
}
