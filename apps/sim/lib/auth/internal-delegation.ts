import type {
  BoundWorkflowExecutionDelegatedPrincipal,
  DelegatedPrincipal,
} from '@sim/auth/principal'
import type { VerifiedInternalDelegation } from '@/lib/auth/internal'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { withDatabaseReadRetry } from '@/lib/db/read-retry'
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
  compatibilityActorUserId?: string
}

export class InvalidInternalDelegationBindingError extends Error {
  constructor() {
    super('Internal delegation no longer resolves to an active workflow execution')
    this.name = 'InvalidInternalDelegationBindingError'
  }
}

const CANONICAL_LOAD_RETRY = { label: 'internal delegation canonical load' } as const

/**
 * Binds signed executor claims to the workflow's canonical active workspace.
 *
 * Every tool call a workflow run delegates (Function, MCP, files, knowledge) binds here first, and
 * nothing above it retries. The canonical loads are independent reads, so a transient connection
 * failure such as a reset pooled socket is retried instead of failing the block.
 */
export async function bindInternalExecutorDelegation(
  claims: VerifiedInternalDelegation,
  options: BindInternalExecutorDelegationOptions
): Promise<BoundWorkflowExecutionDelegatedPrincipal> {
  if (!options.audience.trim()) throw new Error('Internal delegation audience must not be empty')
  if (options.compatibilityActorUserId !== undefined && !options.compatibilityActorUserId.trim()) {
    throw new Error('Internal delegation execution actor must not be empty')
  }
  if (claims.subjectUserId && options.compatibilityActorUserId) {
    throw new Error('Internal delegation cannot bind a compatibility actor to a user subject')
  }

  let context: ActiveWorkflowApplicationContext
  let rootDeploymentVersionId: string | null | undefined
  try {
    if (claims.currentWorkflow) {
      if (!claims.executionId) throw new InvalidInternalDelegationBindingError()
      const runId = claims.executionId
      const executionContext = await withDatabaseReadRetry(
        () =>
          resolveActiveWorkflowExecutionApplicationContext({
            runId,
            assertedWorkflowId: claims.workflowId,
          }),
        CANONICAL_LOAD_RETRY
      )
      context = executionContext
      rootDeploymentVersionId = executionContext.deploymentVersionId
    } else if (claims.executionId) {
      const runId = claims.executionId
      context = await withDatabaseReadRetry(
        () =>
          resolveActiveWorkflowRunApplicationContext({
            runId,
            assertedWorkflowId: claims.workflowId,
          }),
        CANONICAL_LOAD_RETRY
      )
    } else {
      context = await withDatabaseReadRetry(
        () => resolveActiveWorkflowApplicationContext({ workflowId: claims.workflowId }),
        CANONICAL_LOAD_RETRY
      )
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
      const currentWorkflow = claims.currentWorkflow
      const workspaceId = context.workspaceId
      try {
        const currentContext = await withDatabaseReadRetry(
          () =>
            currentWorkflow.mode === 'deployment'
              ? resolveActiveWorkflowDeploymentVersionApplicationContext({
                  workflowId: currentWorkflow.workflowId,
                  deploymentVersionId: currentWorkflow.deploymentVersionId,
                  assertedWorkspaceId: workspaceId,
                })
              : resolveActiveWorkflowApplicationContext({
                  workflowId: currentWorkflow.workflowId,
                  assertedWorkspaceId: workspaceId,
                }),
          CANONICAL_LOAD_RETRY
        )
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
      ...(options.compatibilityActorUserId
        ? {
            compatibilityActor: {
              kind: 'legacy_execution_user',
              userId: options.compatibilityActorUserId,
            } as const,
          }
        : {}),
    },
  }
}
