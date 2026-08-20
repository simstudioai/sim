import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { ForbiddenOperationError, principalAuditSource } from '@/lib/core/application'
import { getBlockVisibility } from '@/lib/core/config/block-visibility'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { MAX_PLAN_REQUIRED } from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { requireMutableWorkflow } from '@/lib/workflows/application/workflow-mutability'
import { WorkflowOperationsNotAppliedError } from '@/lib/workflows/application/workflow-operations-error'
import {
  applyTargetedLayout,
  getTargetedLayoutImpact,
  transferBlockHeights,
} from '@/lib/workflows/autolayout'
import {
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  type BlockEnablementRefusal,
  decideBlockEnablement,
} from '@/lib/workflows/editing/block-enablement'
import { applyOperationsToWorkflowState } from '@/lib/workflows/editing/engine'
import {
  collectWorkflowFieldIssues,
  lintEditedWorkflowState,
  type WorkflowLintReport,
  type WorkflowLintUnresolvedReference,
} from '@/lib/workflows/editing/lint'
import { operationsReferenceSimSandbox } from '@/lib/workflows/editing/sandbox-projection'
import {
  type EditWorkflowOperation,
  isDeferredSkippedItem,
  type SkippedItem,
  type SkippedItemType,
  type ValidationError,
} from '@/lib/workflows/editing/types'
import {
  collectUnresolvedAgentToolReferences,
  collectUnresolvedReferences,
  preValidateCredentialInputs,
  UNRESOLVABLE_AT_LINT_NOTE,
} from '@/lib/workflows/editing/validation'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import { withBlockVisibility } from '@/blocks/visibility/server-context'
import { getUserPermissionConfig } from '@/ee/access-control/utils/permission-check'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { normalizeWorkflowState } from '@/stores/workflows/workflow/validation'

const logger = createLogger('ApplyWorkflowOperations')

/** One enable/disable request riding along with an edit batch. */
export interface WorkflowBlockEnabledChange {
  blockId: string
  enabled: boolean
}

export interface ApplyWorkflowOperationsInput {
  workflowId: string
  assertedWorkspaceId?: string
  operations: EditWorkflowOperation[]
  /** Refuse the whole batch, writing nothing, when any operation is declined. */
  atomic?: boolean
  /** `none` keeps every supplied position exactly as given. */
  layout?: 'targeted' | 'none'
  blockEnabledChanges?: WorkflowBlockEnabledChange[]
  /**
   * A caller-supplied base graph to edit against instead of the stored one.
   *
   * Only ever honoured for a `delegated` principal: it is how Copilot edits the
   * unsaved canvas a user is looking at. On any credential-authenticated surface
   * it would be an authoritative-state substitute supplied by the caller, which
   * is exactly what an application use case must never infer from its arguments.
   */
  baseGraph?: Record<string, unknown>
  /** Cancellation checkpoint, invoked before each step that commits work. */
  checkAborted?: () => void
}

export interface ApplyWorkflowOperationsResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  graph: {
    blocks: Record<string, BlockState>
    edges: WorkflowState['edges']
    loops: ReturnType<typeof generateLoopBlocks>
    parallels: ReturnType<typeof generateParallelBlocks>
  }
  operationCount: number
  applied: number
  skipped: SkippedItem[]
  deferred: SkippedItem[]
  inputValidationErrors: ValidationError[]
  lint: WorkflowLintReport
  warnings: string[]
  needsRedeployment: boolean
}

/**
 * The engine models a graph as an open record; the layout helpers want the
 * canonical shape. One conversion, named, rather than a cast at each call.
 */
function asGraph(value: Record<string, unknown>): Pick<WorkflowState, 'blocks' | 'edges'> {
  // double-cast-allowed: the edit engine models a graph as an open record; this is the one place it is read back as the canonical shape, and the layout helpers tolerate missing keys.
  return value as unknown as Pick<WorkflowState, 'blocks' | 'edges'>
}

