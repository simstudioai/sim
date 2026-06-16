import { randomBytes } from 'crypto'
import { sanitizeFileName } from '@/executor/constants'

/**
 * Generate a canonical knowledge-base storage key.
 *
 * Direct/presigned uploads previously used the generic `${context}/...` key
 * shape (`knowledge-base/...`). New KB uploads should use the same `kb/...`
 * prefix as server-side uploads so key-derived context inference is consistent.
 */
export function generateKnowledgeBaseFileKey(fileName: string): string {
  const timestamp = Date.now()
  const random = randomBytes(8).toString('hex')
  const safeFileName = sanitizeFileName(fileName)
  return `kb/${timestamp}-${random}-${safeFileName}`
}
