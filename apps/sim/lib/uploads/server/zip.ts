import type JSZip from 'jszip'
import { readNodeStreamToBufferWithLimit } from '@/lib/core/utils/stream-limits'

/** Bounds emitted ZIP bytes while compression runs, before allocating the final output buffer. */
export function bufferZipWithinLimit(zip: JSZip, maxBytes: number): Promise<Buffer> {
  return readNodeStreamToBufferWithLimit(
    zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE' }),
    { maxBytes, label: 'file archive' }
  )
}