async function loadStoredGraph(workflowId: string): Promise<Record<string, unknown>> {
  const normalized = await loadWorkflowFromNormalizedTables(workflowId)
  if (!normalized) {
    throw new OrchestrationError('validation', `Workflow ${workflowId} has no normalized state`)
  }
  const { state, warnings } = normalizeWorkflowState({
    blocks: normalized.blocks,
    edges: normalized.edges,
    loops: normalized.loops || {},
    parallels: normalized.parallels || {},
  })
  if (warnings.length > 0) {
    logger.warn('Stored workflow state needed normalization before editing', {
      workflowId,
      warnings,
    })
  }
  // double-cast-allowed: the edit engine takes an open record; `normalizeWorkflowState` returns the canonical interface, which has no index signature.
  return state as unknown as Record<string, unknown>
}

/**
 * How many of the engine's skips charge against the operation batch.
 *
 * The enablement slice appends to the same array, and a deferred forward
 * reference is not a refusal at all, so neither may be subtracted from the
 * operation count.
 */
function countOperationSkips(skippedItems: readonly SkippedItem[]): number {
  let count = 0
  for (const item of skippedItems) {
    if (item.operationType !== 'set_block_enabled' && !isDeferredSkippedItem(item)) count += 1
  }
  return count
}

/**
 * How each enablement refusal maps onto the machine-readable skip enum. Kept as
 * a total `Record` so a new refusal reason fails to compile until it is
 * classified, and kept aligned with `BLOCK_ENABLEMENT_REFUSAL_CODES`, which
 * makes the same three-way distinction for the single-toggle operation.
 */
const BLOCK_ENABLEMENT_SKIPPED_ITEM_TYPES: Record<
  BlockEnablementRefusal['reason'],
  SkippedItemType
> = {
  not_found: 'block_not_found',
  locked: 'block_locked',
  disabled_ancestor: 'disabled_ancestor',
}

/**
 * Applies the enable/disable slice of a batch in memory.
 *
 * A refusal is recorded as a skipped item rather than thrown, so the slice
 * follows the same best-effort contract as the operations beside it and a single
 * protected block cannot silently discard an otherwise valid batch.
 */
function applyBlockEnabledChanges(
  blocks: Record<string, BlockState>,
  changes: readonly WorkflowBlockEnabledChange[],
  skippedItems: SkippedItem[]
): { blocks: Record<string, BlockState>; applied: number } {
  let current = blocks
  let applied = 0
  for (const change of changes) {
    const decision = decideBlockEnablement(current, change.blockId, change.enabled)
    if (decision.outcome === 'refused') {
      skippedItems.push({
        type: BLOCK_ENABLEMENT_SKIPPED_ITEM_TYPES[decision.refusal.reason],
        operationType: 'set_block_enabled',
        blockId: change.blockId,
        reason: decision.refusal.message,
      })
      continue
    }
    if (decision.outcome === 'changed') {
      current = decision.blocks
    }
    applied += 1
  }
  return { blocks: current, applied }
}

async function resolveBaseGraph(
  principal: Principal,
  input: ApplyWorkflowOperationsInput,
  context: ActiveWorkflowApplicationContext
): Promise<Record<string, unknown>> {
  if (input.baseGraph && principal.kind === 'delegated') return input.baseGraph
  return loadStoredGraph(context.workflowId)
}

/**
 * The one semantic edit operation on a workflow graph.
 *
 * Best-effort at the operation level and atomic at the persistence level: the
 * engine applies what it can to an in-memory graph and records the rest as typed
 * skipped items, and exactly one write of the fully-resolved graph happens at the
 * end, through the shared persistence primitive. A caller that needs all-or-nothing
 * sets `atomic`, which decides between the in-memory apply and that single write.
 *
 * Copilot's `edit_workflow` tool and `POST /api/v2/workflows/{id}/operations` are
 * both adapters over this; the tool is the only caller allowed to supply
 * `baseGraph`.
 */
