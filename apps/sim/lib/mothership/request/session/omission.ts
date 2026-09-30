import { isRecordLike } from '@sim/utils/object'

/**
 * Stand-in for a subtree the bounded chat stream could not carry even after its
 * long strings were shortened. The full value still reaches the model and the
 * durable tool records; only the live and replayed UI stream carries this.
 */
export interface OmittedStreamValue {
  omitted: true
  bytes: number
}

/** One field shortened or omitted by stream compaction, addressed by JSON pointer. */
export interface StreamTruncatedField {
  path: string
  /** Full UTF-8 size of the original value. */
  bytes: number
  /** UTF-8 size kept in the stream; absent when the value was omitted. */
  previewBytes?: number
}

/** Payload key of the {@link StreamTruncationMarker} on a compacted event. */
export const STREAM_TRUNCATION_KEY = 'streamTruncation'

/**
 * Payload-level marker naming every field compaction changed. It sits beside the
 * compacted fields rather than inside them, so `arguments` and `output` keep the
 * shape the UI reads.
 */
export interface StreamTruncationMarker {
  /** UTF-8 size of the payload before compaction. */
  bytes: number
  fields: StreamTruncatedField[]
}

export function isOmittedStreamValue(value: unknown): value is OmittedStreamValue {
  return isRecordLike(value) && value.omitted === true && typeof value.bytes === 'number'
}

/** Formats a byte count the way the UI states an omitted size ("1.6 MB"). */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Replaces omitted subtrees with a sentence stating their size, for display. */
export function describeOmittedStreamValues(_key: string, value: unknown): unknown {
  return isOmittedStreamValue(value) ? `Too large to show (${formatByteSize(value.bytes)})` : value
}
