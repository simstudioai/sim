import { opendir, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { db } from '@sim/db'
import { outboxEvent, project, uploadSession } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
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
  getStorageConfig,
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

const EVENT_TYPE = 'project-file.storage.prefix-cleanup'
const RECONCILE_EVENT_TYPE = 'project-file.storage.reconcile'
const PAGE_SIZE = 500
const CLOCK_SKEW_MS = 60_000
const RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000
const logger = createLogger('ProjectStorageCleanup')

type UploadCleanup = Pick<
  UploadSessionRecord,
  'id' | 'method' | 'storageProvider' | 'providerUploadId' | 'finalKey'
>
interface CleanupPayload {
  projectId: string
  uploads?: UploadCleanup[]
  uploadCursor?: number
}

interface ReconcilePayload {
  cursor: string | null
  page: string[]
  index: number
  unfinished: string[]
  nextCursor: string | null
  failedPrefixes: number
}

/** Resume an existing inventory after its provider-outage retry budget and cooldown expire. */
export async function recoverProjectStorageReconciliation(now = new Date()): Promise<void> {
  await db
    .update(outboxEvent)
    .set({
      status: 'pending',
      attempts: 0,
      lockedAt: null,
      lastError: null,
      processedAt: null,
      availableAt: now,
    })
    .where(
      and(
        eq(outboxEvent.id, RECONCILE_EVENT_TYPE),
        eq(outboxEvent.eventType, RECONCILE_EVENT_TYPE),
        eq(outboxEvent.status, 'dead_letter'),
        lte(outboxEvent.processedAt, new Date(now.getTime() - RECONCILE_INTERVAL_MS))
      )
    )
}

/** Expired signatures stop new transfers, but a transfer already in progress may finish later. */
function projectUploadCleanupAvailableAt(now = new Date()): Date {
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
  await enqueueOutboxEvent(executor, EVENT_TYPE, payload)
  await enqueueOutboxEvent(executor, EVENT_TYPE, payload, {
    availableAt: projectUploadCleanupAvailableAt(retiredAt),
  })
  await executor
    .insert(outboxEvent)
    .values({
      id: RECONCILE_EVENT_TYPE,
      eventType: RECONCILE_EVENT_TYPE,
      payload: {},
      availableAt: projectUploadCleanupAvailableAt(retiredAt),
    })
    .onConflictDoUpdate({
      target: outboxEvent.id,
      set: {
        status: 'pending',
        payload: {},
        attempts: 0,
        lockedAt: null,
        lastError: null,
        processedAt: null,
        availableAt: projectUploadCleanupAvailableAt(retiredAt),
      },
      setWhere: inArray(outboxEvent.status, ['completed', 'dead_letter']),
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

async function listKeys(prefix: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted()
  if (USE_S3_STORAGE) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const { getS3Client } = await import('@/lib/uploads/providers/s3/client')
    const config = getStorageConfig('project')
    const page = await getS3Client().send(
      new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: PAGE_SIZE }),
      { abortSignal: signal }
    )
    return (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : []))
  }
  if (USE_BLOB_STORAGE) {
    const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
    const config = getStorageConfig('project')
    if (!config.containerName) throw new Error('Project blob container missing')
    const pages = (await getBlobServiceClient())
      .getContainerClient(config.containerName)
      .listBlobsFlat({ prefix, includeUncommitedBlobs: true, abortSignal: signal })
      .byPage({ maxPageSize: PAGE_SIZE })
    const page = await pages.next()
    return page.done ? [] : page.value.segment.blobItems.map((object) => object.name)
  }
  if (USE_GCS_STORAGE) {
    const { getGcsClient } = await import('@/lib/uploads/providers/google-cloud-storage/client')
    const config = getStorageConfig('project')
    if (!config.bucket) throw new Error('Project bucket missing')
    const [files] = await (await getGcsClient())
      .bucket(config.bucket)
      .getFiles({ prefix, maxResults: PAGE_SIZE, autoPaginate: false })
    signal.throwIfAborted()
    return files.map((file) => file.name)
  }
  return localKeys(prefix, signal)
}

