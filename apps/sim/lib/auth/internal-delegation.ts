import type {
  BoundWorkflowExecutionDelegatedPrincipal,
  DelegatedPrincipal,
} from '@sim/auth/principal'
import type { VerifiedInternalDelegation } from '@/lib/auth/internal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
  resolveActiveWorkflowDeploymentVersionApplicationContext,
  resolveActiveWorkflowExecutionApplicationContext,
  resolveActiveWorkflowRunApplicationContext,
} from '@/lib/workflows/application/context'

export interface BindInternalExecutorDelegationOptions {
  audience: string
  resourceScope?: DelegatedPrincipal['resourceScope']
}

export class InvalidInternalDelegationBindingError extends Error {
  constructor() {
    super('Internal delegation no longer resolves to an active workflow execution')
    this.name = 'InvalidInternalDelegationBindingError'
  }
}

/** Binds signed executor claims to the workflow's canonical active workspace. */
export async function bindInternalExecutorDelegation(
  claims: VerifiedInternalDelegation,
  options: BindInternalExecutorDelegationOptions
): Promise<BoundWorkflowExecutionDelegatedPrincipal> {
  if (!options.audience.trim()) throw new Error('Internal delegation audience must not be empty')

  let context: ActiveWorkflowApplicationContext
  let rootDeploymentVersionId: string | null | undefined
  try {
    if (claims.currentWorkflow) {
      if (!claims.executionId) throw new InvalidInternalDelegationBindingError()
      const executionContext = await resolveActiveWorkflowExecutionApplicationContext({
        runId: claims.executionId,
        assertedWorkflowId: claims.workflowId,
      })
      context = executionContext
      rootDeploymentVersionId = executionContext.deploymentVersionId
    } else if (claims.executionId) {
      context = await resolveActiveWorkflowRunApplicationContext({
        runId: claims.executionId,
        assertedWorkflowId: claims.workflowId,
      })
    } else {
      context = await resolveActiveWorkflowApplicationContext({ workflowId: claims.workflowId })
    }
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      throw new InvalidInternalDelegationBindingError()
    }
    throw error
  }

  if (claims.currentWorkflow) {
    if (claims.currentWorkflow.workflowId === context.workflowId) {
      const matchesRootExecution =
        claims.currentWorkflow.mode === 'draft'
          ? rootDeploymentVersionId === null
          : rootDeploymentVersionId === claims.currentWorkflow.deploymentVersionId
      if (!matchesRootExecution) {
        throw new InvalidInternalDelegationBindingError()
      }
    } else {
      try {
        const currentContext =
          claims.currentWorkflow.mode === 'deployment'
            ? await resolveActiveWorkflowDeploymentVersionApplicationContext({
                workflowId: claims.currentWorkflow.workflowId,
                deploymentVersionId: claims.currentWorkflow.deploymentVersionId,
                assertedWorkspaceId: context.workspaceId,
              })
            : await resolveActiveWorkflowApplicationContext({
                workflowId: claims.currentWorkflow.workflowId,
                assertedWorkspaceId: context.workspaceId,
              })
        if (currentContext.workspaceId !== context.workspaceId) {
          throw new InvalidInternalDelegationBindingError()
        }
      } catch (error) {
        if (asOrchestrationError(error)?.code === 'not_found') {
          throw new InvalidInternalDelegationBindingError()
        }
        throw error
      }
    }
  }

  return {
    kind: 'delegated',
    serviceId: 'executor',
    ...(claims.subjectUserId ? { subjectUserId: claims.subjectUserId } : {}),
    workspaceId: context.workspaceId,
    delegationId: claims.delegationId,
    audience: options.audience,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    ...(options.resourceScope ? { resourceScope: options.resourceScope } : {}),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: context.workflowId,
      ...(claims.executionId ? { executionId: claims.executionId } : {}),
      ...(claims.principal ? { principal: claims.principal } : {}),
      ...(claims.currentWorkflow ? { currentWorkflow: claims.currentWorkflow } : {}),
    },
  }
}
