import {
  type BoundWorkflowExecutionPrincipal,
  requirePrincipalExecutionMetadata,
  resolvePrincipalSubject,
  withPrincipalExecutionActor,
} from '@sim/auth/principal'
import type { VerifiedInternalDelegation } from '@/lib/auth/internal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  resolveActiveWorkflowApplicationContext,
  resolveActiveWorkflowDeploymentVersionApplicationContext,
  resolveActiveWorkflowExecutionApplicationContext,
} from '@/lib/workflows/application/context'

export interface BindInternalExecutorDelegationOptions {
  compatibilityActorUserId?: string
}

export interface BoundRuntimeWorkflowExecution {
  principal: BoundWorkflowExecutionPrincipal
  workspaceId: string
}

export class InvalidInternalDelegationBindingError extends Error {
  constructor() {
    super('Internal delegation no longer resolves to an active workflow execution')
    this.name = 'InvalidInternalDelegationBindingError'
  }
}

function requireCanonicalPrincipalScope(
  principal: BoundWorkflowExecutionPrincipal,
  workspaceId: string,
  rootWorkflowId: string
): void {
  if (
    (principal.kind === 'workspace_api_key' ||
      principal.kind === 'system' ||
      principal.kind === 'delegated') &&
    principal.workspaceId !== workspaceId
  ) {
    throw new InvalidInternalDelegationBindingError()
  }
  if (principal.kind === 'system' && principal.workflowId !== rootWorkflowId) {
    throw new InvalidInternalDelegationBindingError()
  }
}

/** Revalidates execution authority and returns its principal and canonical workspace. */
export async function bindRuntimeWorkflowExecution(
  principal: BoundWorkflowExecutionPrincipal,
  options: BindInternalExecutorDelegationOptions = {}
): Promise<BoundRuntimeWorkflowExecution> {
  if (options.compatibilityActorUserId !== undefined && !options.compatibilityActorUserId.trim()) {
    throw new Error('Internal delegation execution actor must not be empty')
  }
  const executionMetadata = requirePrincipalExecutionMetadata(principal)
  const subject = resolvePrincipalSubject(principal)
  if (subject && options.compatibilityActorUserId !== undefined) {
    throw new Error('Internal delegation cannot bind a compatibility actor to a subject')
  }

  let workspaceId: string
  try {
    const rootContext = await resolveActiveWorkflowExecutionApplicationContext({
      runId: executionMetadata.executionId,
      assertedWorkflowId: executionMetadata.rootWorkflowId,
    })
    requireCanonicalPrincipalScope(
      principal,
      rootContext.workspaceId,
      executionMetadata.rootWorkflowId
    )
    workspaceId = rootContext.workspaceId

    const currentWorkflow = executionMetadata.currentWorkflow
    if (currentWorkflow.workflowId === executionMetadata.rootWorkflowId) {
      const matchesRootAuthority =
        currentWorkflow.mode === 'draft'
          ? rootContext.deploymentVersionId === null
          : rootContext.deploymentVersionId === currentWorkflow.deploymentVersionId
      if (!matchesRootAuthority) throw new InvalidInternalDelegationBindingError()
    } else if (currentWorkflow.mode === 'deployment') {
      await resolveActiveWorkflowDeploymentVersionApplicationContext({
        workflowId: currentWorkflow.workflowId,
        deploymentVersionId: currentWorkflow.deploymentVersionId,
        assertedWorkspaceId: rootContext.workspaceId,
      })
    } else {
      await resolveActiveWorkflowApplicationContext({
        workflowId: currentWorkflow.workflowId,
        assertedWorkspaceId: rootContext.workspaceId,
      })
    }
  } catch (error) {
    if (
      error instanceof InvalidInternalDelegationBindingError ||
      asOrchestrationError(error)?.code === 'not_found'
    ) {
      throw new InvalidInternalDelegationBindingError()
    }
    throw error
  }

  return {
    principal:
      options.compatibilityActorUserId !== undefined
        ? withPrincipalExecutionActor(principal, options.compatibilityActorUserId)
        : principal,
    workspaceId,
  }
}

/** Revalidates execution authority and returns the same semantic runtime principal. */
export async function bindRuntimeWorkflowExecutionPrincipal(
  principal: BoundWorkflowExecutionPrincipal,
  options: BindInternalExecutorDelegationOptions = {}
): Promise<BoundWorkflowExecutionPrincipal> {
  return (await bindRuntimeWorkflowExecution(principal, options)).principal
}

/** Revalidates the runtime principal admitted by an internal executor token. */
export function bindInternalExecutorDelegation(
  claims: VerifiedInternalDelegation,
  options: BindInternalExecutorDelegationOptions = {}
): Promise<BoundWorkflowExecutionPrincipal> {
  return bindRuntimeWorkflowExecutionPrincipal(claims.principal, options)
}

/** Revalidates JWT admission while retaining canonical transport workspace scope. */
export function bindInternalExecutorDelegationAdmission(
  claims: VerifiedInternalDelegation
): Promise<BoundRuntimeWorkflowExecution> {
  return bindRuntimeWorkflowExecution(claims.principal)
}
