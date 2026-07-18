import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import { appArtifactBlob } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import {
  type ArtifactManifest,
  canonicalManifestBytes,
  hashArtifactManifest,
  isRealArtifactHash,
  parseAndVerifyArtifactManifest,
  stripArtifactHashPrefix,
} from '@/lib/apps/artifacts/manifest'
import { getEnv } from '@/lib/core/config/env'

const logger = createLogger('AppArtifactStore')
const ARTIFACT_STORE_MUTATION_LOCK_KEY = 1_938_504_771

/**
 * Coordinates artifact persistence and GC across processes sharing the same DB/root.
 * The transaction exists only to hold the advisory lock; filesystem and registry work
 * intentionally runs through the global pool while the lock remains held.
 */
export async function withArtifactStoreMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ARTIFACT_STORE_MUTATION_LOCK_KEY})`)
    return runOutsideTransactionContext(fn)
  })
}

export function getAppsArtifactRoot(): string {
  const configured = (getEnv('APPS_ARTIFACT_ROOT') || '').trim()
  if (configured) return resolve(configured)
  return resolve(process.cwd(), '.artifacts')
}

/** Real builds/persist require an explicit shared root (Sim + apps-host must match). */
export function requireAppsArtifactRoot(): string {
  const configured = (getEnv('APPS_ARTIFACT_ROOT') || '').trim()
  if (!configured) {
    throw new Error(
      'APPS_ARTIFACT_ROOT must be set to an absolute shared path for real app artifact builds (same value for Sim and apps-host).'
    )
  }
  return resolve(configured)
}

function blobPath(root: string, contentHash: string): string {
  return join(root, 'blobs', contentHash)
}

function manifestPath(root: string, manifestHash: string): string {
  return join(root, 'manifests', `${stripArtifactHashPrefix(manifestHash)}.json`)
}

export type PersistArtifactFile = {
  path: string
  content: Buffer
  hash: string
  contentType: string
  byteSize: number
}

/** Validate caller-supplied bundle before any disk/DB write (E2B security boundary). */
export function assertArtifactBundleInputs(params: {
  manifest: ArtifactManifest
  manifestHash: string
  files: PersistArtifactFile[]
}): { ok: true; canonical: string } | { ok: false; error: string } {
  if (!isRealArtifactHash(params.manifestHash)) {
    return { ok: false, error: 'Invalid real artifact manifest hash' }
  }
  if (hashArtifactManifest(params.manifest) !== params.manifestHash) {
    return { ok: false, error: 'Manifest hash does not match canonical manifest bytes' }
  }
  if (!parseAndVerifyArtifactManifest(params.manifest, params.manifestHash)) {
    return { ok: false, error: 'Manifest failed structural verification' }
  }

  const byPath = new Map(params.files.map((f) => [f.path, f]))
  if (byPath.size !== params.files.length) {
    return { ok: false, error: 'Duplicate paths in persist files' }
  }
  if (byPath.size !== params.manifest.files.length) {
    return { ok: false, error: 'Persist files count does not match manifest' }
  }

  for (const entry of params.manifest.files) {
    const file = byPath.get(entry.path)
    if (!file) {
      return { ok: false, error: `Missing persist file for manifest path ${entry.path}` }
    }
    if (
      file.hash !== entry.hash ||
      file.byteSize !== entry.byteSize ||
      file.contentType !== entry.contentType
    ) {
      return { ok: false, error: `Persist metadata mismatch for ${entry.path}` }
    }
    if (file.content.byteLength !== entry.byteSize) {
      return { ok: false, error: `Blob size mismatch for ${entry.path}` }
    }
    const recomputed = createHash('sha256').update(file.content).digest('hex')
    if (recomputed !== entry.hash) {
      return { ok: false, error: `Blob hash mismatch for ${entry.path}` }
    }
  }

  for (const path of byPath.keys()) {
    if (!params.manifest.files.some((f) => f.path === path)) {
      return { ok: false, error: `Extra persist file not in manifest: ${path}` }
    }
  }

  return { ok: true, canonical: canonicalManifestBytes(params.manifest) }
}

/**
 * Content-addressed write: never overwrite an existing file.
 * If present, accept only when bytes match; otherwise reject.
 */
export async function writeContentAddressedFile(
  path: string,
  content: string | Buffer
): Promise<{ ok: true } | { ok: false; error: string }> {
  await mkdir(dirname(path), { recursive: true })
  const expected = typeof content === 'string' ? Buffer.from(content, 'utf8') : content

  try {
    const existing = await readFile(path)
    if (existing.equals(expected)) return { ok: true }
    return { ok: false, error: `Corrupt existing content-addressed file: ${path}` }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }

  // Write via temp + exclusive create so we never rename-over an immutable object.
  const tmp = `${path}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, expected, { flag: 'wx' })
    try {
      await writeFile(path, expected, { flag: 'wx' })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        const existing = await readFile(path)
        if (!existing.equals(expected)) {
          return { ok: false, error: `Corrupt existing content-addressed file: ${path}` }
        }
        return { ok: true }
      }
      throw error
    }
    return { ok: true }
  } finally {
    await unlink(tmp).catch(() => undefined)
  }
}

