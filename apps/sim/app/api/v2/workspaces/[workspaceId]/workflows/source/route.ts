import { SOURCE_REQUEST_MAX_BYTES } from '@sim/workflow-code/limits'
import { v2CreateWorkflowFromSourceContract } from '@/lib/api/contracts/v2/workflow-source'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  applyOrDryRunLane,
  presentSourceOutcome,
  v2WorkflowErrorPolicies,
  withSourceSlot,
} from '@/lib/workflows/api'
import { createWorkflowFromSource } from '@/lib/workflows/application/apply-workflow-source'
import { workflowOperations } from '@/lib/workflows/application/operations'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/v2/workspaces/[workspaceId]/workflows/source — creates a workflow from TypeScript
 * source through the same pipeline and checks as an apply, in one all-or-nothing write. Error
 * diagnostics answer 400 and nothing is created; a dry run answers 200 with its diagnostics and
 * creates nothing. Answers 403 while the `workflow-code` flag is off. Charged and admitted as an
 * apply is (`v2RateLimits.sourceApply`): a real create shares the source-write budget and the
 * apply slots, and a dry run the source-plan budget and the plan slots.
 */
export const POST = defineV2JsonRoute({
  contract: v2CreateWorkflowFromSourceContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.createFromSource,
  rateLimit: v2RateLimits.sourceApply,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkspaceSourceCreate,
  parseOptions: { maxBodyBytes: SOURCE_REQUEST_MAX_BYTES },
  mapInput: ({ params, query, body }) => ({
    workspaceId: params.workspaceId,
    files: body.files,
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.folderPath !== undefined ? { folderPath: body.folderPath } : {}),
    ...(body.provenance ? { provenance: body.provenance } : {}),
    ...(query.dryRun !== undefined ? { dryRun: query.dryRun } : {}),
  }),
  useCase: withSourceSlot(createWorkflowFromSource, applyOrDryRunLane),
  present: (result) => ({ data: presentSourceOutcome(result) }),
})
