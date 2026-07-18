import { unlink } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { db } from '@sim/db'
import {
  appArtifactBlob,
  appBuild,
  appPreviewSession,
  appProject,
  appRelease,
  appSourceBlob,
  appSourceFile,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { isRealArtifactHash, stripArtifactHashPrefix } from '@/lib/apps/artifacts/manifest'
import {
  getAppsArtifactRoot,
  loadArtifactManifest,
  requireAppsArtifactRoot,
  withArtifactStoreMutationLock,
} from '@/lib/apps/artifacts/store'
import { getEnv, isTruthy } from '@/lib/core/config/env'

const logger = createLogger('AppBlobGC')

const DEFAULT_MIN_AGE_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 250
const MAX_BATCHES = 20

type ArtifactBlobRow = {
  hash: string
  storageKey: string
  createdAt: Date
}

export type AppBlobGcResult = {
  dryRun: boolean
  sourceCandidates: number
  sourceDeleted: number
  artifactCandidates: number
  artifactDeleted: number
  artifactSkippedUnsafe: number
  artifactAborted: boolean
}

export async function computeRetainedArtifactHashes(
  manifestHashes: Iterable<string>,
  loader: typeof loadArtifactManifest = loadArtifactManifest
): Promise<{ ok: true; hashes: Set<string> } | { ok: false; error: string }> {
  const retained = new Set<string>()
  for (const manifestHash of new Set(manifestHashes)) {
    if (!isRealArtifactHash(manifestHash)) continue
    const manifest = await loader(manifestHash)
    if (!manifest) {
      return {
        ok: false,
        error: `Retained artifact manifest ${manifestHash} is unavailable; artifact GC aborted.`,
      }
    }
    retained.add(stripArtifactHashPrefix(manifestHash))
    for (const file of manifest.files) retained.add(file.hash)
  }
  return { ok: true, hashes: retained }
}

export function selectArtifactGcCandidates(
  rows: ArtifactBlobRow[],
  retained: Set<string>,
  cutoff: Date
): ArtifactBlobRow[] {
  return rows.filter((row) => row.createdAt < cutoff && !retained.has(row.hash))
}

export function resolveArtifactGcPath(
  root: string,
  row: Pick<ArtifactBlobRow, 'hash' | 'storageKey'>
): string | null {
  const isHash = /^[0-9a-f]{64}$/.test(row.hash)
  if (!isHash) return null
  const expectedBlob = `blobs/${row.hash}`
  const expectedManifest = `manifests/${row.hash}.json`
  if (row.storageKey !== expectedBlob && row.storageKey !== expectedManifest) return null

  const normalizedRoot = resolve(root)
  const absolute = resolve(normalizedRoot, row.storageKey)
  if (!absolute.startsWith(normalizedRoot + sep)) return null
  return absolute
}

async function deleteSourceBlobs(cutoff: Date, dryRun: boolean) {
  let candidates = 0
  let deleted = 0

  if (dryRun) {
    const [row] = await db
      .select({ count: count() })
      .from(appSourceBlob)
      .where(
        and(
          lt(appSourceBlob.createdAt, cutoff),
          notExists(
            db
              .select({ one: sql`1` })
              .from(appSourceFile)
              .where(eq(appSourceFile.contentHash, appSourceBlob.hash))
          )
        )
      )
    return { candidates: Number(row?.count ?? 0), deleted: 0 }
  }

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await db
      .select({ hash: appSourceBlob.hash })
      .from(appSourceBlob)
      .where(
        and(
          lt(appSourceBlob.createdAt, cutoff),
          notExists(
            db
              .select({ one: sql`1` })
              .from(appSourceFile)
              .where(eq(appSourceFile.contentHash, appSourceBlob.hash))
          )
        )
      )
      .limit(BATCH_SIZE)

    if (rows.length === 0) break
    candidates += rows.length

    const hashes = rows.map((row) => row.hash)
    const removed = await db
      .delete(appSourceBlob)
      .where(
        and(
          inArray(appSourceBlob.hash, hashes),
          notExists(
            db
              .select({ one: sql`1` })
              .from(appSourceFile)
              .where(eq(appSourceFile.contentHash, appSourceBlob.hash))
          )
        )
      )
      .returning({ hash: appSourceBlob.hash })
    deleted += removed.length
    if (rows.length < BATCH_SIZE) break
  }

  return { candidates, deleted }
}

async function loadRetainedManifestHashes(now: Date): Promise<string[]> {
  const [releaseRows, previewRows, currentDraftBuildRows] = await Promise.all([
    db
      .select({ artifactManifestHash: appRelease.artifactManifestHash })
      .from(appRelease)
      .where(
        or(
          eq(appRelease.state, 'prepared'),
          eq(appRelease.state, 'published'),
          and(eq(appRelease.state, 'revoked'), eq(appRelease.revokedReason, 'vacated'))
        )
      ),
    db
      .select({ artifactManifestHash: appPreviewSession.artifactManifestHash })
      .from(appPreviewSession)
      .where(
        and(
          isNull(appPreviewSession.stoppedAt),
          gt(appPreviewSession.expiresAt, now),
          isNotNull(appPreviewSession.artifactManifestHash)
        )
      ),
    db
      .select({ artifactManifestHash: appBuild.artifactManifestHash })
      .from(appBuild)
      .innerJoin(
        appProject,
        and(
          eq(appProject.id, appBuild.projectId),
          eq(appProject.draftRevisionId, appBuild.revisionId)
        )
      )
      .where(
        and(
          eq(appBuild.status, 'succeeded'),
          isNotNull(appBuild.artifactManifestHash),
          isNull(appProject.archivedAt)
        )
      ),
  ])

  return [...releaseRows, ...previewRows, ...currentDraftBuildRows].flatMap((row) =>
    row.artifactManifestHash ? [row.artifactManifestHash] : []
  )
}

