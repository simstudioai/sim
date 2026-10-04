import type { OwnedFileRecord } from '@/lib/uploads/contexts/workspace'
import { workspaceFileRevision } from '@/lib/workspace-files/application/file-revision'
import { encodeFilenameForHeader, getSecureFileHeaders } from '@/app/api/files/utils'

/** Presents authorized bytes without allowing shared caches or active uploaded documents. */
export function presentProjectFileContent({
  file,
  content,
}: {
  file: OwnedFileRecord
  content: Buffer
}) {
  const secure = getSecureFileHeaders(file.name, file.type)
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  const revision = workspaceFileRevision(file)
  if (revision) headers.set('ETag', `"${revision}"`)
  if (secure.contentType === 'image/svg+xml')
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; sandbox;"
    )
  return {
    body: new Uint8Array(content),
    contentType: secure.contentType,
    contentLength: content.length,
    contentDisposition: `${secure.disposition}; ${encodeFilenameForHeader(file.name)}`,
    headers,
  }
}
