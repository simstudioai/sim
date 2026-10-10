import { v2UploadStatusSchema } from '@/lib/api/contracts/v2/uploads'
import type { UploadSessionRecord } from '@/lib/uploads/upload-session/service'

/** Shared transfer state excludes private credential, provenance and storage bindings. */
export function presentUploadSessionState(session: UploadSessionRecord) {
  return {
    id: session.id,
    status: v2UploadStatusSchema.parse(session.status),
    name: session.fileName,
    contentType: session.contentType,
    size: session.fileSize,
    expiresAt: session.expiresAt.toISOString(),
    error: session.error,
  }
}
