import type { LargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { assertInlineMaterializationSize } from '@/lib/execution/payloads/materialization.server'
import type { LargeValueStoreContext } from '@/lib/execution/payloads/store'
import { materializeLargeValueRef, storeLargeValue } from '@/lib/execution/payloads/store'

export const LARGE_ARRAY_MANIFEST_MARKER = '__simLargeArrayManifest'
export const LARGE_ARRAY_MANIFEST_VERSION = 1

export interface LargeArrayManifest {
  [LARGE_ARRAY_MANIFEST_MARKER]: true
  version: typeof LARGE_ARRAY_MANIFEST_VERSION
  kind: 'array'
  totalCount: number
  chunkCount: number
  byteSize: number
  chunks: LargeValueRef[]
  preview: unknown[]
}

export interface LargeArrayManifestReadOptions extends LargeValueStoreContext {
  maxBytes?: number
}

function measureJson(value: unknown): { json: string; size: number } {
  const json = JSON.stringify(value)
  if (json === undefined) {
    throw new Error('Large array manifest chunks must be JSON-serializable.')
  }
  return { json, size: Buffer.byteLength(json, 'utf8') }
}

function assertArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Large array manifest chunks must materialize to arrays.')
  }
}

function getPreview(items: unknown[]): unknown[] {
  return items.slice(0, 3)
}

async function storeArrayChunk(
  items: unknown[],
  context: LargeValueStoreContext
): Promise<{ ref: LargeValueRef; size: number }> {
  const measured = measureJson(items)
  const ref = await storeLargeValue(items, measured.json, measured.size, {
    ...context,
    requireDurable: true,
  })
  return { ref, size: measured.size }
}

export function isLargeArrayManifest(value: unknown): value is LargeArrayManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    candidate[LARGE_ARRAY_MANIFEST_MARKER] === true &&
    candidate.version === LARGE_ARRAY_MANIFEST_VERSION &&
    candidate.kind === 'array' &&
    typeof candidate.totalCount === 'number' &&
    typeof candidate.chunkCount === 'number' &&
    typeof candidate.byteSize === 'number' &&
    Array.isArray(candidate.chunks) &&
    Array.isArray(candidate.preview)
  )
}

export async function createLargeArrayManifest(
  items: unknown[],
  context: LargeValueStoreContext
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

  const chunk = await storeArrayChunk(items, context)
  return {
    __simLargeArrayManifest: true,
    version: LARGE_ARRAY_MANIFEST_VERSION,
    kind: 'array',
    totalCount: items.length,
    chunkCount: 1,
    byteSize: chunk.size,
    chunks: [chunk.ref],
    preview: getPreview(items),
  }
}

export async function appendLargeArrayManifest(
  manifest: LargeArrayManifest,
  items: unknown[],
  context: LargeValueStoreContext
): Promise<LargeArrayManifest> {
  if (items.length === 0) {
    return manifest
  }

  const chunk = await storeArrayChunk(items, context)
  return {
    ...manifest,
    totalCount: manifest.totalCount + items.length,
    chunkCount: manifest.chunkCount + 1,
    byteSize: manifest.byteSize + chunk.size,
    chunks: [...manifest.chunks, chunk.ref],
    preview: manifest.preview.length > 0 ? manifest.preview : getPreview(items),
  }
}

export async function readLargeArrayManifestSlice(
  manifest: LargeArrayManifest,
  start: number,
  limit: number,
  context: LargeArrayManifestReadOptions
): Promise<unknown[]> {
  const normalizedStart = Math.max(0, Math.floor(start))
  const normalizedLimit = Math.max(0, Math.floor(limit))
  if (normalizedLimit === 0 || normalizedStart >= manifest.totalCount) {
    return []
  }

  const end = Math.min(manifest.totalCount, normalizedStart + normalizedLimit)
  const results: unknown[] = []
  let cursor = 0

  for (const chunkRef of manifest.chunks) {
    const chunk = await materializeLargeValueRef(chunkRef, context)
    if (chunk === undefined) {
      throw new Error('Large array manifest chunk is unavailable.')
    }
    assertArray(chunk)

    const chunkStart = cursor
    const chunkEnd = cursor + chunk.length
    if (chunkEnd > normalizedStart && chunkStart < end) {
      const from = Math.max(0, normalizedStart - chunkStart)
      const to = Math.min(chunk.length, end - chunkStart)
      results.push(...chunk.slice(from, to))
    }

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
  assertInlineMaterializationSize(manifest.byteSize, context.maxBytes)
  return readLargeArrayManifestSlice(manifest, 0, manifest.totalCount, context)
}
