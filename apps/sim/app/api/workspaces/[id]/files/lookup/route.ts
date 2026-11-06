import { lookupWorkspaceFilesContract } from '@/lib/api/contracts/workspace-files'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { internalFileErrorPolicies, internalFilePresenters } from '@/lib/workspace-files/api'
import { lookupWorkspaceFiles } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'

export const dynamic = 'force-dynamic'

/**
 * POST /api/workspaces/[id]/files/lookup — resolve a bounded batch of live workspace files by
 * id, storage key, or reference without listing the workspace.
 */
export const POST = defineInternalJsonRoute({
  contract: lookupWorkspaceFilesContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  rateLimit: internalRateLimits.user({ bucketName: 'workspace-files.read' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    ids: body.ids,
    keys: body.keys,
    references: body.references,
  }),
  useCase: lookupWorkspaceFiles,
  present: ({ files, references }) => ({
    ...internalFilePresenters.successFiles({ files }),
    references,
  }),
})
