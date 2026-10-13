import { AuditAction, AuditResourceType } from '@sim/audit'
import {
  resolvePrincipalAttribution,
  resolvePrincipalSubjectUserId,
  toPrincipalActor,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { withinDeadline } from '@/lib/core/utils/deadline'
import { listLiveWorkflowMcpToolsForWorkflow } from '@/lib/mcp/queries'
import { notifyWorkflowReverted } from '@/lib/realtime/notify'
import { listDeployedWebhookUrls } from '@/lib/webhooks/deployed-urls'
import { requireWorkflowExecutionUserId } from '@/lib/workflows/application/authorization'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { resolvePrincipalWorkflowContext } from '@/lib/workflows/application/principal-scope'
import { withWorkflowBlockScope } from '@/lib/workflows/application/workflow-block-scope'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import type { WorkflowLintReport } from '@/lib/workflows/editing/lint'
import { buildWorkflowLintReport } from '@/lib/workflows/editing/lint-report'
import {
  getWorkflowDeploymentSummary,
  performActivateVersion,
  performFullDeploy,
  performFullUndeploy,
  performRevertToVersion,
} from '@/lib/workflows/orchestration'
import {
  findPreviousDeploymentVersion,
  loadWorkflowDeploymentVersionState,
  updateDeploymentVersionMetadata,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('WorkflowDeployments')

export interface DeployWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
  name?: string
  description?: string
  requestId: string
  idempotencyKey?: string
  /**
   * Lint the version this deploy publishes and return the report as `lint`.
   * Opt-in because it costs reference lookups on every deploy, and only a
   * surface that presents the findings should pay for them.
   */
  lintDeployedVersion?: boolean
}

export interface UndeployWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
  requestId: string
}

export interface ActivateWorkflowVersionInput {
  workflowId: string
  assertedWorkspaceId?: string
  version?: number
  transition: 'activate' | 'rollback'
  requestId: string
  idempotencyKey?: string
  name?: string | null
  description?: string | null
}

export interface ReadWorkflowDeploymentStatusInput {
  workflowId: string
  assertedWorkspaceId?: string
}

export interface RevertWorkflowVersionInput {
  workflowId: string
  assertedWorkspaceId?: string
  version: number | 'active'
}

export interface UpdateWorkflowVersionInput {
  workflowId: string
  assertedWorkspaceId?: string
  version: number
  name?: string | null
  description?: string | null
}

function throwDeploymentFailure(
  result: { error?: string; errorCode?: OrchestrationErrorCode },
  fallback: string
): never {
  if (!result.errorCode || result.errorCode === 'internal') {
    throw new Error(fallback)
  }
  throw new OrchestrationError(result.errorCode, result.error ?? fallback)
}

async function requireMutableWorkflow(workflowId: string): Promise<void> {
  try {
    await assertWorkflowMutable(workflowId)
  } catch (error) {
    if (error instanceof WorkflowLockedError) {
      throw new OrchestrationError('locked', error.message)
    }
    throw error
  }
}

/**
 * How long a deploy waits for its lint. The lint reads credentials, tools, and
 * table schemas, so a slow lookup would otherwise hold a deploy that has
 * already committed. The lookups are not cancelled; the deploy only stops
 * waiting for them.
 */
const DEPLOYED_VERSION_LINT_BUDGET_MS = 5_000

/**
 * Lints the version a deploy admitted. That version serves callers once
 * activation completes, so it is linted even while activation is still pending.
 *
 * Deploy does not refuse on lint: findings are advisory, and some depend on the
 * identity that runs the workflow. But a caller that deployed without linting
 * would otherwise first learn of a block that cannot run from a failed live
 * execution. Linting is best-effort: a failure or an exhausted budget returns
 * `null` and never fails the deploy that preceded it.
 */
async function lintDeployedVersion(
  context: ActiveWorkflowApplicationContext,
  deploymentVersionId: string,
  subjectUserId: string | null
): Promise<WorkflowLintReport | null> {
  try {
    return await withinDeadline(
      () =>
        withWorkflowBlockScope(context, async () =>
          buildWorkflowLintReport(
            await loadWorkflowDeploymentVersionState(
              context.workflowId,
              deploymentVersionId,
              context.workspaceId
            ),
            { workflowId: context.workflowId, workspaceId: context.workspaceId, subjectUserId }
          )
        ),
      Date.now() + DEPLOYED_VERSION_LINT_BUDGET_MS
    )
  } catch (error) {
    logger.warn('Deployed version lint did not complete', {
      workflowId: context.workflowId,
      error: getErrorMessage(error),
    })
    return null
  }
}

export const deployWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.deploy,
  resolveContext: resolvePrincipalWorkflowContext<DeployWorkflowInput>,
  async execute({ principal, input, context }) {
    await requireMutableWorkflow(context.workflowId)
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performFullDeploy({
      workflowId: context.workflowId,
      userId: attribution.attributedUserId,
      actorId: attribution.attributedUserId,
      actor: toPrincipalActor(principal),
      ...(principal.kind === 'delegated' ? { captureAnalytics: false as const } : {}),
      versionName: input.name,
      versionDescription: input.description,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
    })
    if (!result.success) throwDeploymentFailure(result, 'Failed to deploy workflow')
    const lint =
      input.lintDeployedVersion && result.deploymentVersionId
        ? await lintDeployedVersion(
            context,
            result.deploymentVersionId,
            resolvePrincipalSubjectUserId(principal) ?? null
          )
        : null
    return {
      ...result,
      lint,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
    }
  },
})

