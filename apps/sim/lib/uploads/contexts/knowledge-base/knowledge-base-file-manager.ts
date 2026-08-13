import { randomBytes } from 'crypto'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'

/**
 * Generate a canonical knowledge-base storage key.
 *
 * Direct/presigned uploads previously used the generic `${context}/...` key
 * shape (`knowledge-base/...`). New KB uploads should use the same `kb/...`
 * prefix as server-side uploads so key-derived context inference is consistent.
 *
 * The uniquifier shares a path component with the name, so
 * {@link buildStorageKeySegment} reserves it out of that component's byte
 * budget: a document uploaded over multipart carries an unbounded filename, and
 * a long one otherwise produced an `ENAMETOOLONG` 500 from local storage.
 */
export function generateKnowledgeBaseFileKey(fileName: string): string {
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  return `kb/${buildStorageKeySegment(`${timestamp}-${random}-`, fileName)}`
}
