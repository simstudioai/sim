/**
 * The staging area for workspace source blobs: bytes a client uploads before an apply, keyed by
 * their SHA-256 and scoped to one workspace and one caller, so an apply names them by hash and a
 * resumed upload skips what is already here. Rows (`workspace_source_staged_blob`) hold the hash,
 * size, storage key and expiry; the bytes live in object storage under the workspace's prefix.
 * Only staging (sending the bytes) sets the expiry: looking blobs up or planning with them never
 * extends it. While held, staged bytes count against the workspace payer's storage quota, on top
 * of what the payer already stores, so staging can never hold more than the quota leaves; once an
 * apply writes a blob into the workspace (which then stores and charges for it), it is consumed and
 * stops counting, though it stays staged until it expires, so applying it again uploads nothing.
 * Callers pass canonical ids and a scope string, never a principal: the use cases in
 * `application/stage-blobs.ts` authorize first.
 */
import { db } from '@sim/db'
import { workspace, workspaceSourceStagedBlob } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { generateId, generateShortId } from '@sim/utils/id'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, asc, eq, gt, inArray, isNull, lt, lte, notInArray, sql } from 'drizzle-orm'
import { workspacesPaidBy } from '@/lib/billing/core/payer-context'
import type { BillingEntity } from '@/lib/billing/core/usage-log'
import {
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage/context'
import {
  checkStorageQuotaForBillingContext,
  isStorageEnforcementEnabled,
} from '@/lib/billing/storage/limits'
import { isWorkspaceStoragePayerInTx } from '@/lib/billing/storage/tracking'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import type { DbTransaction } from '@/lib/db/types'
import { deleteFiles, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('WorkspaceSourceStaging')

/** How long a staged blob is kept after it was last staged. */
const STAGED_BLOB_TTL_MS = 24 * 60 * 60 * 1000

/**
 * A staged blob that expires sooner than this reads as missing to a client asking what to stage,
 * so it sends the bytes again (renewing it) rather than applying with one about to go.
 */
export const STAGED_BLOB_RESTAGE_MARGIN_MS = 60 * 60 * 1000

/** Rows one sweep pass deletes. */
const SWEEP_BATCH = 500

const STORAGE_CONTEXT = 'workspace' as const

/** Blob uploads one staging request runs at once; the bytes are already in memory. */
const UPLOAD_CONCURRENCY = 4

const QUOTA_UNAVAILABLE = 'Could not check the storage quota for staging; retry shortly.'

/** A staged blob as an apply reads it. */
export interface StagedBlob {
  sha256: string
  size: number
  storageKey: string
}

/** A staged blob as staging reads it: `consumed` once an apply wrote it into the workspace. */
type HeldBlob = StagedBlob & { consumed: boolean }

/** The workspace and caller a staged blob belongs to. */
export interface StagingScope {
  workspaceId: string
  /** `user:<id>` or `workspace_api_key:<id>`: one caller's uploads never satisfy another's. */
  scope: string
}

/** A fresh key per upload, so removing one staged copy never deletes bytes another row holds. */
function newStorageKey({ workspaceId, scope }: StagingScope, sha256: string): string {
  return `workspace/${workspaceId}/source-staging/${scope.replace(':', '-')}/${sha256}-${generateShortId()}`
}

function expiry(now = Date.now()): Date {
  return new Date(now + STAGED_BLOB_TTL_MS)
}

const inScope = ({ workspaceId, scope }: StagingScope) =>
  and(
    eq(workspaceSourceStagedBlob.workspaceId, workspaceId),
    eq(workspaceSourceStagedBlob.scope, scope)
  )

/**
 * The staged blobs among `hashes` that are still staged `until` (default now), by hash, each
 * marked `consumed` once an apply wrote it. A read: it never extends an expiry.
 */
export async function findStagedBlobs(
  target: StagingScope,
  hashes: readonly string[],
  until: Date = new Date()
): Promise<Map<string, HeldBlob>> {
  const found = new Map<string, HeldBlob>()
  if (hashes.length === 0) return found
  const rows = await db
    .select({
      sha256: workspaceSourceStagedBlob.sha256,
      size: workspaceSourceStagedBlob.size,
      storageKey: workspaceSourceStagedBlob.storageKey,
      consumed: sql<boolean>`${workspaceSourceStagedBlob.consumedAt} is not null`,
    })
    .from(workspaceSourceStagedBlob)
    .where(
      and(
        inScope(target),
        inArray(workspaceSourceStagedBlob.sha256, [...new Set(hashes)]),
        gt(workspaceSourceStagedBlob.expiresAt, until)
      )
    )
  for (const row of rows) found.set(row.sha256, row)
  return found
}

/** How many blobs, and how many bytes, `target` holds staged (expired ones excluded). */
export async function stagedUsage(
  target: StagingScope,
  tx: Pick<typeof db, 'select'> = db
): Promise<{ count: number; bytes: number }> {
  const [usage] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${workspaceSourceStagedBlob.size}), 0)::bigint`,
    })
    .from(workspaceSourceStagedBlob)
    .where(and(inScope(target), gt(workspaceSourceStagedBlob.expiresAt, new Date())))
  return { count: Number(usage?.count ?? 0), bytes: Number(usage?.bytes ?? 0) }
}

/**
 * The bytes staged (unexpired, and not yet written by an apply) in every workspace `payer` pays
 * for, across callers: what staging holds against the payer's storage quota.
 */
async function payerStagedBytes(tx: DbTransaction, payer: BillingEntity): Promise<number> {
  const [usage] = await tx
    .select({
      bytes: sql<number>`coalesce(sum(${workspaceSourceStagedBlob.size}), 0)::bigint`,
    })
    .from(workspaceSourceStagedBlob)
    .innerJoin(workspace, eq(workspace.id, workspaceSourceStagedBlob.workspaceId))
    .where(
      and(
        gt(workspaceSourceStagedBlob.expiresAt, new Date()),
        isNull(workspaceSourceStagedBlob.consumedAt),
        workspacesPaidBy(payer)
      )
    )
  return Number(usage?.bytes ?? 0)
}

/**
 * Refuses staging `bytes` more in `billing`'s workspace when the bytes its payer stores, plus those
 * staged in any of the payer's workspaces, plus these would pass the payer's storage quota. First
 * confirms the workspace is still paid by `billing`'s payer (resolved before `tx` opened), locking
 * its row so no payer transfer moves it before `tx` ends; then holds the payer's staging lock until
 * `tx` ends (through the insert that follows), so concurrent staging in another workspace of the
 * same payer cannot pass the check together. A payer that moved, or a quota or staged total that
 * could not be read, is a `503`, never {@link SourceStagingFullError}, which a client takes as
 * permanent.
 */
async function assertStagingWithinQuota(
  tx: DbTransaction,
  billing: StorageBillingContext,
  bytes: number
): Promise<void> {
  if (!(await isWorkspaceStoragePayerInTx(tx, billing))) {
    throw new OrchestrationError(
      'unavailable',
      'The workspace changed payer while staging; retry shortly.'
    )
  }
  const { type, id } = billing.billingEntity
  await acquireAdvisoryXactLock(
    tx,
    'workspace_source_staging',
    `workspace-source-staging-payer:${type}:${id}`
  )
  let staged: number
  try {
    staged = await payerStagedBytes(tx, billing.billingEntity)
  } catch (error) {
    logger.error('Could not read the bytes staged against the storage quota', { error })
    throw new OrchestrationError('unavailable', QUOTA_UNAVAILABLE)
  }
  const quota = await checkStorageQuotaForBillingContext(billing, staged + bytes, tx)
  if (quota.unavailable) {
    throw new OrchestrationError('unavailable', QUOTA_UNAVAILABLE)
  }
  if (!quota.allowed) {
    throw new SourceStagingFullError(
      `${quota.error ?? 'Storage limit exceeded'}. Staged files count toward storage until an apply writes them or they expire, a day after they were last staged.`
    )
  }
}

/**
 * A caller's staging area, or the payer's storage quota, has no room for what it stages: `413`
 * like a body over the limit, told apart by `details.code` `SOURCE_STAGING_FULL`, since freeing
 * staged files (or waiting for them to expire) fixes it and sending smaller requests does not.
 */
export class SourceStagingFullError extends OrchestrationError {
  constructor(message: string) {
    super('payload_too_large', message)
    this.name = 'SourceStagingFullError'
  }
}

/** Refuses staging that would take `target` past its blob or byte cap. */
export function assertStagingFits(
  usage: { count: number; bytes: number },
  adding: { count: number; bytes: number }
): void {
  const { maxStagedBlobs, maxStagedBytes } = WORKSPACE_SOURCE_LIMITS
  if (usage.count + adding.count > maxStagedBlobs) {
    throw new SourceStagingFullError(
      `Staging ${adding.count} more binary files would hold ${usage.count + adding.count}, over the ${maxStagedBlobs}-file limit. Staged files expire a day after they were last staged.`
    )
  }
  if (usage.bytes + adding.bytes > maxStagedBytes) {
    throw new SourceStagingFullError(
      `Staging ${adding.bytes} more bytes would hold ${usage.bytes + adding.bytes}, over the ${maxStagedBytes}-byte limit. Staged files expire a day after they were last staged.`
    )
  }
}

/**
 * Stages `blobs` (bytes the caller already hashed): writes each one not yet staged to storage,
 * then records them under one lock on the scope, refusing a batch that would pass the caps or the
 * payer's storage quota (and removing the objects it wrote). A blob already staged is not written
 * again: sending its bytes renews it, and counts it toward the quota again (refused like a new
 * blob when the quota has no room) if an apply consumed it.
 */
export async function stageBlobs(
  target: StagingScope,
  blobs: ReadonlyArray<{ sha256: string; bytes: Buffer }>
): Promise<StagedBlob[]> {
  const unique = new Map(blobs.map((blob) => [blob.sha256, blob]))
  const known = await findStagedBlobs(target, [...unique.keys()])
  const fresh = [...unique.values()].filter((blob) => !known.has(blob.sha256))
  const held = [...known.values()]
  const renewing = held.filter((blob) => !blob.consumed).map((blob) => blob.sha256)
  const reclaiming = held.filter((blob) => blob.consumed).map((blob) => blob.sha256)
  const charged = fresh.length > 0 || reclaiming.length > 0
  const keys = new Map<string, string>()
  const replaced: string[] = []
  let recorded = new Map<string, StagedBlob>()
  // The payer resolves before the transaction, so the transaction reads no billing rows. Renewing
  // a blob that still counts adds no bytes, so it needs no quota check and commits on its own: a
  // batch whose other blobs are refused still keeps the ones it re-sent.
  const [billing] = await Promise.all([
    charged && isStorageEnforcementEnabled()
      ? resolveStorageBillingContext(target.workspaceId)
      : null,
    renewing.length > 0
      ? db
          .update(workspaceSourceStagedBlob)
          .set({ expiresAt: expiry() })
          .where(
            and(
              inScope(target),
              inArray(workspaceSourceStagedBlob.sha256, renewing),
              gt(workspaceSourceStagedBlob.expiresAt, new Date()),
              isNull(workspaceSourceStagedBlob.consumedAt)
            )
          )
      : null,
  ])
  try {
    // A failed upload starts no more, and throws once those running have settled, so every object
    // written is in `keys` by the time `finally` removes the ones no row recorded.
    await mapWithConcurrency(fresh, UPLOAD_CONCURRENCY, async (blob) => {
      const key = newStorageKey(target, blob.sha256)
      await uploadFile({
        file: blob.bytes,
        fileName: blob.sha256,
        contentType: 'application/octet-stream',
        context: STORAGE_CONTEXT,
        customKey: key,
        preserveKey: true,
        persistMetadata: false,
      })
      keys.set(blob.sha256, key)
    })
    recorded = await db.transaction(async (tx) => {
      await acquireAdvisoryXactLock(
        tx,
        'workspace_source_staging',
        `workspace-source-staging:${target.workspaceId}:${target.scope}`
      )
      if (!charged) return new Map<string, StagedBlob>()
      // A consumed blob staged again counts toward the quota again: it is restored here, so the
      // quota check below reads its bytes among the payer's staged ones (its row already counts
      // toward the caps), and a refusal leaves it consumed.
      if (reclaiming.length > 0) {
        await tx
          .update(workspaceSourceStagedBlob)
          .set({ expiresAt: expiry(), consumedAt: null })
          .where(
            and(
              inScope(target),
              inArray(workspaceSourceStagedBlob.sha256, reclaiming),
              gt(workspaceSourceStagedBlob.expiresAt, new Date())
            )
          )
      }
      const adding = {
        count: fresh.length,
        bytes: fresh.reduce((sum, blob) => sum + blob.bytes.byteLength, 0),
      }
      assertStagingFits(await stagedUsage(target, tx), adding)
      if (billing) await assertStagingWithinQuota(tx, billing, adding.bytes)
      if (fresh.length === 0) return new Map<string, StagedBlob>()
      const hashes = fresh.map((blob) => blob.sha256)
      // An expired row of the same hash is replaced, so the unique index admits the new one.
      const expired = await tx
        .delete(workspaceSourceStagedBlob)
        .where(
          and(
            inScope(target),
            inArray(workspaceSourceStagedBlob.sha256, hashes),
            lte(workspaceSourceStagedBlob.expiresAt, new Date())
          )
        )
        .returning({ storageKey: workspaceSourceStagedBlob.storageKey })
      replaced.push(...expired.map((row) => row.storageKey))
      // A row a concurrent request recorded first wins; this request's copy is then removed.
      const rows = await tx
        .insert(workspaceSourceStagedBlob)
        .values(
          fresh.map((blob) => ({
            id: generateId(),
            workspaceId: target.workspaceId,
            scope: target.scope,
            sha256: blob.sha256,
            size: blob.bytes.byteLength,
            storageKey: keys.get(blob.sha256) ?? '',
            expiresAt: expiry(),
          }))
        )
        .onConflictDoUpdate({
          target: [
            workspaceSourceStagedBlob.workspaceId,
            workspaceSourceStagedBlob.scope,
            workspaceSourceStagedBlob.sha256,
          ],
          set: { expiresAt: expiry(), consumedAt: null },
        })
        .returning({
          sha256: workspaceSourceStagedBlob.sha256,
          size: workspaceSourceStagedBlob.size,
          storageKey: workspaceSourceStagedBlob.storageKey,
        })
      return new Map(rows.map((row) => [row.sha256, row]))
    })
  } finally {
    const held = new Set([...recorded.values()].map((row) => row.storageKey))
    await removeObjects([...replaced, ...[...keys.values()].filter((key) => !held.has(key))])
  }
  return [...unique.keys()].flatMap((sha256) => {
    const blob = recorded.get(sha256) ?? known.get(sha256)
    return blob ? [blob] : []
  })
}

/**
 * Marks `blobs` consumed: an apply wrote their bytes into the workspace, which now charges for
 * them, so they no longer count toward the payer's quota. They stay staged until they expire. Each
 * is matched by its storage key too, so a row staged again in its place since the apply read it
 * (once it expired) keeps counting.
 */
export async function markStagedBlobsConsumed(
  target: StagingScope,
  blobs: readonly StagedBlob[]
): Promise<void> {
  if (blobs.length === 0) return
  await db
    .update(workspaceSourceStagedBlob)
    .set({ consumedAt: new Date() })
    .where(
      and(
        inScope(target),
        inArray(workspaceSourceStagedBlob.sha256, [...new Set(blobs.map((blob) => blob.sha256))]),
        inArray(workspaceSourceStagedBlob.storageKey, [
          ...new Set(blobs.map((blob) => blob.storageKey)),
        ])
      )
    )
}

async function removeObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const { failed } = await deleteFiles(keys, STORAGE_CONTEXT)
  if (failed.length > 0) logger.warn('Could not remove staged blob objects', { failed })
}

/**
 * The bytes of a staged blob, refused unless they still hash to its SHA-256 and size: what
 * storage returns is checked again before anything is written from it.
 */
export async function readStagedBlob(blob: StagedBlob): Promise<Buffer> {
  const bytes = await downloadFile({
    key: blob.storageKey,
    context: STORAGE_CONTEXT,
    maxBytes: blob.size,
  })
  if (bytes.byteLength !== blob.size || sha256Hex(bytes) !== blob.sha256) {
    throw new Error('A staged blob no longer matches its SHA-256')
  }
  return bytes
}

/**
 * Deletes expired staged blobs, oldest first, up to `maxBatches` passes of {@link SWEEP_BATCH}:
 * each pass removes the objects, then the rows of the objects it removed. A row whose object could
 * not be removed stays expired, moved to the back of the queue just before this sweep's start, so
 * any later sweep retries it (even one starting in the same millisecond) rather than orphaning the
 * object; this sweep skips the rows it already kept. Returns how many rows it removed.
 */
export async function sweepExpiredStagedBlobs(maxBatches = 20): Promise<number> {
  let removed = 0
  const sweepStart = new Date()
  const retryAt = new Date(sweepStart.getTime() - 1)
  const kept: string[] = []
  for (let pass = 0; pass < maxBatches; pass++) {
    const expired = await db
      .select({
        id: workspaceSourceStagedBlob.id,
        storageKey: workspaceSourceStagedBlob.storageKey,
      })
      .from(workspaceSourceStagedBlob)
      .where(
        and(
          lt(workspaceSourceStagedBlob.expiresAt, sweepStart),
          kept.length > 0 ? notInArray(workspaceSourceStagedBlob.id, kept) : undefined
        )
      )
      .orderBy(asc(workspaceSourceStagedBlob.expiresAt))
      .limit(SWEEP_BATCH)
    if (expired.length === 0) break
    const { failed } = await deleteFiles(
      expired.map((row) => row.storageKey),
      STORAGE_CONTEXT
    )
    const failedKeys = new Set(failed.map((failure) => failure.key))
    if (failedKeys.size > 0) logger.warn('Could not remove staged blob objects', { failed })
    const gone = expired.filter((row) => !failedKeys.has(row.storageKey)).map((row) => row.id)
    const stuck = expired.filter((row) => failedKeys.has(row.storageKey)).map((row) => row.id)
    if (gone.length > 0) {
      const rows = await db
        .delete(workspaceSourceStagedBlob)
        .where(
          and(
            inArray(workspaceSourceStagedBlob.id, gone),
            lt(workspaceSourceStagedBlob.expiresAt, sweepStart)
          )
        )
        .returning({ id: workspaceSourceStagedBlob.id })
      removed += rows.length
    }
    if (stuck.length > 0) {
      await db
        .update(workspaceSourceStagedBlob)
        .set({ expiresAt: retryAt })
        .where(
          and(
            inArray(workspaceSourceStagedBlob.id, stuck),
            lt(workspaceSourceStagedBlob.expiresAt, sweepStart)
          )
        )
      kept.push(...stuck)
    }
    if (expired.length < SWEEP_BATCH) break
  }
  return removed
}
