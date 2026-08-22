import { extractWorkspaceFileContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies } from '@/lib/workspace-files/api'
import { extractWorkspaceFile } from '@/lib/workspace-files/application/extract-workspace-file'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/workspaces/[id]/files/[fileId]/extract
 * Unzip an archive file into a new folder beside it (requires write permission)
 */
export const POST = defineInternalJsonRoute({
  contract: extractWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.extractArchive,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file behavior' }),
  errorPolicy: internalFileErrorPolicies.extractArchive,
  mapInput: ({ params }) => ({ fileId: params.fileId, assertedWorkspaceId: params.id }),
  useCase: extractWorkspaceFile,
  present: (result) => ({ success: true, ...result }),
})
