import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution, toPrincipalActor } from '@sim/auth/principal'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { notifyWorkflowReverted } from '@/lib/realtime/notify'
import { requireWorkflowExecutionUserId } from '@/lib/workflows/application/authorization'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { assertedWorkflowWorkspaceId } from '@/lib/workflows/application/principal-scope'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  getWorkflowDeploymentSummary,
  performActivateVersion,
  performFullDeploy,
  performFullUndeploy,
  performRevertToVersion,
} from '@/lib/workflows/orchestration'
import {
  findPreviousDeploymentVersion,
  updateDeploymentVersionMetadata,
} from '@/lib/workflows/persistence/utils'

export interface DeployWorkflowInput {
  workflowId: string
  assertedWorkspaceId?: string
  name?: string
  description?: string
  requestId: string
  idempotencyKey?: string
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

function resolveWorkflowContext<I extends { workflowId: string; assertedWorkspaceId?: string }>({
  principal,
  input,
}: {
  principal: Principal
  input: I
}) {
  return resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
    assertedWorkspaceId: assertedWorkflowWorkspaceId(principal, input.assertedWorkspaceId),
  })
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

export const deployWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.deploy,
  resolveContext: resolveWorkflowContext<DeployWorkflowInput>,
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
    return {
      ...result,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
    }
  },
})

export const undeployWorkflow = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.undeploy,
  resolveContext: resolveWorkflowContext<UndeployWorkflowInput>,
  async execute({ principal, input, context }) {
    if (!context.workflow.isDeployed) {
      throw new OrchestrationError('validation', 'Workflow is not deployed')
    }
    await requireMutableWorkflow(context.workflowId)
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
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
  resolveContext: resolveWorkflowContext<ActivateWorkflowVersionInput>,
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
  resolveContext: resolveWorkflowContext<ReadWorkflowDeploymentStatusInput>,
  async execute({ context }) {
    const deploymentSummary = await getWorkflowDeploymentSummary(context.workflowId)
    const isDeployed = deploymentSummary.activeDeployment !== null
    const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
    const needsRedeployment =
      isDeployed && attemptStatus !== 'preparing' && attemptStatus !== 'activating'
        ? await checkNeedsRedeployment(context.workflowId)
        : false
    return {
      workflow: context.workflow,
      workspaceId: context.workspaceId,
      isDeployed,
      needsRedeployment,
      ...deploymentSummary,
    }
  },
})

export const revertWorkflowVersion = defineAuthorizedWorkflowUseCase({
  operation: workflowOperations.revertVersion,
  resolveContext: resolveWorkflowContext<RevertWorkflowVersionInput>,
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
  resolveContext: resolveWorkflowContext<UpdateWorkflowVersionInput>,
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
