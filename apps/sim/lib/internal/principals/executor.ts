import { type DelegatedPrincipal, resolvePrincipalSubject } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { bindInternalExecutorDelegation } from '@/lib/auth/internal-delegation'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import type { ExecutorDelegationOrigin } from '@/executor/types'

const EXECUTOR_DELEGATION_TTL_MS = 5 * 60 * 1000

export function resolveExecutorOriginSubject(origin: ExecutorDelegationOrigin): string | undefined {
  const principalSubject = origin.principal ? resolvePrincipalSubject(origin.principal) : null
  if (principalSubject?.kind === 'external_user' && origin.subjectUserId) {
    throw new Error('External workflow subjects cannot be represented as Sim users')
  }
  if (!principalSubject && origin.principal && origin.subjectUserId) {
    throw new Error('Actorless workflow principals cannot be represented as Sim users')
  }
  if (
    principalSubject?.kind === 'sim_user' &&
    origin.subjectUserId &&
    origin.subjectUserId !== principalSubject.userId
  ) {
    throw new Error('Executor subject does not match its workflow principal')
  }

  const subjectUserId =
    principalSubject?.kind === 'sim_user' ? principalSubject.userId : origin.subjectUserId
  if (!subjectUserId && !origin.principal) throw new Error('Authentication required')
  return subjectUserId
}

async function bindExecutorPrincipal(
  origin: ExecutorDelegationOrigin,
  audience: string,
  resourceScope?: DelegatedPrincipal['resourceScope'],
  expiresAt?: Date
) {
  if (!origin.workflowId.trim()) throw new Error('Authentication required')
  const subjectUserId = resolveExecutorOriginSubject(origin)
  const issuedAt = new Date()
  return bindInternalExecutorDelegation(
    {
      serviceId: 'executor',
      ...(subjectUserId ? { subjectUserId } : {}),
      workflowId: origin.workflowId,
      ...(origin.executionId ? { executionId: origin.executionId } : {}),
      ...(origin.principal ? { principal: origin.principal } : {}),
      ...(origin.currentWorkflow ? { currentWorkflow: origin.currentWorkflow } : {}),
      delegationId: generateId(),
      issuedAt,
      expiresAt: expiresAt ?? new Date(issuedAt.getTime() + EXECUTOR_DELEGATION_TTL_MS),
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
  expiresAt?: Date
}

export async function createExecutorPrincipalFromExecutionContext({
  context,
  audience,
  resourceScope,
  expiresAt,
}: CreateExecutorPrincipalFromExecutionContextInput) {
  const origin = context.executorDelegationOrigin
  if (!origin) throw new Error('Executor delegation origin is required')
  return bindExecutorPrincipal(origin, audience, resourceScope, expiresAt)
}
