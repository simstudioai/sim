import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { documentExtension, extractDocumentText } from '@/lib/sim-search/live/file-text'
import { NATIVE_RESPONSE_MAX_BYTES, NativeSearchError, segment } from '@/lib/sim-search/live/http'
import type { NativeClient } from '@/lib/sim-search/live/types'

/** Extracts bounded text from the exact downloadable PDF or DOCX identified by Drive metadata. */
export async function readDriveFileContent(
  client: NativeClient,
  id: string,
  row: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()
  if (row.id !== id)
    throw new NativeSearchError(
      'unavailable',
      'Drive returned a different file. Search again before reading it.'
    )
  if (toRecord(row.capabilities).canDownload !== true)
    throw new NativeSearchError(
      'unavailable',
      'Drive does not allow downloading this file. Ask the owner to allow downloads or open the source.'
    )
  const extension = documentExtension(toStringOrNull(row.mimeType))
  if (!extension)
    throw new NativeSearchError(
      'unavailable',
      'This file type does not support binary text reads. Open the source.'
    )
  if (row.size !== undefined) {
    const size = toStringOrNull(row.size)
    if (!size || !/^\d{1,20}$/.test(size))
      throw new NativeSearchError(
        'unavailable',
        'Drive returned an invalid file size. Refresh the source and retry.'
      )
    if (Number(size) > NATIVE_RESPONSE_MAX_BYTES)
      throw new NativeSearchError(
        'unavailable',
        'This file exceeds the 4 MiB live-read limit. Split it into smaller files or open the source.'
      )
  }

  let bytes: Buffer
  try {
    bytes = await client.bytes(`/drive/v3/files/${segment(id)}`, {
      alt: 'media',
      supportsAllDrives: 'true',
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error))
      throw new NativeSearchError(
        'unavailable',
        'This file exceeds the 4 MiB live-read limit. Split it into smaller files or open the source.'
      )
    throw error
  }
  return extractDocumentText(bytes, extension, signal)
}
