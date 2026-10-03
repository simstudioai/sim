import { downloadWorkspaceFileUrlContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
import { downloadWorkspaceFile } from '@/lib/workspace-files/application/download-workspace-file'

export const dynamic = 'force-dynamic'

/** POST /api/workspaces/[id]/files/[fileId]/download — Create an authenticated serve URL. */
export const POST = defineInternalJsonRoute({
  contract: downloadWorkspaceFileUrlContract,
  auth: internalSessionAuth,
  operation: downloadWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal download behavior' }),
  errorPolicy: internalFileErrorPolicies.downloadUrl,
  mapInput: ({ params }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: params.id,
  }),
  useCase: downloadWorkspaceFile,
  onSuccess: internalFileAnalytics.downloaded,
  present: internalFilePresenters.downloadUrl,
})
