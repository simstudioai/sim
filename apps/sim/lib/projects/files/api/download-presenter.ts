import { encodeFilenameForHeader } from '@/app/api/files/utils'

/** Serves the authorized archive through a buffer view, without cloning its bounded payload. */
export function presentProjectFileDownload(result: {
  buffer: Buffer
  fileName: string
  contentType: string
}) {
  return {
    body: new Uint8Array(
      result.buffer.buffer as ArrayBuffer,
      result.buffer.byteOffset,
      result.buffer.byteLength
    ),
    contentType: result.contentType,
    contentLength: result.buffer.length,
    contentDisposition: `attachment; ${encodeFilenameForHeader(result.fileName)}`,
    headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  }
}
