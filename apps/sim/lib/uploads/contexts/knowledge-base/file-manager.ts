import { randomBytes } from 'crypto'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'

/**
 * Generate a canonical knowledge-base storage key.
 *
 * Shares the `kb/...` prefix with server-side uploads so key-derived context
 * inference is consistent.
 */
export function generateKnowledgeBaseFileKey(fileName: string): string {
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  return `kb/${buildStorageKeySegment(`${timestamp}-${random}-`, fileName)}`
}
