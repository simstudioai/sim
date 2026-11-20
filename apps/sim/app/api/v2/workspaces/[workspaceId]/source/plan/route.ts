import { WORKSPACE_SOURCE_REQUEST_MAX_BYTES } from '@sim/workspace-code/limits'
import { v2PlanWorkspaceSourceContract } from '@/lib/api/contracts/v2/workspace-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { withSourceSlot } from '@/lib/workflows/api'
import {
  v2WorkspaceSourceErrorPolicy,
  withBoundWorkspaceFindings,
  workspaceApplyRateCost,
} from '@/lib/workspace-source/api/route-policies'
import { planWorkspaceSource } from '@/lib/workspace-source/application/apply-workspace-source'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workspaces/[workspaceId]/source/plan — what applying the submitted directory would
 * do, without writing: the dry run `sim workspaces source status` reads. Charged to the
 * source-plan budget as an apply is to the write budget (see `workspaceApplyRateCost`), so a
 * status never spends the source-write budget an apply needs. Plans run in their own slots: a
 * server already running as many plans as it allows answers 429, and applies never wait on them.
 * Answers 403 while the `workflow-code` flag is off.
 */
export const POST = defineV2JsonRoute({
  contract: v2PlanWorkspaceSourceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceSourceOperations.plan,
  rateLimit: v2RateLimits.sourcePlan,
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
  rateLimitCost: (input) => workspaceApplyRateCost(input.files, input.blobs),
  useCase: withSourceSlot(planWorkspaceSource, 'plan'),
  present: (result) => ({ data: withBoundWorkspaceFindings(result) }),
})
