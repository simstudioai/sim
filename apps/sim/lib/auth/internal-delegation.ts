import type {
  BoundWorkflowExecutionDelegatedPrincipal,
  DelegatedPrincipal,
} from '@sim/auth/principal'
import type { VerifiedInternalDelegation } from '@/lib/auth/internal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  resolveActiveWorkflowApplicationContext,
  resolveActiveWorkflowRunApplicationContext,
} from '@/lib/workflows/application/context'
import {
  loadDeployedWorkflowState,
  NoActiveDeploymentError,
} from '@/lib/workflows/persistence/utils'

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

  let context
  try {
    context = claims.executionId
      ? await resolveActiveWorkflowRunApplicationContext({
          runId: claims.executionId,
          assertedWorkflowId: claims.workflowId,
        })
      : await resolveActiveWorkflowApplicationContext({ workflowId: claims.workflowId })
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') {
      throw new InvalidInternalDelegationBindingError()
    }
    throw error
  }

  if (claims.currentWorkflow) {
    let currentContext: Awaited<ReturnType<typeof resolveActiveWorkflowApplicationContext>>
    try {
      currentContext = await resolveActiveWorkflowApplicationContext({
        workflowId: claims.currentWorkflow.workflowId,
      })
    } catch (error) {
      if (asOrchestrationError(error)?.code === 'not_found') {
        throw new InvalidInternalDelegationBindingError()
      }
      throw error
    }
    if (currentContext.workspaceId !== context.workspaceId) {
      throw new InvalidInternalDelegationBindingError()
    }
    if (claims.currentWorkflow.mode === 'deployment') {
      try {
        const deployed = await loadDeployedWorkflowState(claims.currentWorkflow.workflowId)
        if (deployed.deploymentVersionId !== claims.currentWorkflow.deploymentVersionId) {
          throw new InvalidInternalDelegationBindingError()
        }
      } catch (error) {
        if (error instanceof NoActiveDeploymentError) {
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
