import {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES,
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
  type LargeArrayManifestChunk,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  assertInlineMaterializationSize,
  MAX_INLINE_MATERIALIZATION_BYTES,
} from '@/lib/execution/payloads/materialization.server'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'

export {
  isLargeArrayManifest,
  LARGE_ARRAY_MANIFEST_MARKER,
  LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES,
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
  type LargeArrayManifestChunk,
} from '@/lib/execution/payloads/large-array-manifest-metadata'

export const LARGE_ARRAY_MANIFEST_CHUNK_TARGET_BYTES = Math.floor(
  MAX_INLINE_MATERIALIZATION_BYTES / 2
)
const LARGE_ARRAY_MANIFEST_JSON_SERIALIZATION_ERROR =
  'Large array manifest chunks must be JSON-serializable.'

export interface LargeArrayManifestReadOptions extends LargeValueStoreContext {
  maxBytes?: number
}

export interface LargeArrayManifestWriteOptions extends LargeValueStoreContext {
  chunkTargetBytes?: number
}

function measureJson(value: unknown): { json: string; size: number } {
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    throw new Error(LARGE_ARRAY_MANIFEST_JSON_SERIALIZATION_ERROR)
  }
  if (json === undefined) {
    throw new Error(LARGE_ARRAY_MANIFEST_JSON_SERIALIZATION_ERROR)
  }
  return { json, size: Buffer.byteLength(json, 'utf8') }
}

function assertArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Large array manifest chunks must materialize to arrays.')
  }
}

function assertChunkCount(chunk: unknown[], expectedCount: number): void {
  if (chunk.length !== expectedCount) {
    throw new Error('Large array manifest chunk count does not match materialized data.')
  }
}

function getPreview(items: unknown[]): unknown[] {
  const preview: unknown[] = []
  for (const item of items.slice(0, 3)) {
    const candidate = [...preview, item]
    try {
      if (measureJson(candidate).size > LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES) {
        break
      }
    } catch {
      break
    }
    preview.push(item)
  }
  return preview
}

function measureArrayElementJsonSize(item: unknown): number {
  const measured = measureJson([item])
  return Math.max(0, measured.size - 2)
}

async function storeArrayChunk(
  items: unknown[],
  context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifestChunk> {
  const measured = measureJson(items)
  const ref = await storeLargeValue(items, measured.json, measured.size, {
    ...context,
    requireDurable: true,
  })
  return { ref, count: items.length, byteSize: measured.size }
}

function chunkArrayItems(items: unknown[], targetBytes: number): unknown[][] {
  const chunks: unknown[][] = []
  let current: unknown[] = []
  let currentBytes = 2

  for (const item of items) {
    const itemBytes = measureArrayElementJsonSize(item)
    const separatorBytes = current.length > 0 ? 1 : 0
    if (current.length > 0 && currentBytes + separatorBytes + itemBytes > targetBytes) {
      chunks.push(current)
      current = []
      currentBytes = 2
    }

    current.push(item)
    currentBytes += (current.length > 1 ? 1 : 0) + itemBytes
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}

async function storeArrayChunks(
  items: unknown[],
  context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifestChunk[]> {
  const targetBytes = Math.max(
    2,
    Math.min(
      context.chunkTargetBytes ?? LARGE_ARRAY_MANIFEST_CHUNK_TARGET_BYTES,
      MAX_INLINE_MATERIALIZATION_BYTES
    )
  )
  const chunks = chunkArrayItems(items, targetBytes)
  const storedChunks: LargeArrayManifestChunk[] = []
  for (const chunk of chunks) {
    storedChunks.push(await storeArrayChunk(chunk, context))
  }
  return storedChunks
}

function assertLargeArrayManifest(value: LargeArrayManifest): void {
  if (!isLargeArrayManifest(value)) {
    throw new Error('Invalid large array manifest.')
  }
}

export async function createLargeArrayManifest(
  items: unknown[],
  context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifest> {
  if (items.length === 0) {
    return {
      __simLargeArrayManifest: true,
      version: LARGE_ARRAY_MANIFEST_VERSION,
      kind: 'array',
      totalCount: 0,
      chunkCount: 0,
      byteSize: 0,
      chunks: [],
      preview: [],
    }
  }

  const chunks = await storeArrayChunks(items, context)
  const byteSize = chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0)
  return {
    __simLargeArrayManifest: true,
    version: LARGE_ARRAY_MANIFEST_VERSION,
    kind: 'array',
    totalCount: items.length,
    chunkCount: chunks.length,
    byteSize,
    chunks,
    preview: getPreview(items),
  }
}

export async function appendLargeArrayManifest(
  manifest: LargeArrayManifest,
  items: unknown[],
  context: LargeArrayManifestWriteOptions
): Promise<LargeArrayManifest> {
  if (items.length === 0) {
    return manifest
  }

  const chunks = await storeArrayChunks(items, context)
  const byteSize = chunks.reduce((sum, chunk) => sum + chunk.byteSize, 0)
  return {
    ...manifest,
    totalCount: manifest.totalCount + items.length,
    chunkCount: manifest.chunkCount + chunks.length,
    byteSize: manifest.byteSize + byteSize,
    chunks: [...manifest.chunks, ...chunks],
    preview: manifest.preview.length > 0 ? manifest.preview : getPreview(items),
  }
}

export async function readLargeArrayManifestSlice(
  manifest: LargeArrayManifest,
  start: number,
  limit: number,
  context: LargeArrayManifestReadOptions
): Promise<unknown[]> {
  assertLargeArrayManifest(manifest)
  const normalizedStart = Math.max(0, Math.floor(start))
  const normalizedLimit = Math.max(0, Math.floor(limit))
  if (normalizedLimit === 0 || normalizedStart >= manifest.totalCount) {
    return []
  }

  const end = Math.min(manifest.totalCount, normalizedStart + normalizedLimit)
  const results: unknown[] = []
  let cursor = 0

  for (const chunkEntry of manifest.chunks) {
    const chunkStart = cursor
    const chunkEnd = cursor + chunkEntry.count
    if (chunkEnd <= normalizedStart || chunkStart >= end) {
      cursor = chunkEnd
      continue
    }

    const chunk = await materializeLargeValueRef(chunkEntry.ref, context)
    if (chunk === undefined) {
      throw new Error('Large array manifest chunk is unavailable.')
    }
    assertArray(chunk)
    assertChunkCount(chunk, chunkEntry.count)

    const from = Math.max(0, normalizedStart - chunkStart)
    const to = Math.min(chunk.length, end - chunkStart)
    results.push(...chunk.slice(from, to))

    cursor = chunkEnd
    if (cursor >= end) {
      break
    }
  }

  return results
}

export async function materializeLargeArrayManifest(
  manifest: LargeArrayManifest,
  context: LargeArrayManifestReadOptions
): Promise<unknown[]> {
  assertLargeArrayManifest(manifest)
  assertInlineMaterializationSize(manifest.byteSize, context.maxBytes)
  return readLargeArrayManifestSlice(manifest, 0, manifest.totalCount, context)
}
