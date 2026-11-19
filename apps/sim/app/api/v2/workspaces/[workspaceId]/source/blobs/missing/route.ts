import { v2FindMissingWorkspaceSourceBlobsContract } from '@/lib/api/contracts/v2/workspace-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkspaceSourceErrorPolicy } from '@/lib/workspace-source/api/route-policies'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import { findMissingSourceBlobs } from '@/lib/workspace-source/application/stage-blobs'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workspaces/[workspaceId]/source/blobs/missing — which of the listed binary files
 * the caller has not staged, so a client stages only those (and a resumed apply none it already
 * sent). The ones staged are renewed. Shares the staging budget.
 */
export const POST = defineV2JsonRoute({
  contract: v2FindMissingWorkspaceSourceBlobsContract,
  auth: v2ApiKeyAuth,
  operation: workspaceSourceOperations.findMissingBlobs,
  rateLimit: v2RateLimits.sourceBlobStage,
  errorPolicy: v2WorkspaceSourceErrorPolicy,
  mapInput: ({ params, body }) => ({ workspaceId: params.workspaceId, blobs: body.blobs }),
  useCase: findMissingSourceBlobs,
  present: (result) => ({ data: result }),
})
