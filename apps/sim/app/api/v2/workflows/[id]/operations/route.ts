import { v2ApplyWorkflowOperationsContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { applyWorkflowOperations } from '@/lib/workflows/application/apply-workflow-operations'
import { workflowOperations } from '@/lib/workflows/application/operations'
import type { WorkflowLintBlockRef } from '@/lib/workflows/editing/lint'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Projects the shared block reference every lint finding carries onto the wire shape. */
function blockRef(ref: WorkflowLintBlockRef) {
  return {
    blockId: ref.blockId,
    blockName: ref.blockName ?? null,
    blockType: ref.blockType ?? null,
  }
}

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
  mapInput: ({ params, body }) => ({
    workflowId: params.id,
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
      lint: {
        sources: result.lint.sources.map(blockRef),
        sinks: result.lint.sinks.map(blockRef),
        orphanBlocks: result.lint.orphanBlocks.map(blockRef),
        emptyOutgoingPorts: result.lint.emptyOutgoingPorts.map((port) => ({
          ...blockRef(port),
          handle: port.handle,
          label: port.label,
        })),
        invalidBranchPorts: result.lint.invalidBranchPorts.map((port) => ({
          ...blockRef(port),
          sourceHandle: port.sourceHandle,
          reason: port.reason,
        })),
        invalidConnectionTargets: result.lint.invalidConnectionTargets.map((target) => ({
          sourceBlockId: target.sourceBlockId,
          sourceBlockName: target.sourceBlockName ?? null,
          sourceHandle: target.sourceHandle ?? null,
          targetBlockId: target.targetBlockId,
          reason: target.reason,
        })),
        fieldIssues: result.lint.fieldIssues.map((issue) => ({
          ...blockRef(issue),
          missingRequiredFields: issue.missingRequiredFields,
          inactiveModeValues: issue.inactiveModeValues.map((value) => ({
            canonicalId: value.canonicalId,
            activeMemberId: value.activeMemberId ?? null,
            inactiveMemberId: value.inactiveMemberId,
            kind: value.kind,
          })),
        })),
        unresolvedReferences: result.lint.unresolvedReferences.map((reference) => ({
          ...blockRef(reference),
          field: reference.field,
          value: reference.value,
          kind: reference.kind,
          reason: reference.reason,
        })),
        notes: result.lint.notes,
      },
      warnings: result.warnings,
      needsRedeployment: result.needsRedeployment,
    },
  }),
})
