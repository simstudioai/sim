import { isLargeValueRef, type LargeValueRef } from '@/lib/execution/payloads/large-value-ref'

export const LARGE_ARRAY_MANIFEST_MARKER = '__simLargeArrayManifest'
export const LARGE_ARRAY_MANIFEST_VERSION = 2
export const LARGE_ARRAY_MANIFEST_PREVIEW_MAX_BYTES = 16 * 1024

export interface LargeArrayManifest {
  [LARGE_ARRAY_MANIFEST_MARKER]: true
  version: typeof LARGE_ARRAY_MANIFEST_VERSION
  kind: 'array'
  totalCount: number
  chunkCount: number
  byteSize: number
  chunks: LargeArrayManifestChunk[]
  preview: unknown[]
}

export interface LargeArrayManifestChunk {
  ref: LargeValueRef
  count: number
  byteSize: number
}

function isValidCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isValidByteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isValidPreview(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= 3
}

export function isLargeArrayManifest(value: unknown): value is LargeArrayManifest {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (
    candidate[LARGE_ARRAY_MANIFEST_MARKER] !== true ||
    candidate.version !== LARGE_ARRAY_MANIFEST_VERSION ||
    candidate.kind !== 'array' ||
    !isValidCount(candidate.totalCount) ||
    !isValidCount(candidate.chunkCount) ||
    !isValidByteSize(candidate.byteSize) ||
    !Array.isArray(candidate.chunks) ||
    !isValidPreview(candidate.preview) ||
    candidate.chunkCount !== candidate.chunks.length
  ) {
    return false
  }

  let totalCount = 0
  let byteSize = 0
  for (const chunk of candidate.chunks) {
    if (!chunk || typeof chunk !== 'object') {
      return false
    }

    const chunkRecord = chunk as Record<string, unknown>
    if (
      !isLargeValueRef(chunkRecord.ref) ||
      !isValidCount(chunkRecord.count) ||
      chunkRecord.count <= 0 ||
      !isValidByteSize(chunkRecord.byteSize) ||
      chunkRecord.byteSize <= 0 ||
      chunkRecord.byteSize !== chunkRecord.ref.size
    ) {
      return false
    }

    totalCount += chunkRecord.count
    byteSize += chunkRecord.ref.size
  }

  return candidate.totalCount === totalCount && candidate.byteSize === byteSize
}