async function writeCanonicalManifest(
  path: string,
  canonical: string,
  manifestHash: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const existing = await readFile(path, 'utf8')
    const parsed = parseAndVerifyArtifactManifest(JSON.parse(existing), manifestHash)
    if (parsed) return { ok: true }
    return { ok: false, error: `Corrupt existing content-addressed manifest: ${path}` }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') {
      if (error instanceof SyntaxError) {
        return { ok: false, error: `Corrupt existing content-addressed manifest: ${path}` }
      }
      throw error
    }
  }
  return writeContentAddressedFile(path, canonical)
}

/**
 * Persist trusted build outputs as content-addressed blobs + a canonical manifest.
 * Layout (shared with apps-host via APPS_ARTIFACT_ROOT):
 *   blobs/{sha256}
 *   manifests/{manifestDigest}.json
 */
export async function persistArtifactBundle(params: {
  manifest: ArtifactManifest
  manifestHash: string
  files: PersistArtifactFile[]
  /** Override root (tests). */
  root?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const validated = assertArtifactBundleInputs(params)
  if (!validated.ok) return validated

  const root = params.root ?? requireAppsArtifactRoot()
  const persist = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    try {
      await mkdir(join(root, 'blobs'), { recursive: true })
      await mkdir(join(root, 'manifests'), { recursive: true })

      for (const file of params.files) {
        const path = blobPath(root, file.hash)
        const written = await writeContentAddressedFile(path, file.content)
        if (!written.ok) return written

        await db
          .insert(appArtifactBlob)
          .values({
            hash: file.hash,
            storageKey: `blobs/${file.hash}`,
            contentType: file.contentType,
            byteSize: file.byteSize,
          })
          .onConflictDoNothing()
      }

      const mPath = manifestPath(root, params.manifestHash)
      const writtenManifest = await writeCanonicalManifest(
        mPath,
        validated.canonical,
        params.manifestHash
      )
      if (!writtenManifest.ok) return writtenManifest

      const manifestDigest = stripArtifactHashPrefix(params.manifestHash)
      await db
        .insert(appArtifactBlob)
        .values({
          hash: manifestDigest,
          storageKey: `manifests/${manifestDigest}.json`,
          contentType: 'application/json',
          byteSize: Buffer.byteLength(validated.canonical, 'utf8'),
        })
        .onConflictDoNothing()

      logger.info('Persisted artifact bundle', {
        manifestHash: params.manifestHash,
        fileCount: params.files.length,
        root,
      })
      return { ok: true }
    } catch (error) {
      logger.error('Failed to persist artifact bundle', { error })
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to persist artifacts',
      }
    }
  }

  // Test roots are isolated; production/shared roots coordinate with GC.
  return params.root ? persist() : withArtifactStoreMutationLock(persist)
}

export async function loadArtifactManifest(
  manifestHash: string,
  root = getAppsArtifactRoot()
): Promise<ArtifactManifest | null> {
  if (!isRealArtifactHash(manifestHash)) return null
  try {
    const raw = await readFile(manifestPath(root, manifestHash), 'utf8')
    return parseAndVerifyArtifactManifest(JSON.parse(raw), manifestHash)
  } catch {
    return null
  }
}

async function verifyBlobOnDisk(
  contentHash: string,
  expectedByteSize: number,
  root = getAppsArtifactRoot()
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return false
  // Publish/rollback call this from inside db.transaction; blob registry reads must
  // use the global pool via the tripwire escape hatch (not a second checkout by accident).
  const rows = await runOutsideTransactionContext(() =>
    db
      .select({
        hash: appArtifactBlob.hash,
        byteSize: appArtifactBlob.byteSize,
      })
      .from(appArtifactBlob)
      .where(eq(appArtifactBlob.hash, contentHash))
      .limit(1)
  )
  const row = rows[0]
  if (!row || row.byteSize !== expectedByteSize) return false

  try {
    const buf = await readFile(blobPath(root, contentHash))
    if (buf.byteLength !== expectedByteSize) return false
    const digest = createHash('sha256').update(buf).digest('hex')
    return digest === contentHash
  } catch {
    return false
  }
}

/** Publish-grade check: verified manifest + every file blob present with matching hash/size. */
export async function assertArtifactBundleReady(
  manifestHash: string,
  root = getAppsArtifactRoot()
): Promise<{ ok: true } | { ok: false; error: string; code: 'ARTIFACT_MISSING' }> {
  const manifest = await loadArtifactManifest(manifestHash, root)
  if (!manifest) {
    return {
      ok: false,
      code: 'ARTIFACT_MISSING',
      error:
        'Release artifact manifest is missing or failed integrity check; rebuild before publishing.',
    }
  }
  for (const file of manifest.files) {
    const ok = await verifyBlobOnDisk(file.hash, file.byteSize, root)
    if (!ok) {
      return {
        ok: false,
        code: 'ARTIFACT_MISSING',
        error: `Release artifact blob missing or corrupt for ${file.path}; rebuild before publishing.`,
      }
    }
  }
  return { ok: true }
}