async function sweepPrefix(projectId: string, context: OutboxEventContext): Promise<boolean> {
  const prefix = prefixFor(projectId)
  const keys = await listKeys(prefix, context.signal)
  let deleted = 0
  for (const key of keys) {
    if (!key.startsWith(prefix)) throw new Error('Storage provider returned a foreign Project key')
    context.signal.throwIfAborted()
    if (deleted > 0 && context.deadlineAt && Date.now() + 5000 >= context.deadlineAt) return false
    try {
      await deleteFile({ key, context: 'project', signal: context.signal })
    } catch (error) {
      if (describeError(error).code !== 'ENOENT') throw error
    }
    if (!USE_S3_STORAGE && !USE_BLOB_STORAGE && !USE_GCS_STORAGE) {
      const root = join(UPLOAD_DIR_SERVER, 'project', projectId)
      let directory = dirname(join(UPLOAD_DIR_SERVER, key))
      while (directory === root || directory.startsWith(`${root}/`)) {
        await removeEmptyDirectory(directory)
        directory = dirname(directory)
      }
    }
    deleted++
  }
  return keys.length < PAGE_SIZE
}

function readProjectId(prefix: string): string {
  const match = /^project\/([a-zA-Z0-9_-]+)\/$/.exec(prefix)
  if (!match) throw new Error('Storage provider returned an invalid Project prefix')
  return match[1]
}

async function listProjectPrefixes(cursor: string | null, signal: AbortSignal) {
  signal.throwIfAborted()
  if (USE_S3_STORAGE) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
    const { getS3Client } = await import('@/lib/uploads/providers/s3/client')
    const page = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: getStorageConfig('project').bucket,
        Prefix: 'project/',
        Delimiter: '/',
        MaxKeys: PAGE_SIZE,
        ...(cursor ? { ContinuationToken: cursor } : {}),
      }),
      { abortSignal: signal }
    )
    return {
      page: (page.CommonPrefixes ?? []).map((entry) => readProjectId(entry.Prefix ?? '')),
      nextCursor: page.NextContinuationToken ?? null,
    }
  }
  if (USE_BLOB_STORAGE) {
    const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
    const config = getStorageConfig('project')
    if (!config.containerName) throw new Error('Project blob container missing')
    const pages = (await getBlobServiceClient())
      .getContainerClient(config.containerName)
      .listBlobsByHierarchy('/', {
        prefix: 'project/',
        includeUncommitedBlobs: true,
        abortSignal: signal,
      })
      .byPage({ maxPageSize: PAGE_SIZE, ...(cursor ? { continuationToken: cursor } : {}) })
    const page = await pages.next()
    return page.done
      ? { page: [], nextCursor: null }
      : {
          page: (page.value.segment.blobPrefixes ?? []).map((entry) => readProjectId(entry.name)),
          nextCursor: page.value.continuationToken || null,
        }
  }
  if (USE_GCS_STORAGE) {
    const { getGcsClient } = await import('@/lib/uploads/providers/google-cloud-storage/client')
    const config = getStorageConfig('project')
    if (!config.bucket) throw new Error('Project bucket missing')
    const [, nextQuery, response] = await (await getGcsClient()).bucket(config.bucket).getFiles({
      prefix: 'project/',
      delimiter: '/',
      maxResults: PAGE_SIZE,
      autoPaginate: false,
      ...(cursor ? { pageToken: cursor } : {}),
    })
    signal.throwIfAborted()
    if (
      !isRecordLike(response) ||
      (response.prefixes !== undefined && !Array.isArray(response.prefixes))
    )
      throw new Error('Invalid Project storage listing')
    const prefixes: unknown[] = response.prefixes ?? []
    return {
      page: prefixes.map((prefix) => {
        if (typeof prefix !== 'string') throw new Error('Invalid Project storage prefix')
        return readProjectId(prefix)
      }),
      nextCursor: nextQuery?.pageToken ?? null,
    }
  }
  let directory
  try {
    directory = await opendir(join(UPLOAD_DIR_SERVER, 'project'))
  } catch (error) {
    if (describeError(error).code === 'ENOENT') return { page: [], nextCursor: null }
    throw error
  }
  const ids: string[] = []
  for await (const entry of directory) {
    signal.throwIfAborted()
    if (!entry.isDirectory() || (cursor && compareStrings(entry.name, cursor) <= 0)) continue
    if (ids.length > PAGE_SIZE && compareStrings(entry.name, ids[ids.length - 1]) >= 0) continue
    ids.push(readProjectId(`project/${entry.name}/`))
    ids.sort(compareStrings)
    if (ids.length > PAGE_SIZE + 1) ids.pop()
  }
  const page = ids.slice(0, PAGE_SIZE)
  return { page, nextCursor: ids.length > PAGE_SIZE ? page[page.length - 1] : null }
}

