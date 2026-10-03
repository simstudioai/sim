import { v2ApplyWorkflowOperationsContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'
import { presentWorkflowLint } from '@/app/api/v2/lib/workflow-lint'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Semantic edits against a workflow graph.
 *
 * Best-effort per operation, atomic per write: the engine applies what it can
 * and reports the rest in `skipped`, and exactly one write of the fully-resolved
 * graph happens at the end. `atomic: true` moves the decision in front of that
 * write and answers `409` instead, so nothing is persisted.
 */
export const POST = defineV2JsonRoute({
  contract: v2ApplyWorkflowOperationsContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.applyOperations,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.concealWorkflowGraphAuthorization,
  parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  mapInput: ({ params, query, body }) => ({
    workflowId: params.workflowId,
    dryRun: query.dryRun,
    operations: body.operations,
    atomic: body.atomic,
    layout: body.layout,
    blockEnabledChanges: body.setBlockEnabled?.map((change) => ({
      blockId: change.block_id,
      enabled: change.enabled,
    })),
  }),
  useCase: applyWorkflowOperations,
  present: (result) => ({
    data: {
      id: result.workflowId,
      applied: result.applied,
      skipped: result.skipped,
      deferred: result.deferred,
      inputValidationErrors: result.inputValidationErrors.map((error) => ({
        blockId: error.blockId,
        blockType: error.blockType,
        field: error.field,
        error: error.error,
      })),
      mintedBlockIds: result.mintedBlockIds,
      ...(result.previewBlockIds ? { previewBlockIds: result.previewBlockIds } : {}),
      lint: presentWorkflowLint(result.lint),
      warnings: result.warnings,
      needsRedeployment: result.needsRedeployment,
      dryRun: result.dryRun,
    },
  }),
})
