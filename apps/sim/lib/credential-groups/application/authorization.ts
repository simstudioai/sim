import {
  type Principal,
  requirePrincipalSubjectUserId,
  resolvePrincipalSubject,
  type WorkflowExecutionDelegatedPrincipal,
} from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import {
  type CredentialGroupEnrollmentAccess,
  loadCredentialGroupEnrollmentAccessForSubject,
} from '@/lib/credential-groups/credentials'

export const CREDENTIAL_GROUP_DELEGATION_AUDIENCE = 'sim:credential-groups'

export interface CredentialGroupApplicationContext
  extends WorkspaceAuthorizationContext,
    CredentialGroupCredentialListContext {
  enrollmentAccess?: CredentialGroupEnrollmentAccess
}

function requireWorkflowExecutionPrincipal(principal: Principal) {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    throw new Error('Credential Group use requires an executor delegation')
  }
  const executionPrincipal = (principal as WorkflowExecutionDelegatedPrincipal).delegationContext
    ?.principal
  if (!executionPrincipal) {
    throw new Error('Executor delegation is missing its workflow principal')
  }
  return executionPrincipal
}

export function requireCredentialGroupWorkflowSubject(principal: Principal): string {
  const executionPrincipal = requireWorkflowExecutionPrincipal(principal)
  let subjectUserId: string
  try {
    subjectUserId = requirePrincipalSubjectUserId(executionPrincipal)
  } catch {
    throw new OrchestrationError('forbidden', 'Credential Group user access required')
  }
  if (principal.kind !== 'delegated' || principal.subjectUserId !== subjectUserId) {
    throw new OrchestrationError('forbidden', 'Credential Group user access required')
  }
  return subjectUserId
}

export async function requireCredentialGroupEnrollmentAccess(
  principal: Principal,
  credentialGroupId: string
): Promise<CredentialGroupEnrollmentAccess> {
  const executionPrincipal = requireWorkflowExecutionPrincipal(principal)
  const subject = resolvePrincipalSubject(executionPrincipal)
  if (!subject) {
    throw new OrchestrationError('forbidden', 'Credential Group enrollment access required')
  }
  if (
    subject.kind === 'sim_user' &&
    (principal.kind !== 'delegated' || principal.subjectUserId !== subject.userId)
  ) {
    throw new OrchestrationError('forbidden', 'Credential Group enrollment access required')
  }
  const access = await loadCredentialGroupEnrollmentAccessForSubject(credentialGroupId, subject)
  if (!access) {
    throw new OrchestrationError('forbidden', 'Credential Group enrollment access required')
  }
  return access
}

export const credentialGroupDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: CredentialGroupApplicationContext
  ) => principal.resourceScope?.credentialGroupId === context.credentialGroupId,
} satisfies WorkspaceDelegationPolicy<CredentialGroupApplicationContext>

export const credentialGroupWorkspaceDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (principal: Extract<Principal, { kind: 'delegated' }>) =>
    principal.resourceScope?.credentialGroupId === undefined,
} satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>
