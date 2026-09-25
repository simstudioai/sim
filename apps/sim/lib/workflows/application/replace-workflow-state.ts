import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  PrincipalSubjectUserRequiredError,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
} from '@sim/auth/principal'
import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { withWorkflowBlockScope } from '@/lib/workflows/application/workflow-block-scope'
import { requireMutableWorkflow } from '@/lib/workflows/application/workflow-mutability'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  collectRemovedWorkflowBindings,
  type RemovedWorkflowBinding,
} from '@/lib/workflows/editing/binding-changes'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { validateValueForSubBlockType } from '@/lib/workflows/editing/validation'
import { assertNoWithheldBlockType } from '@/lib/workflows/persistence/block-access-guard'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import {
  assertWorkflowGraphIdsUnclaimed,
  collectWorkflowGraphIds,
  replaceWorkflowNormalizedState,
} from '@/lib/workflows/persistence/replace-normalized-state'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'
import {
  getToolBindingAuthoringSchema,
  validateToolBindingAuthoring,
} from '@/lib/workflows/tool-input/authoring'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('ReplaceWorkflowState')

/**
 * The human a principal acts as, or `null` when it does not act as one.
 *
 * Deliberately not `resolvePrincipalAttribution`: that answers a workspace API
 * key with the workspace's billing owner, which is correct for billing and
 * wrong for anything that reads a person's own grants.
 *
 * `workflows.state.replace` now admits only principals that name a human, so
 * the `null` branch is unreachable through this operation. It is kept as a
 * fail-safe: if that policy is ever widened, the reference pass degrades and
 * says so in `lint.notes` rather than silently resolving one person's grants
 * against another's.
 */
function humanSubjectUserId(principal: Principal): string | null {
  try {
    return requirePrincipalSubjectUserId(principal)
  } catch (error) {
    if (error instanceof PrincipalSubjectUserRequiredError) return null
    throw error
  }
}

export interface ReplaceWorkflowStateInput {
  workflowId: string
  assertedWorkspaceId?: string
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  /** Omitted leaves the stored variables untouched. */
  variables?: Record<string, unknown>
  /**
   * Validate and lint without persisting. Binding removals describe the current
   * snapshot; a later committed write compares against the state it replaces.
   */
  dryRun?: boolean
}

export interface ReplaceWorkflowStateResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  blocksCount: number
  edgesCount: number
  warnings: string[]
  /** Non-secret credential/table references removed by this proposed replacement. */
  removedBindings: RemovedWorkflowBinding[]
  needsRedeployment: boolean
  /** Advisory findings about the graph. Never blocks the write. */
  lint: WorkflowLintReport
  /** True when nothing was persisted because the caller asked for a dry run. */
  dryRun: boolean
}

/** Validates saved attachment identity against the same baseline the replacement will overwrite. */
function assertSavedToolBindings(
  blocks: Record<string, BlockState>,
  previous: Record<string, BlockState> | undefined
): void {
  if (!previous) {
    throw new OrchestrationError(
      'validation',
      'Cannot validate tool edits without the saved workflow state'
    )
  }
  for (const [blockId, block] of Object.entries(blocks)) {
    const config = getBlock(block.type)
    if (!config) continue
    for (const field of config.subBlocks) {
      if (field.type !== 'tool-input' || !block.subBlocks[field.id]) continue
      const savedBlock = previous[blockId]
      const error = validateToolBindingAuthoring(
        block.type,
        block.subBlocks[field.id].value,
        savedBlock?.type === block.type ? savedBlock.subBlocks[field.id]?.value : undefined
      )
      if (error)
        throw new OrchestrationError('validation', `Block ${block.name || blockId}: ${error}`)
    }
  }
}

/** Binding loss is advisory and accompanies the exact baseline used for the comparison. */
function bindingRemovalWarnings(removedBindings: RemovedWorkflowBinding[]): string[] {
  return removedBindings.length
    ? [
        `This replacement removes ${removedBindings.length} credential/table binding references. Inspect removedBindings before saving; use workflows state get for in-place edits, not workflows export.`,
      ]
    : []
}

/**
 * Replaces a workflow's editable draft graph wholesale.
 *
 * Semantic validation runs **before** the write, not because the persistence
 * layer would accept nonsense but because it would fault on it — a well-formed
 * body describing an impossible graph would otherwise be a caller-reachable 500.
 *
 * Nothing here touches deployments, schedules, or webhooks: those are only
 * changed on the deploy/undeploy path. The one observable consequence is that
 * the live deployment now differs from the draft.
 */
