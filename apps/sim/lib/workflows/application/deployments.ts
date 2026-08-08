import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution, toPrincipalActor } from '@sim/auth/principal'
import { assertWorkflowMutable, WorkflowLockedError } from '@sim/platform-authz/workflow'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { defineAuthorizedWorkflowUseCase } from '@/lib/workflows/application/authorized-workflow-use-case'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  performActivateVersion,
  performFullDeploy,
  performFullUndeploy,
} from '@/lib/workflows/orchestration'
import { findPreviousDeploymentVersion } from '@/lib/workflows/persistence/utils'

export interface DeployWorkflowInput {
  workflowId: string
  name?: string
  description?: string
  requestId: string
  idempotencyKey?: string
}

export interface UndeployWorkflowInput {
  workflowId: string
  requestId: string
}

export interface ActivateWorkflowVersionInput {
  workflowId: string
  version?: number
  transition: 'activate' | 'rollback'
  requestId: string
  idempotencyKey?: string
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
  resolveContext: ({ input }: { input: DeployWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
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
      captureAnalytics: false,
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
  resolveContext: ({ input }: { input: UndeployWorkflowInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
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
    if (!result.success) throw new Error('Failed to undeploy workflow')
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
  resolveContext: ({ input }: { input: ActivateWorkflowVersionInput }) =>
    resolveActiveWorkflowApplicationContext({ workflowId: input.workflowId }),
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
      captureAnalytics: false,
      requestId: input.requestId,
      idempotencyKey: input.idempotencyKey,
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