export const applyWorkflowOperations = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.applyOperations,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ApplyWorkflowOperationsInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }): Promise<ApplyWorkflowOperationsResult> {
    if (input.operations.length === 0) {
      throw new OrchestrationError('validation', 'operations cannot be empty')
    }
    await requireMutableWorkflow(context.workflowId)

    if (
      operationsReferenceSimSandbox(input.operations) &&
      !(await hasWorkspaceSandboxAccess(context.workspaceId))
    ) {
      throw new ForbiddenOperationError('WORKSPACE_PLAN_CAPABILITY_REQUIRED', MAX_PLAN_REQUIRED)
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const subjectUserId = attribution.attributedUserId

    input.checkAborted?.()
    const baseGraph = await resolveBaseGraph(principal, input, context)

    const [permissionConfig, blockVisibility] = await Promise.all([
      getUserPermissionConfig(subjectUserId, context.workspaceId),
      getBlockVisibility({ userId: subjectUserId, orgId: context.workspaceOrganizationId }),
    ])

    const { filteredOperations, errors: credentialErrors } = await preValidateCredentialInputs(
      input.operations,
      { userId: subjectUserId, workspaceId: context.workspaceId },
      baseGraph
    )

    const {
      state: modifiedGraph,
      validationErrors,
      skippedItems,
    } = await withBlockVisibility(blockVisibility, async () =>
      applyOperationsToWorkflowState(baseGraph, filteredOperations, permissionConfig)
    )
    validationErrors.push(...credentialErrors)

    /**
     * Counted directly rather than as `operations - skipped`. The enablement
     * slice pushes its own refusals into the same `skippedItems` array, so
     * subtracting the whole array from the operation count charged enablement
     * refusals against operations and could go negative.
     */
    const appliedOperations = filteredOperations.length - countOperationSkips(skippedItems)

    const enablement = applyBlockEnabledChanges(
      modifiedGraph.blocks as Record<string, BlockState>,
      input.blockEnabledChanges ?? [],
      skippedItems
    )
    modifiedGraph.blocks = enablement.blocks
    const applied = appliedOperations + enablement.applied

    const unresolvedReferences: WorkflowLintUnresolvedReference[] = []
    for (const collect of [collectUnresolvedReferences, collectUnresolvedAgentToolReferences]) {
      try {
        // Reported only through `lint`. `collectUnresolvedReferences` is
        // read-only, so the values it flags stay persisted — pushing them into
        // `inputValidationErrors` as well would double-report them, and falsely,
        // since that field means "dropped rather than persisted".
        const references = await collect(modifiedGraph, {
          userId: subjectUserId,
          workspaceId: context.workspaceId,
        })
        unresolvedReferences.push(...references)
      } catch (error) {
        logger.warn('Reference resolution lint failed', {
          workflowId: context.workflowId,
          error: getErrorMessage(error),
        })
      }
    }

    const validation = validateWorkflowState(modifiedGraph, { sanitize: true })
    if (!validation.valid) {
      throw new OrchestrationError(
        'validation',
        `Invalid edited workflow: ${validation.errors.join('; ')}`
      )
    }

    const genuineSkippedItems = skippedItems.filter((item) => !isDeferredSkippedItem(item))
    const deferredItems = skippedItems.filter(isDeferredSkippedItem)
    /**
     * A dropped input refuses the batch as surely as a declined operation does.
     * `preValidateCredentialInputs` and the engine both delete fields rather
     * than fail, so an atomic batch that only reads `skipped` would commit a
     * block whose credential or API key was silently stripped — the opposite of
     * what all-or-nothing promises.
     */
    if (input.atomic && (genuineSkippedItems.length > 0 || validationErrors.length > 0)) {
      throw new WorkflowOperationsNotAppliedError(genuineSkippedItems, validationErrors)
    }

    const finalGraph = validation.sanitizedState || modifiedGraph
    const blocks: Record<string, BlockState> =
      input.layout === 'none'
        ? (finalGraph.blocks as Record<string, BlockState>)
        : layoutChangedBlocks(context.workflowId, asGraph(baseGraph), asGraph(finalGraph))

    const graph = {
      blocks,
      edges: finalGraph.edges as WorkflowState['edges'],
      loops: generateLoopBlocks(blocks),
      parallels: generateParallelBlocks(blocks),
    }

    /**
     * `notes` is assigned after the graph-lint spread and that is safe: notes
     * are this layer's to produce. `lintEditedWorkflowState` returns
     * {@link WorkflowLintResult}, which declares no `notes` member, so the
     * assignment can never discard a finding the linter made.
     */
    const lint: WorkflowLintReport = {
      ...lintEditedWorkflowState(graph),
      fieldIssues: collectWorkflowFieldIssues(graph.blocks),
      unresolvedReferences,
      notes: unresolvedReferences.length > 0 ? [UNRESOLVABLE_AT_LINT_NOTE] : [],
    }

    input.checkAborted?.()
    const persisted = await replaceWorkflowNormalizedState({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      attributedUserId: subjectUserId,
      state: { blocks: graph.blocks, edges: graph.edges },
    })

    logger.info('Applied workflow operations', {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      operationCount: input.operations.length,
      applied,
      skipped: genuineSkippedItems.length,
      principalKind: principal.kind,
    })

    return {
      workflowId: context.workflowId,
      workflowName: context.workflow.name,
      workspaceId: context.workspaceId,
      graph,
      operationCount: input.operations.length,
      applied,
      skipped: genuineSkippedItems,
      deferred: deferredItems,
      inputValidationErrors: validationErrors,
      lint,
      warnings: [...validation.warnings, ...persisted.warnings],
      needsRedeployment: await checkNeedsRedeployment(context.workflowId),
    }
  },
  projectAudit: ({ principal, context, result }) => ({
    action: AuditAction.WORKFLOW_UPDATED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: context.workflowId,
    resourceName: result.workflowName,
    description: `Applied ${result.operationCount} edit operation(s) to workflow "${result.workflowName}"`,
    metadata: {
      op: 'apply_operations',
      operationCount: result.operationCount,
      appliedCount: result.applied,
      skippedCount: result.skipped.length,
      blocksCount: Object.keys(result.graph.blocks).length,
      edgesCount: result.graph.edges.length,
      source: principalAuditSource(principal),
    },
  }),
  afterSuccess: ({ context }) => notifyWorkflowUpdated(context.workflowId),
})

