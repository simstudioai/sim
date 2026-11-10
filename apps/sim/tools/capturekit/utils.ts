import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { CaptureKitPageLinks, CaptureKitPageMetadata } from '@/tools/capturekit/types'

/** Reads a `CaptureKitPageMetadata` from an untyped CaptureKit API payload. */
export function mapCaptureKitPageMetadata(value: unknown): CaptureKitPageMetadata | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    description: toStringOrNull(record.description),
    favicon: toStringOrNull(record.favicon),
    ogImage: toStringOrNull(record.ogImage),
  }
}

/** Reads a `CaptureKitPageLinks` from an untyped CaptureKit API payload. */
export function mapCaptureKitPageLinks(value: unknown): CaptureKitPageLinks | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    internal: toArray(record.internal).filter((item): item is string => typeof item === 'string'),
    external: toArray(record.external).filter((item): item is string => typeof item === 'string'),
    social: toArray(record.social).filter((item): item is string => typeof item === 'string'),
  }
}
