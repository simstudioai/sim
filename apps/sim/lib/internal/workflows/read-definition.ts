import {
  resolvePrincipalSubject,
  type WorkflowExecutionAuthority,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { bindInternalExecutorDelegation } from '@/lib/auth/internal-delegation'
import { WORKFLOW_DELEGATION_AUDIENCE } from '@/lib/workflows/application/authorization'
import {
  type ReadWorkflowDefinitionInput,
  readWorkflowDefinition,
} from '@/lib/workflows/application/read-workflow-definition'

export interface ExecutorWorkflowDefinitionOrigin {
  subjectUserId?: string
  workflowId: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
  currentWorkflow?: WorkflowExecutionAuthority
}

export interface ReadWorkflowDefinitionAsExecutorInput {
  origin: ExecutorWorkflowDefinitionOrigin
  workflowId: string
  state: ReadWorkflowDefinitionInput['state']
}

const EXECUTOR_DELEGATION_TTL_MS = 5 * 60 * 1000

function resolveExecutorSubject(origin: ExecutorWorkflowDefinitionOrigin): string | undefined {
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
  if (!subjectUserId && !origin.principal) {
    throw new Error('Executor workflow definition read requires a workflow principal or subject')
  }
  return subjectUserId
}

async function createWorkflowDefinitionExecutorPrincipal(origin: ExecutorWorkflowDefinitionOrigin) {
  const issuedAt = new Date()
  const subjectUserId = resolveExecutorSubject(origin)
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
      expiresAt: new Date(issuedAt.getTime() + EXECUTOR_DELEGATION_TTL_MS),
    },
    { audience: WORKFLOW_DELEGATION_AUDIENCE }
  )
}

export async function readWorkflowDefinitionAsExecutor({
  origin,
  workflowId,
  state,
}: ReadWorkflowDefinitionAsExecutorInput) {
  const principal = await createWorkflowDefinitionExecutorPrincipal(origin)

  return readWorkflowDefinition.execute({
    principal,
    input: { workflowId, state },
  })
}