export const undeployWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.undeploy,
  resolveContext: resolvePrincipalWorkflowContext<UndeployWorkflowInput>,
  async execute({ principal, input, context }) {
    if (!context.workflow.isDeployed) {
      throw new OrchestrationError('validation', 'Workflow is not deployed')
    }
    await requireMutableWorkflow(context.workflowId)
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    /**
     * Read before the undeploy, which archives every live registration of this
     * workflow: the caller sees which tools went inactive on which servers,
     * rather than finding them gone from the server's tool list.
     */
    const archivedMcpTools = await listLiveWorkflowMcpToolsForWorkflow(context.workflowId)
    const result = await performFullUndeploy({
      workflowId: context.workflowId,
      userId: attribution.attributedUserId,
      actorId: attribution.attributedUserId,
      projectLegacyAudit: false,
      requestId: input.requestId,
    })
    if (!result.success) throw new Error(result.error || 'Failed to undeploy workflow')
    return {
      ...result,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      workflowName: context.workflow.name,
      archivedMcpTools,
    }
  },

  projectAudit: ({ result }) => ({
    action: AuditAction.WORKFLOW_UNDEPLOYED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.workflowId,
    resourceName: result.workflowName,
    description: `Undeployed workflow "${result.workflowName}"`,
  }),
})

export const activateWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.activateVersion,
  resolveContext: resolvePrincipalWorkflowContext<ActivateWorkflowVersionInput>,
  async execute({ principal, input, context }) {
    if (input.transition === 'rollback' && !context.workflow.isDeployed) {
      throw new OrchestrationError('validation', 'Workflow is not deployed')
    }
    await requireMutableWorkflow(context.workflowId)

    let targetVersion = input.version
    if (targetVersion === undefined) {
      if (input.transition !== 'rollback') {
        throw new OrchestrationError('validation', 'Version is required for activation')
      }
      const previous = await findPreviousDeploymentVersion(context.workflowId)
      if (!previous.ok) {
        throw new OrchestrationError(
          'validation',
          previous.reason === 'no_active_version'
            ? 'Workflow has no active deployment to roll back from'
            : 'No previous deployment version to roll back to'
        )
      }
      targetVersion = previous.version
    }

    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performActivateVersion({
      workflowId: context.workflowId,
      version: targetVersion,
      userId: attribution.attributedUserId,
      actorId: attribution.attributedUserId,
      actor: toPrincipalActor(principal),
      ...(principal.kind === 'delegated' ? { captureAnalytics: false as const } : {}),
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
      name: input.name,
      description: input.description,
    })
    if (!result.success) throwDeploymentFailure(result, 'Failed to activate workflow version')
    return {
      ...result,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      version: targetVersion,
    }
  },
})

export const readWorkflowDeploymentStatus = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.read,
  resolveContext: resolvePrincipalWorkflowContext<ReadWorkflowDeploymentStatusInput>,
  async execute({ context }) {
    const deploymentSummary = await getWorkflowDeploymentSummary(context.workflowId)
    const isDeployed = deploymentSummary.activeDeployment !== null
    const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
    const needsRedeployment =
      isDeployed && attemptStatus !== 'preparing' && attemptStatus !== 'activating'
        ? await checkNeedsRedeployment(context.workflowId)
        : false
    const webhooks = isDeployed ? await listDeployedWebhookUrls(context.workflowId) : []
    return {
      workflow: context.workflow,
      workspaceId: context.workspaceId,
      isDeployed,
      needsRedeployment,
      webhooks,
      ...deploymentSummary,
    }
  },
})

export const revertWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.revertVersion,
  resolveContext: resolvePrincipalWorkflowContext<RevertWorkflowVersionInput>,
  async execute({ principal, input, context }) {
    const userId = requireWorkflowExecutionUserId(principal)
    await requireMutableWorkflow(context.workflowId)
    const result = await performRevertToVersion({
      workflowId: context.workflowId,
      version: input.version,
      userId,
      actorId: userId,
      workflow: context.workflow,
      captureAnalytics: false,
      projectLegacyAudit: false,
      notifyRealtime: false,
    })
    if (!result.success) throwDeploymentFailure(result, 'Failed to revert workflow version')
    if (result.lastSaved === undefined) {
      throw new Error('Successful workflow version revert returned no save timestamp')
    }
    return {
      workflowId: context.workflowId,
      workflowName: context.workflow.name,
      workspaceId: context.workspaceId,
      version: input.version,
      lastSaved: result.lastSaved,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.WORKFLOW_DEPLOYMENT_REVERTED,
    resourceType: AuditResourceType.WORKFLOW,
    resourceId: result.workflowId,
    resourceName: result.workflowName,
    description: `Reverted workflow to deployment version ${String(result.version)}`,
    metadata: { targetVersion: String(result.version) },
  }),
  afterSuccess: ({ result }) => notifyWorkflowReverted(result.workflowId, result.lastSaved),
})

export const updateWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.updateVersion,
  resolveContext: resolvePrincipalWorkflowContext<UpdateWorkflowVersionInput>,
  async execute({ input, context }) {
    const updated = await updateDeploymentVersionMetadata({
      workflowId: context.workflowId,
      version: input.version,
      name: input.name,
      description: input.description,
    })
    if (!updated) throw new OrchestrationError('not_found', 'Deployment version not found')
    return { workflowId: context.workflowId, version: input.version, ...updated }
  },
})
