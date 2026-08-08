import { createLogger } from '@sim/logger'
import { getWorkspaceCsvPreviewContract } from '@/lib/api/contracts/workspace-file-table'
import {
  defineInternalJsonRoute,
  internalPlainFileErrorPolicy,
  internalRateLimits,
  internalSessionOrServiceAuth,
} from '@/lib/api/server/routes'
import { csvPreviewWorkspaceFile } from '@/lib/workspace-files/application/csv-preview-workspace-file'

const logger = createLogger('WorkspaceCsvPreviewAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceCsvPreviewContract,
  auth: internalSessionOrServiceAuth,
  operation: csvPreviewWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal CSV preview behavior' }),
  errorPolicy: internalPlainFileErrorPolicy,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    key: query.key,
  }),
  useCase: csvPreviewWorkspaceFile,
  present: (result) => {
    logger.info('CSV preview served', {
      rows: result.rows.length,
      truncated: result.truncated,
    })
    return result
  },
})
