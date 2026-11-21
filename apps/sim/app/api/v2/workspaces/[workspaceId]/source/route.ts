import { WORKSPACE_SOURCE_REQUEST_MAX_BYTES } from '@sim/workspace-code/limits'
import {
  v2ApplyWorkspaceSourceContract,
  v2GetWorkspaceSourceContract,
} from '@/lib/api/contracts/v2/workspace-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { applyOrDryRunLane, withSourceSlot } from '@/lib/workflows/api'
import {
  v2WorkspaceSourceErrorPolicy,
  withBoundWorkspaceFindings,
  workspaceApplyRateCost,
} from '@/lib/workspace-source/api/route-policies'
import { applyWorkspaceSource } from '@/lib/workspace-source/application/apply-workspace-source'
import { workspaceSourceOperations } from '@/lib/workspace-source/application/operations'
import { readWorkspaceSource } from '@/lib/workspace-source/application/read-workspace-source'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/workspaces/[workspaceId]/source — the workspace as a source directory: declaration
 * files, workflow folders, binary files by hash, and the base. Unaudited. `headSafe: false`
 * because the first read of a resource with no key allocates one. Draws on its own source-read
 * budget; a server already running as many gets as it allows answers 429. Answers 403 while the
 * `workflow-code` flag is off.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkspaceSourceContract,
  auth: v2ApiKeyAuth,
  headSafe: false,
  operation: workspaceSourceOperations.read,
  rateLimit: v2RateLimits.sourceRead,
  errorPolicy: v2WorkspaceSourceErrorPolicy,
  mapInput: ({ params, query }) => ({
    workspaceId: params.workspaceId,
    ...(query.kinds ? { kinds: query.kinds } : {}),
  }),
  useCase: withSourceSlot(readWorkspaceSource, 'read'),
  present: (source) => ({ data: withBoundWorkspaceFindings(source) }),
})

/**
 * POST /api/v2/workspaces/[workspaceId]/source — applies a workspace source directory. Any error
 * in the plan writes nothing (400, 409 stale, 423 locked, 413 over a limit); a dry run answers
 * 200 with its findings. A write that fails mid-apply answers 200 with `failed` and what was
 * written before it. A real apply draws on the source-write budget and a dry run, which writes
 * nothing, on the source-plan budget the status plan route uses (`v2RateLimits.sourceApply`), each
 * charged per workflow folder sent with its files (`workspaceApplyRateCost`), and runs in an apply
 * or a plan slot to match; a server already running as many as it allows answers 429.
 */
export const POST = defineV2JsonRoute({
  contract: v2ApplyWorkspaceSourceContract,
  auth: v2ApiKeyAuth,
  operation: workspaceSourceOperations.apply,
  rateLimit: v2RateLimits.sourceApply,
  errorPolicy: v2WorkspaceSourceErrorPolicy,
  parseOptions: { maxBodyBytes: WORKSPACE_SOURCE_REQUEST_MAX_BYTES },
  mapInput: ({ params, query, body }) => ({
    workspaceId: params.workspaceId,
    files: body.files,
    kinds: body.kinds,
    ...(body.blobs ? { blobs: body.blobs } : {}),
    ...(body.base ? { base: body.base } : {}),
    ...(body.options?.only ? { only: body.options.only } : {}),
    ...(body.options?.allowDelete !== undefined ? { allowDelete: body.options.allowDelete } : {}),
    ...(body.provenance ? { provenance: body.provenance } : {}),
    ...(query.dryRun !== undefined ? { dryRun: query.dryRun } : {}),
  }),
  rateLimitCost: (input) => workspaceApplyRateCost(input.files, input.blobs),
  useCase: withSourceSlot(applyWorkspaceSource, applyOrDryRunLane),
  present: (result) => ({ data: withBoundWorkspaceFindings(result) }),
})
