import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
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
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import { replaceWorkflowNormalizedState } from '@/lib/workflows/persistence/replace-normalized-state'
import { validateWorkflowState } from '@/lib/workflows/sanitization/validation'

const logger = createLogger('ReplaceWorkflowState')

export interface ReplaceWorkflowStateInput {
  workflowId: string
  assertedWorkspaceId?: string
  blocks: Record<string, BlockState>
  edges: WorkflowState['edges']
  /** Omitted leaves the stored variables untouched. */
  variables?: Record<string, unknown>
}

export interface ReplaceWorkflowStateResult {
  workflowId: string
  workflowName: string
  workspaceId: string
  blocksCount: number
  edgesCount: number
  warnings: string[]
  needsRedeployment: boolean
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

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const persisted = await replaceWorkflowNormalizedState({
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      attributedUserId: attribution.attributedUserId,
      state: {
        blocks: sanitized.blocks as Record<string, BlockState>,
        edges: sanitized.edges as WorkflowState['edges'],
        variables: input.variables,
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
    }
  },
  projectAudit: ({ principal, context, result }) => ({
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
  }),
  afterSuccess: ({ context }) => notifyWorkflowUpdated(context.workflowId),
})
