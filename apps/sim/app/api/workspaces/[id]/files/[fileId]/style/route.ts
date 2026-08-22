import { workspaceFileStyleContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalFilePresenters } from '@/lib/workspace-files/api'
import { styleWorkspaceFile } from '@/lib/workspace-files/application/style-workspace-file'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineInternalJsonRoute({
  contract: workspaceFileStyleContract,
  auth: internalSessionAuth,
  operation: styleWorkspaceFile.operation,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal style behavior' }),
  errorPolicy: internalFileErrorPolicies.style,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: styleWorkspaceFile,
  present: internalFilePresenters.style,
  responseHeaders: () => ({ 'Cache-Control': 'private, max-age=300' }),
})