/**
 * Nudges only the blocks this batch touched, leaving the rest of the canvas
 * where the user put it. A layout failure is never fatal: the graph is already
 * correct, only its positions are less tidy.
 */
function layoutChangedBlocks(
  workflowId: string,
  before: Pick<WorkflowState, 'blocks' | 'edges'>,
  after: Pick<WorkflowState, 'blocks' | 'edges'>
): Record<string, BlockState> {
  const { layoutBlockIds, resizedBlockIds, shiftSourceBlockIds } = getTargetedLayoutImpact({
    before,
    after,
  })
  if (
    layoutBlockIds.length === 0 &&
    resizedBlockIds.length === 0 &&
    shiftSourceBlockIds.length === 0
  ) {
    return after.blocks
  }
  try {
    transferBlockHeights(before.blocks, after.blocks)
    return applyTargetedLayout(after.blocks, after.edges, {
      changedBlockIds: layoutBlockIds,
      resizedBlockIds,
      shiftSourceBlockIds,
      horizontalSpacing: DEFAULT_HORIZONTAL_SPACING,
      verticalSpacing: DEFAULT_VERTICAL_SPACING,
      previousBlocks: before.blocks,
    }) as Record<string, BlockState>
  } catch (error) {
    logger.warn('Targeted autolayout failed, using supplied positions', {
      workflowId,
      error: toError(error).message,
    })
    return after.blocks
  }
}
