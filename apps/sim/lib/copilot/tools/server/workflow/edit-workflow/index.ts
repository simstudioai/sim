import { createLogger } from '@sim/logger'
import { executeCopilotWorkflowUseCase } from '@/lib/copilot/application/execute-workflow-use-case'
import { EditWorkflow } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ApplyWorkflowOperationsResult,
  applyWorkflowOperations,
} from '@/lib/workflows/application/apply-workflow-operations'
import { formatWorkflowLintMessage, hasWorkflowLintIssues } from '@/lib/workflows/editing/lint'
import type { EditWorkflowParams, SkippedItem } from '@/lib/workflows/editing/types'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'

const logger = createLogger('EditWorkflowServerTool')

/**
 * Re-states a `not_found` from the use case in terms the model can act on (#6918).
 *
 * The message is deliberately Copilot's rather than the use case's: it names
 * `workflows/**` + '/meta.json', a path that exists only in the copilot VFS, so an
 * HTTP caller hitting `POST /api/v2/workflows/{workflowId}/operations` would be
 * told to look somewhere it cannot reach. Every other classification is passed
 * through untouched.
 */
function enrichWorkflowNotFound(error: unknown, workflowId: string): unknown {
  if (error instanceof OrchestrationError && error.code === 'not_found') {
    return new OrchestrationError(
      'not_found',
      `Workflow not found: ${workflowId}. Pass the workflow's canonical id (copy it from ` +
        `workflows/**` +
        `/meta.json or the tool result that created it) — a workflow name or @-mention is not an id.`
    )
  }
  return error
}

function mapSkippedItem(item: SkippedItem) {
  return {
    type: item.type,
    operationType: item.operationType,
    blockId: item.blockId,
    reason: item.reason,
    ...(item.details && { details: item.details }),
  }
}

function parseCurrentUserWorkflow(currentUserWorkflow: string): Record<string, unknown> {
  try {
    return JSON.parse(currentUserWorkflow)
  } catch (error) {
    logger.error('Failed to parse currentUserWorkflow', error)
    throw new OrchestrationError('validation', 'Invalid currentUserWorkflow format')
  }
}

/**
 * Copilot's surface over the shared `workflows.operations.apply` use case.
 *
 * Owns only what a surface owns: argument shaping, abort checkpoints, and the
 * tool result the model reads. Authorization, the lock and plan gates, the edit
 * engine, persistence, semantic audit, and the realtime notification all live in
 * the application use case, which `POST /api/v2/workflows/{workflowId}/operations`
 * enters through as well.
 *
 * `currentUserWorkflow` — the unsaved canvas the user is looking at — is passed
 * through as `baseGraph`, which the use case honours only for a delegated
 * principal. No other surface can supply it.
 */
export const editWorkflowServerTool: BaseServerTool<EditWorkflowParams, unknown> = {
  name: EditWorkflow.id,
  async execute(params: EditWorkflowParams, context?: ServerToolContext): Promise<unknown> {
    const { operations, workflowId, currentUserWorkflow } = params
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new OrchestrationError('validation', 'operations are required and must be an array')
    }
    if (!workflowId) throw new OrchestrationError('validation', 'workflowId is required')

    logger.info('Executing edit_workflow', {
      operationCount: operations.length,
      workflowId,
      hasCurrentUserWorkflow: !!currentUserWorkflow,
      chatId: context?.chatId,
    })

    assertServerToolNotAborted(context)

    const result: ApplyWorkflowOperationsResult = await executeCopilotWorkflowUseCase(
      context,
      applyWorkflowOperations,
      {
        workflowId,
        operations,
        ...(currentUserWorkflow
          ? { baseGraph: parseCurrentUserWorkflow(currentUserWorkflow) }
          : {}),
        checkAborted: () => assertServerToolNotAborted(context),
      }
    ).catch((error: unknown) => {
      throw enrichWorkflowNotFound(error, workflowId)
    })

    const inputErrors =
      result.inputValidationErrors.length > 0
        ? result.inputValidationErrors.map(
            (error) => `Block "${error.blockId}" (${error.blockType}): ${error.error}`
          )
        : undefined
    const skippedDetails =
      result.skipped.length > 0 ? result.skipped.map(mapSkippedItem) : undefined
    const deferredDetails =
      result.deferred.length > 0 ? result.deferred.map(mapSkippedItem) : undefined
    const sanitizationWarnings = result.warnings.length > 0 ? result.warnings : undefined
    const workflowLintMessage = hasWorkflowLintIssues(result.lint)
      ? formatWorkflowLintMessage(result.lint)
      : undefined

    return {
      success: true,
      workflowId: result.workflowId,
      workflowName: result.workflowName || 'Workflow',
      /**
       * Sanitized before it reaches the agent (#6904). The graph goes back into
       * a model context, so non-serializable and oversized values have to be
       * stripped; the application use case returns the graph it persisted, not
       * a copilot-shaped one.
       */
      workflowState: sanitizeForCopilot(result.graph),
      workflowLint: result.lint,
      ...(workflowLintMessage && { workflowLintMessage }),
      ...(inputErrors && {
        inputValidationErrors: inputErrors,
        inputValidationMessage: `${inputErrors.length} input(s) were rejected due to validation errors. The workflow was still updated with valid inputs only. Errors: ${inputErrors.join('; ')}`,
      }),
      ...(skippedDetails && {
        skippedItems: skippedDetails,
        skippedItemsMessage: `${skippedDetails.length} operation(s) were skipped (not applied) and need attention. Each item includes a machine-readable "type" (e.g. block_not_found, block_locked, duplicate_block_name, invalid_block_type, invalid_source_handle, invalid_target_handle, invalid_edge_scope). Details: ${skippedDetails.map((item) => item.reason).join('; ')}`,
      }),
      ...(deferredDetails && {
        deferredConnections: deferredDetails,
        deferredMessage: `${deferredDetails.length} edge(s) were deferred because their target block does not exist yet. This is NOT a failure and does NOT need fixing: the engine wires these edges automatically once the target block exists (in this edit or a later one). Do not re-issue them. Only act on a deferred edge if its target id was a typo or hallucination that you do not intend to create. Details: ${deferredDetails.map((item) => item.reason).join('; ')}`,
      }),
      ...(sanitizationWarnings && {
        sanitizationWarnings,
        sanitizationMessage: `${sanitizationWarnings.length} field(s) were automatically sanitized: ${sanitizationWarnings.join('; ')}`,
      }),
    }
  },
}
