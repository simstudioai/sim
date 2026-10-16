import { opendir, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import { project, uploadSession } from '@sim/db/schema'
import { describeError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  continueOutboxHandler,
  deferOutboxHandler,
  enqueueOutboxEvent,
  type OutboxEventContext,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import type { DbTransaction } from '@/lib/db/types'
import {
  PROJECT_FILE_PREFIX_CLEANUP_EVENT,
  PROJECT_STORAGE_RECONCILE_EVENT,
} from '@/lib/projects/files/outbox-events'
import {
  getStorageConfig,
  type StorageContext,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'
import { isObjectNotFoundError } from '@/lib/uploads/core/errors'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { abortProviderUpload, UPLOAD_URL_TTL_MS } from '@/lib/uploads/upload-session/provider'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'
import { PROJECT_FILE_UPLOAD_BINDING_KEY } from '@/lib/uploads/upload-session/types'

const PAGE_SIZE = 500
const CLOCK_SKEW_MS = 60_000

type UploadCleanup = Pick<
  UploadSessionRecord,
  'id' | 'method' | 'storageProvider' | 'providerUploadId' | 'finalKey'
>
interface CleanupPayload {
  projectId: string
  uploads?: UploadCleanup[]
  uploadCursor?: number
}

/** Expired signatures stop new transfers, but a transfer already in progress may finish later. */
export function projectUploadCleanupAvailableAt(now = new Date()): Date {
  return storageCleanupAvailableAt(now)
}

/** Earliest moment no upload URL signed before `now` can still write an object. */
export function storageCleanupAvailableAt(now = new Date()): Date {
  return new Date(now.getTime() + UPLOAD_URL_TTL_MS + CLOCK_SKEW_MS)
}

function prefixFor(projectId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) throw new Error('Invalid Project cleanup identity')
  return `project/${projectId}/`
}

function parsePayload(value: unknown): CleanupPayload {
  if (!isRecordLike(value) || typeof value.projectId !== 'string')
    throw new Error('Invalid Project cleanup payload')
  const prefix = prefixFor(value.projectId)
  const uploadCursor = value.uploadCursor === undefined ? 0 : value.uploadCursor
  if (
    !Number.isSafeInteger(uploadCursor) ||
    typeof uploadCursor !== 'number' ||
    uploadCursor < 0 ||
    uploadCursor > PAGE_SIZE
  )
    throw new Error('Invalid retired upload cursor')
  if (value.uploads === undefined) return { projectId: value.projectId, uploadCursor }
  if (!Array.isArray(value.uploads) || value.uploads.length > PAGE_SIZE)
    throw new Error('Invalid upload cleanup batch')
  const uploads = value.uploads.map((upload): UploadCleanup => {
    if (
      !isRecordLike(upload) ||
      typeof upload.id !== 'string' ||
      !/^[a-zA-Z0-9_-]+$/.test(upload.id) ||
      (upload.method !== 'put' && upload.method !== 'multipart') ||
      (upload.storageProvider !== 'local' &&
        upload.storageProvider !== 's3' &&
        upload.storageProvider !== 'blob' &&
        upload.storageProvider !== 'gcs') ||
      (upload.providerUploadId !== null && typeof upload.providerUploadId !== 'string') ||
      typeof upload.finalKey !== 'string' ||
      !upload.finalKey.startsWith(prefix)
    )
      throw new Error('Invalid retired upload descriptor')
    return {
      id: upload.id,
      method: upload.method,
      storageProvider: upload.storageProvider,
      providerUploadId: upload.providerUploadId,
      finalKey: upload.finalKey,
    }
  })
  return { projectId: value.projectId, uploads, uploadCursor }
}

async function enqueueSweeps(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupPayload,
  retiredAt = new Date()
) {
  await enqueueOutboxEvent(executor, PROJECT_FILE_PREFIX_CLEANUP_EVENT, payload)
  await enqueueOutboxEvent(executor, PROJECT_FILE_PREFIX_CLEANUP_EVENT, payload, {
    availableAt: projectUploadCleanupAvailableAt(retiredAt),
  })
}

/** Must follow Project and payer locks and precede directory/file locks in the retirement transaction. */
export async function retireProjectUploadsInTx(
  tx: DbTransaction,
  projectId: string
): Promise<void> {
  prefixFor(projectId)
  const now = new Date()
  let afterId = ''
  let queued = false
  for (;;) {
    const rows = await tx
      .select()
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.purpose, 'project_file'),
          sql`${uploadSession.metadata}->${PROJECT_FILE_UPLOAD_BINDING_KEY}->>'entityId' = ${projectId}`,
          isNull(uploadSession.completedFileId),
          gt(uploadSession.id, afterId)
        )
      )
      .orderBy(asc(uploadSession.id))
      .limit(PAGE_SIZE)
      .for('update')
    if (!rows.length) break
    const uploads = rows.map(
      (row): UploadCleanup => ({
        id: row.id,
        method: row.method,
        storageProvider: row.storageProvider,
        providerUploadId: row.providerUploadId,
        finalKey: row.finalKey,
      })
    )
    parsePayload({ projectId, uploads })
    await tx
      .update(uploadSession)
      .set({
        status: 'aborting',
        expiresAt: now,
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt: now,
      })
      .where(
        inArray(
          uploadSession.id,
          rows.map((row) => row.id)
        )
      )
    await enqueueSweeps(tx, { projectId, uploads }, now)
    queued = true
    afterId = rows[rows.length - 1].id
  }
  if (!queued) await enqueueSweeps(tx, { projectId }, now)
}