async function hasRunningBuild(): Promise<boolean> {
  const [row] = await db
    .select({ id: appBuild.id })
    .from(appBuild)
    .where(eq(appBuild.status, 'running'))
    .limit(1)
  return Boolean(row)
}

async function deleteArtifactBlobs(
  cutoff: Date,
  retained: Set<string>,
  dryRun: boolean
): Promise<{
  candidates: number
  deleted: number
  skippedUnsafe: number
}> {
  if (await hasRunningBuild()) {
    logger.info('Skipping artifact GC while an app build is running')
    return { candidates: 0, deleted: 0, skippedUnsafe: 0 }
  }

  requireAppsArtifactRoot()
  const root = getAppsArtifactRoot()
  let candidates = 0
  let deleted = 0
  let skippedUnsafe = 0

  if (dryRun) {
    const retainedHashes = [...retained]
    const [row] = await db
      .select({ count: count() })
      .from(appArtifactBlob)
      .where(
        and(
          lt(appArtifactBlob.createdAt, cutoff),
          retainedHashes.length > 0 ? notInArray(appArtifactBlob.hash, retainedHashes) : undefined
        )
      )
    return {
      candidates: Number(row?.count ?? 0),
      deleted: 0,
      skippedUnsafe: 0,
    }
  }

  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const retainedHashes = [...retained]
    const oldRows = await db
      .select({
        hash: appArtifactBlob.hash,
        storageKey: appArtifactBlob.storageKey,
        createdAt: appArtifactBlob.createdAt,
      })
      .from(appArtifactBlob)
      .where(
        and(
          lt(appArtifactBlob.createdAt, cutoff),
          retainedHashes.length > 0 ? notInArray(appArtifactBlob.hash, retainedHashes) : undefined
        )
      )
      .limit(BATCH_SIZE)

    const rows = selectArtifactGcCandidates(oldRows, retained, cutoff)
    if (oldRows.length === 0) break
    candidates += rows.length

    const removable: string[] = []
    for (const row of rows) {
      const path = resolveArtifactGcPath(root, row)
      if (!path) {
        skippedUnsafe += 1
        logger.warn('Skipping artifact blob with unexpected storage key', {
          hash: row.hash,
          storageKey: row.storageKey,
        })
        retained.add(row.hash)
        continue
      }
      try {
        await unlink(path)
        removable.push(row.hash)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          removable.push(row.hash)
        } else {
          logger.warn('Failed to remove artifact blob file; retaining registry row', {
            hash: row.hash,
            error,
          })
        }
      }
    }

    if (removable.length > 0) {
      const removed = await db
        .delete(appArtifactBlob)
        .where(inArray(appArtifactBlob.hash, removable))
        .returning({ hash: appArtifactBlob.hash })
      deleted += removed.length
    }
    if (oldRows.length < BATCH_SIZE) break
  }

  return { candidates, deleted, skippedUnsafe }
}

export async function runAppBlobGc(options?: {
  dryRun?: boolean
  now?: Date
  minAgeMs?: number
}): Promise<AppBlobGcResult> {
  const now = options?.now ?? new Date()
  const configuredAgeHours = Number(getEnv('APPS_BLOB_GC_MIN_AGE_HOURS') || '')
  const minAgeMs =
    options?.minAgeMs ??
    (Number.isFinite(configuredAgeHours) && configuredAgeHours > 0
      ? configuredAgeHours * 60 * 60 * 1000
      : DEFAULT_MIN_AGE_MS)
  // CAS rows have no orphanedAt timestamp. The grace window therefore protects
  // newly created blobs; an older blob may become eligible immediately after its
  // last reference is removed. Retention snapshots + advisory locking make that safe.
  const cutoff = new Date(now.getTime() - minAgeMs)
  const dryRun = options?.dryRun ?? isTruthy(getEnv('APPS_BLOB_GC_DRY_RUN'))

  const source = await deleteSourceBlobs(cutoff, dryRun)
  let artifactResult:
    | {
        retained: true
        artifacts: Awaited<ReturnType<typeof deleteArtifactBlobs>>
      }
    | { retained: false; error: string }
  try {
    artifactResult = await withArtifactStoreMutationLock(async () => {
      const manifestHashes = await loadRetainedManifestHashes(now)
      const retained = await computeRetainedArtifactHashes(manifestHashes)
      if (!retained.ok) return { retained: false as const, error: retained.error }
      const artifacts = await deleteArtifactBlobs(cutoff, retained.hashes, dryRun)
      return { retained: true as const, artifacts }
    })
  } catch (error) {
    logger.error('Artifact GC aborted before deletion', { error })
    return {
      dryRun,
      sourceCandidates: source.candidates,
      sourceDeleted: source.deleted,
      artifactCandidates: 0,
      artifactDeleted: 0,
      artifactSkippedUnsafe: 0,
      artifactAborted: true,
    }
  }
  if (!artifactResult.retained) {
    logger.error(artifactResult.error)
    return {
      dryRun,
      sourceCandidates: source.candidates,
      sourceDeleted: source.deleted,
      artifactCandidates: 0,
      artifactDeleted: 0,
      artifactSkippedUnsafe: 0,
      artifactAborted: true,
    }
  }
  const { artifacts } = artifactResult
  const result: AppBlobGcResult = {
    dryRun,
    sourceCandidates: source.candidates,
    sourceDeleted: source.deleted,
    artifactCandidates: artifacts.candidates,
    artifactDeleted: artifacts.deleted,
    artifactSkippedUnsafe: artifacts.skippedUnsafe,
    artifactAborted: false,
  }
  logger.info('App blob GC complete', result)
  return result
}
