/**
 * The staging area for workspace source blobs: bytes a client uploads before an apply, keyed by
 * their SHA-256 and scoped to one workspace and one caller, so an apply names them by hash and a
 * resumed upload skips what is already here. Rows (`workspace_source_staged_blob`) hold the hash,
 * size, storage key and expiry; the bytes live in object storage under the workspace's prefix.
 * Callers pass canonical ids and a scope string, never a principal: the use cases in
 * `application/stage-blobs.ts` authorize first.
 */
import { db } from '@sim/db'
import { workspaceSourceStagedBlob } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { generateId, generateShortId } from '@sim/utils/id'
import { WORKSPACE_SOURCE_LIMITS } from '@sim/workspace-code/limits'
import { and, asc, eq, inArray, lt, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { acquireAdvisoryXactLock } from '@/lib/db/advisory-locks'
import { deleteFiles, downloadFile, uploadFile } from '@/lib/uploads/core/storage-service'

const logger = createLogger('WorkspaceSourceStaging')

/** How long a staged blob is kept after it was last staged, checked for, or planned with. */
export const STAGED_BLOB_TTL_MS = 24 * 60 * 60 * 1000

/** Rows one sweep pass deletes. */
const SWEEP_BATCH = 500

const STORAGE_CONTEXT = 'workspace' as const

/** A staged blob as an apply reads it. */
export interface StagedBlob {
  sha256: string
  size: number
  storageKey: string
}

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
 * The staged blobs among `hashes` (unexpired), by hash; each one found has its expiry pushed out,
 * so what a client just checked for or an apply just planned with outlives the apply.
 */
export async function findStagedBlobs(
  target: StagingScope,
  hashes: readonly string[]
): Promise<Map<string, StagedBlob>> {
  const found = new Map<string, StagedBlob>()
  if (hashes.length === 0) return found
  const rows = await db
    .update(workspaceSourceStagedBlob)
    .set({ expiresAt: expiry() })
    .where(
      and(
        inScope(target),
        inArray(workspaceSourceStagedBlob.sha256, [...new Set(hashes)]),
        sql`${workspaceSourceStagedBlob.expiresAt} > now()`
      )
    )
    .returning({
      sha256: workspaceSourceStagedBlob.sha256,
      size: workspaceSourceStagedBlob.size,
      storageKey: workspaceSourceStagedBlob.storageKey,
    })
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
    .where(and(inScope(target), sql`${workspaceSourceStagedBlob.expiresAt} > now()`))
  return { count: Number(usage?.count ?? 0), bytes: Number(usage?.bytes ?? 0) }
}

/** Refuses staging that would take `target` past its blob or byte cap. */
export function assertStagingFits(
  usage: { count: number; bytes: number },
  adding: { count: number; bytes: number }
): void {
  const { maxStagedBlobs, maxStagedBytes } = WORKSPACE_SOURCE_LIMITS
  if (usage.count + adding.count > maxStagedBlobs) {
    throw new OrchestrationError(
      'payload_too_large',
      `Staging ${adding.count} more binary files would hold ${usage.count + adding.count}, over the ${maxStagedBlobs}-file limit. Apply what is staged first, or wait for it to expire.`
    )
  }
  if (usage.bytes + adding.bytes > maxStagedBytes) {
    throw new OrchestrationError(
      'payload_too_large',
      `Staging ${adding.bytes} more bytes would hold ${usage.bytes + adding.bytes}, over the ${maxStagedBytes}-byte limit. Apply what is staged first, or wait for it to expire.`
    )
  }
}

/**
 * Stages `blobs` (bytes the caller already hashed): writes each one not yet staged to storage,
 * then records them under one lock on the scope, refusing a batch that would pass the caps (and
 * removing the objects it wrote). A blob already staged only has its expiry pushed out.
 */
export async function stageBlobs(
  target: StagingScope,
  blobs: ReadonlyArray<{ sha256: string; bytes: Buffer }>
): Promise<StagedBlob[]> {
  const unique = new Map(blobs.map((blob) => [blob.sha256, blob]))
  const known = await findStagedBlobs(target, [...unique.keys()])
  const fresh = [...unique.values()].filter((blob) => !known.has(blob.sha256))
  const keys = new Map<string, string>()
  const replaced: string[] = []
  let recorded = new Map<string, StagedBlob>()
  try {
    for (const blob of fresh) {
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
    }
    recorded = await db.transaction(async (tx) => {
      await acquireAdvisoryXactLock(
        tx,
        'workspace_source_staging',
        `workspace-source-staging:${target.workspaceId}:${target.scope}`
      )
      if (fresh.length === 0) return new Map<string, StagedBlob>()
      assertStagingFits(await stagedUsage(target, tx), {
        count: fresh.length,
        bytes: fresh.reduce((sum, blob) => sum + blob.bytes.byteLength, 0),
      })
      const hashes = fresh.map((blob) => blob.sha256)
      // An expired row of the same hash is replaced, so the unique index admits the new one.
      const expired = await tx
        .delete(workspaceSourceStagedBlob)
        .where(
          and(
            inScope(target),
            inArray(workspaceSourceStagedBlob.sha256, hashes),
            sql`${workspaceSourceStagedBlob.expiresAt} <= now()`
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
          set: { expiresAt: expiry() },
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

/** Removes the staged blobs among `hashes` (rows, then objects): an apply consumed them. */
export async function releaseStagedBlobs(
  target: StagingScope,
  hashes: readonly string[]
): Promise<void> {
  if (hashes.length === 0) return
  const removed = await db
    .delete(workspaceSourceStagedBlob)
    .where(and(inScope(target), inArray(workspaceSourceStagedBlob.sha256, [...new Set(hashes)])))
    .returning({ storageKey: workspaceSourceStagedBlob.storageKey })
  await removeObjects(removed.map((row) => row.storageKey))
}

/**
 * Deletes expired staged blobs, oldest first, up to `maxBatches` passes of {@link SWEEP_BATCH}:
 * each pass removes the rows, then their objects. Returns how many rows it removed.
 */
export async function sweepExpiredStagedBlobs(maxBatches = 20): Promise<number> {
  let removed = 0
  for (let pass = 0; pass < maxBatches; pass++) {
    const expired = await db
      .select({ id: workspaceSourceStagedBlob.id })
      .from(workspaceSourceStagedBlob)
      .where(lt(workspaceSourceStagedBlob.expiresAt, new Date()))
      .orderBy(asc(workspaceSourceStagedBlob.expiresAt))
      .limit(SWEEP_BATCH)
    if (expired.length === 0) break
    const rows = await db
      .delete(workspaceSourceStagedBlob)
      .where(
        and(
          inArray(
            workspaceSourceStagedBlob.id,
            expired.map((row) => row.id)
          ),
          lt(workspaceSourceStagedBlob.expiresAt, new Date())
        )
      )
      .returning({ storageKey: workspaceSourceStagedBlob.storageKey })
    await removeObjects(rows.map((row) => row.storageKey))
    removed += rows.length
    if (expired.length < SWEEP_BATCH) break
  }
  return removed
}