/** Late provider responses schedule their own durable sweep after the owner has disappeared. */
export async function queueRetiredProjectUploadCleanup(
  session: UploadSessionRecord
): Promise<boolean> {
  if (session.purpose !== 'project_file') return false
  const binding = session.metadata[PROJECT_FILE_UPLOAD_BINDING_KEY]
  if (!isRecordLike(binding) || typeof binding.entityId !== 'string')
    throw new Error('Invalid Project upload binding')
  const payload = parsePayload({
    projectId: binding.entityId,
    uploads: [
      {
        id: session.id,
        method: session.method,
        storageProvider: session.storageProvider,
        providerUploadId: session.providerUploadId,
        finalKey: session.finalKey,
      },
    ],
  })
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: project.id })
      .from(project)
      .where(eq(project.id, payload.projectId))
    if (owner) return false
    await tx
      .update(uploadSession)
      .set({
        status: 'aborting',
        expiresAt: new Date(),
        processingLeaseId: null,
        processingLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(uploadSession.id, session.id),
          eq(uploadSession.purpose, 'project_file'),
          eq(uploadSession.finalKey, session.finalKey),
          isNull(uploadSession.completedFileId)
        )
      )
    await enqueueSweeps(tx, payload)
    return true
  })
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(describeError(error).code ?? '')) throw error
  }
}

async function localKeys(prefix: string, signal: AbortSignal): Promise<string[]> {
  const keys: string[] = []
  async function visit(key: string): Promise<void> {
    signal.throwIfAborted()
    let directory
    try {
      directory = await opendir(join(UPLOAD_DIR_SERVER, key))
    } catch (error) {
      if (describeError(error).code === 'ENOENT') return
      throw error
    }
    for await (const entry of directory) {
      signal.throwIfAborted()
      const child = `${key}${entry.name}`
      if (entry.isDirectory()) await visit(`${child}/`)
      else keys.push(child)
      if (keys.length >= PAGE_SIZE) return
    }
    await removeEmptyDirectory(join(UPLOAD_DIR_SERVER, key))
  }
  await visit(prefix)
  return keys
}

/** One provider page of object keys; `done` once the listing has nothing after this page. */
interface StorageKeyPage {
  keys: string[]
  done: boolean
  /** Provider cursor for the following page, valid only within the current run. */
  nextPageToken?: string
}

/**
 * Lists one page of object keys under `prefix` in the bucket serving `context`. A local listing
 * has no cursor: it returns the first keys still on disk, so callers advance by deleting them.
 */
export async function listStorageKeyPage(
  prefix: string,
  context: StorageContext,
  signal: AbortSignal,
  pageToken?: string
): Promise<StorageKeyPage> {
  signal.throwIfAborted()
  if (USE_S3_STORAGE) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const { getS3Client } = await import('@/lib/uploads/providers/s3/client')
    const config = getStorageConfig(context)
    const page = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: PAGE_SIZE,
        ...(pageToken ? { ContinuationToken: pageToken } : {}),
      }),
      { abortSignal: signal }
    )
    const nextPageToken = page.IsTruncated ? page.NextContinuationToken : undefined
    return {
      keys: (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
      done: !nextPageToken,
      ...(nextPageToken ? { nextPageToken } : {}),
    }
  }
  if (USE_BLOB_STORAGE) {
    const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
    const config = getStorageConfig(context)
    if (!config.containerName) throw new Error(`Blob container missing for ${context} storage`)
    const pages = (await getBlobServiceClient())
      .getContainerClient(config.containerName)
      .listBlobsFlat({ prefix, abortSignal: signal })
      .byPage({ maxPageSize: PAGE_SIZE, ...(pageToken ? { continuationToken: pageToken } : {}) })
    const page = await pages.next()
    if (page.done) return { keys: [], done: true }
    const nextPageToken = page.value.continuationToken || undefined
    return {
      keys: page.value.segment.blobItems.map((object) => object.name),
      done: !nextPageToken,
      ...(nextPageToken ? { nextPageToken } : {}),
    }
  }
  if (USE_GCS_STORAGE) {
    const { getGcsClient } = await import('@/lib/uploads/providers/google-cloud-storage/client')
    const config = getStorageConfig(context)
    if (!config.bucket) throw new Error(`Bucket missing for ${context} storage`)
    const [files, nextQuery] = await (await getGcsClient()).bucket(config.bucket).getFiles({
      prefix,
      maxResults: PAGE_SIZE,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    })
    signal.throwIfAborted()
    const nextPageToken =
      isRecordLike(nextQuery) && typeof nextQuery.pageToken === 'string' && nextQuery.pageToken
        ? nextQuery.pageToken
        : undefined
    return {
      keys: files.map((file) => file.name),
      done: !nextPageToken,
      ...(nextPageToken ? { nextPageToken } : {}),
    }
  }
  const keys = await localKeys(prefix, signal)
  return { keys, done: keys.length < PAGE_SIZE }
}