function parseReconcilePayload(raw: unknown): ReconcilePayload {
  if (!isRecordLike(raw)) throw new Error('Invalid Project reconciliation payload')
  const cursor = raw.cursor ?? null
  const nextCursor = raw.nextCursor ?? null
  const page = raw.page ?? []
  const unfinished = raw.unfinished ?? []
  const index = raw.index ?? 0
  const failedPrefixes = raw.failedPrefixes ?? 0
  if (
    (cursor !== null && typeof cursor !== 'string') ||
    (nextCursor !== null && typeof nextCursor !== 'string') ||
    !Array.isArray(page) ||
    page.length > PAGE_SIZE ||
    !Array.isArray(unfinished) ||
    unfinished.length > PAGE_SIZE ||
    typeof index !== 'number' ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index > page.length ||
    typeof failedPrefixes !== 'number' ||
    !Number.isSafeInteger(failedPrefixes) ||
    failedPrefixes < 0
  )
    throw new Error('Invalid Project reconciliation checkpoint')
  function ownerIds(values: unknown[]): string[] {
    return values.map((id) => {
      if (typeof id !== 'string') throw new Error('Invalid Project reconciliation identity')
      prefixFor(id)
      return id
    })
  }
  return {
    cursor,
    nextCursor,
    page: ownerIds(page),
    unfinished: ownerIds(unfinished),
    index,
    failedPrefixes,
  }
}

const reconcilePrefixes: OutboxHandler<unknown> = async (raw, context) => {
  const payload = parseReconcilePayload(raw)
  if (!payload.page.length) {
    Object.assign(payload, await listProjectPrefixes(payload.cursor, context.signal), {
      index: 0,
      unfinished: [],
    })
    await context.checkpointPayload({ ...payload })
  }
  const owners = payload.page.length
    ? await db.select({ id: project.id }).from(project).where(inArray(project.id, payload.page))
    : []
  const existing = new Set(owners.map((owner) => owner.id))
  for (let index = payload.index; index < payload.page.length; index++) {
    context.signal.throwIfAborted()
    const id = payload.page[index]
    if (!existing.has(id)) {
      try {
        if (!(await sweepPrefix(id, context))) payload.unfinished.push(id)
      } catch (error) {
        context.signal.throwIfAborted()
        payload.failedPrefixes++
        logger.warn('Project storage prefix cleanup failed; retrying on the next inventory', {
          projectId: id,
          error,
        })
      }
    }
    payload.index = index + 1
    await context.checkpointPayload({
      index: payload.index,
      unfinished: payload.unfinished,
      failedPrefixes: payload.failedPrefixes,
    })
    if (context.deadlineAt && Date.now() + 5000 >= context.deadlineAt)
      return continueOutboxHandler('Continuing Project storage reconciliation')
  }
  if (payload.unfinished.length) {
    await context.checkpointPayload({ page: payload.unfinished, index: 0, unfinished: [] })
    return continueOutboxHandler('Continuing partially cleaned Project prefixes')
  }
  await context.checkpointPayload({
    cursor: payload.nextCursor,
    nextCursor: null,
    page: [],
    index: 0,
    unfinished: [],
    failedPrefixes: payload.nextCursor ? payload.failedPrefixes : 0,
  })
  if (payload.nextCursor) return continueOutboxHandler('Continuing Project storage inventory')
  return {
    ...deferOutboxHandler(
      `Project storage inventory reconciled with ${payload.failedPrefixes} failed prefixes`,
      RECONCILE_INTERVAL_MS,
      false
    ),
    resetAttempts: payload.failedPrefixes === 0,
  }
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
  if (!(await sweepPrefix(payload.projectId, context)))
    return continueOutboxHandler('Continuing Project storage cleanup')
}

export const projectFilePrefixCleanupOutboxHandlers = {
  [EVENT_TYPE]: cleanupPrefix,
  [RECONCILE_EVENT_TYPE]: reconcilePrefixes,
} satisfies OutboxHandlerRegistry
