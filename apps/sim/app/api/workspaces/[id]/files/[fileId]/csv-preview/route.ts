import { createLogger } from '@sim/logger'
import { getWorkspaceCsvPreviewContract } from '@/lib/api/contracts/workspace-file-table'
import { defineInternalJsonRoute, internalRateLimits } from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalSessionOrExecutorAuth } from '@/lib/workspace-files/api'
import { csvPreviewWorkspaceFile } from '@/lib/workspace-files/application/csv-preview-workspace-file'

const logger = createLogger('WorkspaceCsvPreviewAPI')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = defineInternalJsonRoute({
  contract: getWorkspaceCsvPreviewContract,
  auth: internalSessionOrExecutorAuth,
  operation: csvPreviewWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal CSV preview behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }, { request }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
    key: query.key,
    signal: request.signal,
  }),
  useCase: csvPreviewWorkspaceFile,
  onSuccess: ({ result }) => {
    logger.info('CSV preview served', {
      rows: result.rows.length,
      truncated: result.truncated,
    })
  },
})