/**
 * Deletes listed keys, each of which must sit under `prefix`, and prunes local directories the
 * deletions empty, never above the prefix itself. Stops before another deletion once the handler
 * deadline is near; `complete` is false when it did. `deleted` counts only objects actually
 * removed: a key already gone (or, locally, one whose on-disk name no storage key resolves to) is
 * no progress, so a caller re-listing the same page can tell that it is stuck.
 */
export async function deleteStorageKeysUnderPrefix(
  prefix: string,
  context: StorageContext,
  keys: readonly string[],
  outbox: Pick<OutboxEventContext, 'signal' | 'deadlineAt'>
): Promise<{ deleted: number; complete: boolean }> {
  if (prefix.length < 2 || !prefix.endsWith('/')) throw new Error('Unbounded storage prefix')
  let attempted = 0
  let deleted = 0
  for (const key of keys) {
    if (!key.startsWith(prefix))
      throw new Error('Storage provider returned a key outside the prefix')
    outbox.signal.throwIfAborted()
    if (attempted > 0 && outbox.deadlineAt && Date.now() + 5000 >= outbox.deadlineAt)
      return { deleted, complete: false }
    attempted++
    let removed = true
    try {
      await deleteFile({ key, context, signal: outbox.signal })
    } catch (error) {
      if (describeError(error).code !== 'ENOENT') throw error
      removed = false
    }
    if (!USE_S3_STORAGE && !USE_BLOB_STORAGE && !USE_GCS_STORAGE) {
      const root = join(UPLOAD_DIR_SERVER, prefix.slice(0, -1))
      let directory = dirname(join(UPLOAD_DIR_SERVER, key))
      while (directory === root || directory.startsWith(`${root}/`)) {
        await removeEmptyDirectory(directory)
        directory = dirname(directory)
      }
    }
    if (removed) deleted++
  }
  return { deleted, complete: true }
}

/** `stalled` when a page that must be re-listed removed nothing, so continuing cannot progress. */
async function sweepPrefix(
  projectId: string,
  context: OutboxEventContext
): Promise<'done' | 'continue' | 'stalled'> {
  const prefix = prefixFor(projectId)
  const { keys } = await listStorageKeyPage(prefix, 'project', context.signal)
  const { deleted, complete } = await deleteStorageKeysUnderPrefix(prefix, 'project', keys, context)
  if (complete && keys.length < PAGE_SIZE) return 'done'
  return deleted > 0 ? 'continue' : 'stalled'
}

const cleanupPrefix: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parsePayload(raw)
  const [owner] = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.id, payload.projectId))
  // Canonical creation always generates fresh Project IDs; an extant owner is never disposable.
  if (owner) throw new Error('Cannot clean storage for an existing Project')
  const uploads = payload.uploads ?? []
  for (let index = payload.uploadCursor ?? 0; index < uploads.length; index++) {
    const upload = uploads[index]
    context.signal.throwIfAborted()
    try {
      await abortProviderUpload({
        provider: upload.storageProvider,
        method: upload.method,
        providerUploadId: upload.providerUploadId,
        uploadId: upload.id,
        key: upload.finalKey,
        context: 'project',
      })
    } catch (error) {
      const details = describeError(error)
      if (
        details.code !== 'NoSuchUpload' &&
        details.name !== 'NoSuchUpload' &&
        !isObjectNotFoundError(error)
      )
        throw error
    }
    if ((index + 1) % 20 === 0 || index === uploads.length - 1)
      await context.checkpointPayload({ uploadCursor: index + 1 })
    if (context.deadlineAt && Date.now() + 5000 >= context.deadlineAt) {
      await context.checkpointPayload({ uploadCursor: index + 1 })
      return continueOutboxHandler('Continuing retired Project upload cleanup')
    }
  }
  const sweep = await sweepPrefix(payload.projectId, context)
  if (sweep === 'continue') return continueOutboxHandler('Continuing Project storage cleanup')
  if (sweep === 'stalled')
    return deferOutboxHandler('Project storage cleanup removed nothing from a full listing page')
}

/**
 * Retained only to drain rows armed by the former bucket inventory. The inventory deleted every
 * `project/<id>/` prefix without a matching row, which is unsafe because this database is not the
 * authority for a bucket shared with another deployment or restored to an earlier point in time.
 */
const drainRetiredStorageInventory: OutboxHandler<unknown> = async () => {}

export const projectFilePrefixCleanupOutboxHandlers = {
  [PROJECT_FILE_PREFIX_CLEANUP_EVENT]: cleanupPrefix,
  [PROJECT_STORAGE_RECONCILE_EVENT]: drainRetiredStorageInventory,
} satisfies OutboxHandlerRegistry
