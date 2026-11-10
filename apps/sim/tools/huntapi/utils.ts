import { toNumberOrNull, toStringOrNull } from '@sim/utils/coerce'
import { toRecordOrNull } from '@sim/utils/object'
import type { HuntApiMediaMetadata } from '@/tools/huntapi/types'

/** Reads a `HuntApiMediaMetadata` from an untyped HuntAPI API payload. */
export function mapHuntApiMediaMetadata(value: unknown): HuntApiMediaMetadata | null {
  const record = toRecordOrNull(value)
  if (!record) return null
  return {
    title: toStringOrNull(record.title),
    description: toStringOrNull(record.description),
    duration: toNumberOrNull(record.duration),
    extension: toStringOrNull(record.ext),
    thumbnail: toStringOrNull(record.thumbnail),
    uploader: toStringOrNull(record.uploader),
    uploaderUrl: toStringOrNull(record.uploader_url),
    viewCount: toNumberOrNull(record.view_count),
    likeCount: toNumberOrNull(record.like_count),
    commentCount: toNumberOrNull(record.comment_count),
    uploadDate: toNumberOrNull(record.upload_date),
    webpageUrl: toStringOrNull(record.original_url),
  }
}
