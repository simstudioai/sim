import type { DelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { bindInternalExecutorDelegation } from '@/lib/auth/internal-delegation'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'

const EXECUTOR_DELEGATION_TTL_MS = 5 * 60 * 1000

export interface CreateExecutorPrincipalInput {
  userId: string
  workflowId: string
  executionId?: string
  audience: string
  resourceScope?: DelegatedPrincipal['resourceScope']
}

export async function createExecutorPrincipal({
  userId,
  workflowId,
  executionId,
  audience,
  resourceScope,
}: CreateExecutorPrincipalInput) {
  const issuedAt = new Date()
  return bindInternalExecutorDelegation(
    {
      serviceId: 'executor',
      subjectUserId: userId,
      workflowId,
      ...(executionId ? { executionId } : {}),
      delegationId: generateId(),
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + EXECUTOR_DELEGATION_TTL_MS),
    },
    {
      audience,
      ...(resourceScope ? { resourceScope } : {}),
    }
  )
}

export interface CreateExecutorPrincipalFromExecutionContextInput {
  context: InternalToolOperationContext
  audience: string
  resourceScope?: DelegatedPrincipal['resourceScope']
}

export async function createExecutorPrincipalFromExecutionContext({
  context,
  audience,
  resourceScope,
}: CreateExecutorPrincipalFromExecutionContextInput) {
  const origin = context.executorDelegationOrigin ?? {
    subjectUserId: context.userId,
    workflowId: context.workflowId,
    executionId: context.executionId,
  }
  if (!origin.subjectUserId || !origin.workflowId) throw new Error('Authentication required')

  return createExecutorPrincipal({
    userId: origin.subjectUserId,
    workflowId: origin.workflowId,
    ...(origin.executionId ? { executionId: origin.executionId } : {}),
    audience,
    ...(resourceScope ? { resourceScope } : {}),
  })
}
