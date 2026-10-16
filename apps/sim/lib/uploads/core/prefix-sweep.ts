import { opendir, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describeError } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import type { OutboxEventContext } from '@/lib/core/outbox/service'
import {
  getStorageConfig,
  type StorageContext,
  USE_BLOB_STORAGE,
  USE_GCS_STORAGE,
  USE_S3_STORAGE,
} from '@/lib/uploads/config'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { UPLOAD_URL_TTL_MS } from '@/lib/uploads/upload-session/provider'

/** Most keys one {@link listStorageKeyPage} call returns. */
export const STORAGE_KEY_PAGE_SIZE = 500
const CLOCK_SKEW_MS = 60_000
const DEADLINE_MARGIN_MS = 5000

/**
 * Earliest moment no upload URL signed before `now` can still write an object: expired signatures
 * stop new transfers, but a transfer already in progress may finish later.
 */
export function storageCleanupAvailableAt(now = new Date()): Date {
  return new Date(now.getTime() + UPLOAD_URL_TTL_MS + CLOCK_SKEW_MS)
}

/** True once an outbox handler should stop starting new storage work before its deadline. */
export function outboxDeadlineNear(context: Pick<OutboxEventContext, 'deadlineAt'>): boolean {
  return Boolean(context.deadlineAt && Date.now() + DEADLINE_MARGIN_MS >= context.deadlineAt)
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
      if (keys.length >= STORAGE_KEY_PAGE_SIZE) return
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

function keyPage(keys: string[], nextPageToken: string | undefined): StorageKeyPage {
  return nextPageToken ? { keys, done: false, nextPageToken } : { keys, done: true }
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
        MaxKeys: STORAGE_KEY_PAGE_SIZE,
        ...(pageToken ? { ContinuationToken: pageToken } : {}),
      }),
      { abortSignal: signal }
    )
    return keyPage(
      (page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])),
      page.IsTruncated ? page.NextContinuationToken : undefined
    )
  }
  if (USE_BLOB_STORAGE) {
    const { getBlobServiceClient } = await import('@/lib/uploads/providers/blob/client')
    const config = getStorageConfig(context)
    if (!config.containerName) throw new Error(`Blob container missing for ${context} storage`)
    const pages = (await getBlobServiceClient())
      .getContainerClient(config.containerName)
      .listBlobsFlat({ prefix, abortSignal: signal })
      .byPage({
        maxPageSize: STORAGE_KEY_PAGE_SIZE,
        ...(pageToken ? { continuationToken: pageToken } : {}),
      })
    const page = await pages.next()
    if (page.done) return { keys: [], done: true }
    return keyPage(
      page.value.segment.blobItems.map((object) => object.name),
      page.value.continuationToken || undefined
    )
  }
  if (USE_GCS_STORAGE) {
    const { getGcsClient } = await import('@/lib/uploads/providers/google-cloud-storage/client')
    const config = getStorageConfig(context)
    if (!config.bucket) throw new Error(`Bucket missing for ${context} storage`)
    const [files, nextQuery] = await (await getGcsClient()).bucket(config.bucket).getFiles({
      prefix,
      maxResults: STORAGE_KEY_PAGE_SIZE,
      autoPaginate: false,
      ...(pageToken ? { pageToken } : {}),
    })
    signal.throwIfAborted()
    return keyPage(
      files.map((file) => file.name),
      isRecordLike(nextQuery) && typeof nextQuery.pageToken === 'string'
        ? nextQuery.pageToken || undefined
        : undefined
    )
  }
  const keys = await localKeys(prefix, signal)
  return { keys, done: keys.length < STORAGE_KEY_PAGE_SIZE }
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
    if (attempted > 0 && outboxDeadlineNear(outbox)) return { deleted, complete: false }
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
