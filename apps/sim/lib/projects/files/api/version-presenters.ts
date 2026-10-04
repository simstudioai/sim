import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import type { WorkspaceFileVersionRecord } from '@/lib/uploads/contexts/workspace/workspace-file-versions'
import { encodeFilenameForHeader, getSecureFileHeaders } from '@/app/api/files/utils'

/** Historical source bytes use the selected version's type rather than the current head's type. */
export function presentProjectFileVersionContent({
  file,
  version,
  content,
}: {
  file: OwnedFileRecord
  version: WorkspaceFileVersionRecord
  content: Buffer
}) {
  const secure = getSecureFileHeaders(file.name, version.contentType)
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  if (secure.contentType === 'image/svg+xml')
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
    )
  return {
    body: new Uint8Array(content),
    contentType: secure.contentType,
    contentLength: content.length,
    contentDisposition: `attachment; ${encodeFilenameForHeader(file.name)}`,
    headers,
  }
}
