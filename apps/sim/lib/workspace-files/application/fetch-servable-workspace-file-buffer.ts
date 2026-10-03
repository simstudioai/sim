import type { Principal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'

const logger = createLogger('FetchServableWorkspaceFileBuffer')

/**
 * Resolves the rendered bytes of an already-authorized workspace file while preserving the
 * Principal for any referenced-file reads performed by the document compiler.
 */
export async function fetchAuthorizedServableWorkspaceFileBuffer(
  fileRecord: WorkspaceFileRecord,
  filePrincipal: Principal,
  options: { maxBytes: number; signal?: AbortSignal; requestId?: string }
): Promise<{ buffer: Buffer; contentType: string }> {
  return downloadServableFileFromStorage(
    {
      id: fileRecord.id,
      name: fileRecord.name,
      url: fileRecord.url ?? fileRecord.path,
      size: fileRecord.size,
      type: fileRecord.type,
      key: fileRecord.key,
      context: fileRecord.storageContext ?? 'workspace',
    },
    options.requestId ?? generateRequestId(),
    logger,
    {
      ...options,
      filePrincipal,
    }
  )
}
