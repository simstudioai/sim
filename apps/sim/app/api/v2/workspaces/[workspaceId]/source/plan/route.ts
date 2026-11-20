import { WORKSPACE_SOURCE_REQUEST_MAX_BYTES } from '@sim/workspace-code/limits'
import { v2PlanWorkspaceSourceContract } from '@/lib/api/contracts/v2/workspace-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  v2WorkspaceSourceErrorPolicy,
  withSourceSlot,
} from '@/lib/workspace-source/api/route-policies'
import { readWorkspaceSourcePlan } from '@/lib/workspace-source/application/apply-workspace-source'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workspaces/[workspaceId]/source/plan — what applying the submitted directory would
 * do, without writing: the dry run `sim workspaces source status` reads. One unit of the
 * source-read budget whatever the directory holds, so a status never spends the source-write
 * budget an apply needs. A server already running as many applies as it allows answers 429.
 * Answers 403 while the `workflow-code` flag is off.
 */
export const POST = defineV2JsonRoute({
  contract: v2PlanWorkspaceSourceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceSourceOperations.plan,
  rateLimit: v2RateLimits.sourceRead,
  errorPolicy: v2WorkspaceSourceErrorPolicy,
  parseOptions: { maxBodyBytes: WORKSPACE_SOURCE_REQUEST_MAX_BYTES },
  mapInput: ({ params, body }) => ({
    workspaceId: params.workspaceId,
    files: body.files,
    kinds: body.kinds,
    ...(body.blobs ? { blobs: body.blobs } : {}),
    ...(body.base ? { base: body.base } : {}),
    ...(body.options?.only ? { only: body.options.only } : {}),
    ...(body.options?.allowDelete !== undefined ? { allowDelete: body.options.allowDelete } : {}),
  }),
  useCase: withSourceSlot(readWorkspaceSourcePlan, 'apply'),
  present: (result) => ({ data: result }),
})