export const replaceWorkflowState = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.replaceState,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReplaceWorkflowStateInput
  }) =>
    resolveActiveWorkflowApplicationContext({
      workflowId: input.workflowId,
      assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  async execute({ principal, input, context }): Promise<ReplaceWorkflowStateResult> {
    await requireMutableWorkflow(context.workflowId)

    return withWorkflowBlockScope(context, async () => {
      const candidate = {
        blocks: input.blocks,
        edges: input.edges,
        loops: {},
        parallels: {},
      }
      const validation = validateWorkflowState(candidate, { sanitize: true })
      if (!validation.valid) {
        throw new OrchestrationError(
          'validation',
          `Invalid workflow state: ${validation.errors.join('; ')}`
        )
      }
      const sanitized = validation.sanitizedState ?? candidate

      /** Use registry control types, never the caller's subblock type, just as operation edits do. */
      const blocks = structuredClone(sanitized.blocks) as Record<string, BlockState>
      const enforceToolBindings =
        principal.kind === 'delegated' &&
        principal.serviceId === 'copilot' &&
        Object.values(blocks).some((block) => getToolBindingAuthoringSchema(block.type))
      for (const [blockId, block] of Object.entries(blocks)) {
        const config = getBlock(block.type)
        if (!config) continue
        const fields = new Map(config.subBlocks.map((field) => [field.id, field]))
        for (const [fieldId, stored] of Object.entries(block.subBlocks ?? {})) {
          const field = fields.get(fieldId)
          if (!field) continue
          const result = validateValueForSubBlockType(
            field,
            stored.value,
            field.id,
            block.type,
            blockId
          )
          if (!result.valid) {
            throw new OrchestrationError(
              'validation',
              `Block ${block.name || blockId}: ${result.error?.error ?? `Invalid field ${field.id}`}`
            )
          }
          stored.value = result.value
          stored.type = field.type
        }
      }

      const graph = {
        blocks,
        edges: sanitized.edges as WorkflowState['edges'],
      }

      /** Validate references as the acting human, never as the workspace billing owner. */
      const subjectUserId = humanSubjectUserId(principal)

      const lint = await buildWorkflowLintReport(graph, {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        subjectUserId,
      })

      if (input.dryRun) {
        const previous = await loadWorkflowFromNormalizedTables(context.workflowId, undefined, {
          persistMigrations: false,
        })
        if (enforceToolBindings) assertSavedToolBindings(blocks, previous?.blocks)

        /**
         * The same preparation the committed write runs, so a dry run reports the
         * notes that write would produce and checks the ids it would actually
         * insert — the prepared graph, not the caller's body. Concurrent writes
         * can still change the binding baseline or claim ids after this preview.
         */
        const prepared = prepareWorkflowStateForPersistence(graph)
        await assertWorkflowGraphIdsUnclaimed(
          db,
          context.workflowId,
          collectWorkflowGraphIds(prepared.state)
        )

        const removedBindings = collectRemovedWorkflowBindings(
          previous?.blocks ?? {},
          prepared.state.blocks
        )
        logger.info('Validated workflow state without persisting', {
          workflowId: context.workflowId,
          workspaceId: context.workspaceId,
          principalKind: principal.kind,
        })
        return {
          workflowId: context.workflowId,
          workflowName: context.workflow.name,
          workspaceId: context.workspaceId,
          blocksCount: Object.keys(graph.blocks).length,
          edgesCount: graph.edges.length,
          warnings: [
            ...validation.warnings,
            ...prepared.warnings,
            ...bindingRemovalWarnings(removedBindings),
          ],
          removedBindings,
          needsRedeployment: await checkNeedsRedeployment(context.workflowId),
          lint,
          dryRun: true,
        }
      }

      const attribution = resolvePrincipalAttribution(principal, {
        workspaceBillingOwnerUserId: context.billedAccountUserId,
      })
      /** The locked reader supplies a caller-authored graph; preserve its pre-transaction admission. */
      await assertNoWithheldBlockType(
        { workspaceId: context.workspaceId, subjectUserId },
        Object.values(graph.blocks)
      )
      let previousBlocks: Record<string, BlockState> = {}
      const variables =
        input.variables === undefined
          ? undefined
          : normalizeWorkflowVariables(input.variables, { coerceValues: true })
      const persisted = await replaceWorkflowNormalizedState({
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        attributedUserId: attribution.attributedUserId,
        /**
         * The same human the lint pass resolved above, and never
         * `attribution.attributedUserId`: that answers a workspace API key with
         * the billing owner, so reusing it would judge a caller-supplied graph
         * against a bystander's grants. This operation admits only principals
         * that name a human, so the `null` branch is a fail-safe rather than a
         * reachable state.
         */
        subjectUserId,
        state: async (tx) => {
          const previous = await loadWorkflowFromNormalizedTables(context.workflowId, tx, {
            persistMigrations: false,
          })
          if (enforceToolBindings) assertSavedToolBindings(blocks, previous?.blocks)
          previousBlocks = previous?.blocks ?? {}
          return { blocks: graph.blocks, edges: graph.edges, variables }
        },
      })

      const removedBindings = collectRemovedWorkflowBindings(previousBlocks, persisted.state.blocks)

      logger.info('Replaced workflow state', {
        workflowId: context.workflowId,
        workspaceId: context.workspaceId,
        principalKind: principal.kind,
      })

      return {
        workflowId: context.workflowId,
        workflowName: context.workflow.name,
        workspaceId: context.workspaceId,
        blocksCount: Object.keys(persisted.state.blocks).length,
        edgesCount: persisted.state.edges.length,
        warnings: [
          ...validation.warnings,
          ...persisted.warnings,
          ...bindingRemovalWarnings(removedBindings),
        ],
        removedBindings,
        needsRedeployment: await checkNeedsRedeployment(context.workflowId),
        lint,
        dryRun: false,
      }
    })
  },
  /** A dry run changes nothing, so it projects no audit entry. */
  projectAudit: ({ principal, context, result }) =>
    result.dryRun
      ? []
      : ({
          action: AuditAction.WORKFLOW_UPDATED,
          resourceType: AuditResourceType.WORKFLOW,
          resourceId: context.workflowId,
          resourceName: result.workflowName,
          description: `Replaced the draft graph of workflow "${result.workflowName}"`,
          metadata: {
            op: 'replace_state',
            blocksCount: result.blocksCount,
            edgesCount: result.edgesCount,
            warnings: result.warnings,
            source: principalAuditSource(principal),
          },
        } as const),
  afterSuccess: ({ context, result }) => {
    if (result.dryRun) return
    return notifyWorkflowUpdated(context.workflowId)
  },
})
