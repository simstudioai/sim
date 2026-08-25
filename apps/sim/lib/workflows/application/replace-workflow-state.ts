import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  type Principal,
  PrincipalSubjectUserRequiredError,
  requirePrincipalSubjectUserId,
  resolvePrincipalAttribution,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import type { BlockState, WorkflowState } from '@sim/workflow-types/workflow'
import { principalAuditSource } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { notifyWorkflowUpdated } from '@/lib/realtime/notify'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { requireMutableWorkflow } from '@/lib/workflows/application/workflow-mutability'
import { normalizeWorkflowVariables } from '@/lib/workflows/application/workflow-variables'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'

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
   * Validate and lint without persisting. The response is byte-identical to a
   * committed write of the same body, so a caller can inspect the findings it
   * would get and then send the same request for real.
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
  needsRedeployment: boolean
  /** Advisory findings about the graph. Never blocks the write. */
  lint: WorkflowLintReport
  /** True when nothing was persisted because the caller asked for a dry run. */
  dryRun: boolean
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

    const graph = {
      blocks: sanitized.blocks as Record<string, BlockState>,
      edges: sanitized.edges as WorkflowState['edges'],
    }

    /**
     * Linted before the write so a dry run and a committed write report the
     * same findings for the same body. Unlike its sibling `applyOperations`,
     * this operation admits workspace API keys, which have no human subject —
     * the reference pass is skipped for them rather than resolved against the
     * billing owner. See {@link buildWorkflowLintReport}.
     */
    const lint = await buildWorkflowLintReport(graph, {
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      subjectUserId: humanSubjectUserId(principal),
    })

    if (input.dryRun) {
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
        warnings: validation.warnings,
        needsRedeployment: await checkNeedsRedeployment(context.workflowId),
        lint,
        dryRun: true,
      }
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const persisted = await replaceWorkflowNormalizedState({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      attributedUserId: attribution.attributedUserId,
      state: {
        blocks: graph.blocks,
        edges: graph.edges,
        /**
         * Re-keyed by variable id and coerced onto each declared type by the
         * same helper `PATCH /workflows/{id}/variables` uses, so a full
         * replacement cannot write a shape the incremental path never
         * produces. Omitted stays omitted — that leaves the column untouched.
         */
        variables:
          input.variables === undefined
            ? undefined
            : normalizeWorkflowVariables(input.variables, { coerceValues: true }),
      },
    })

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
      warnings: [...validation.warnings, ...persisted.warnings],
      needsRedeployment: await checkNeedsRedeployment(context.workflowId),
      lint,
      dryRun: false,
    }
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
