import {
  type Principal,
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
import { findResourcePolicyGrant } from '@/lib/resource-policies/authorization'
import type { ResourcePolicyAction } from '@/lib/resource-policies/types'

export const CREDENTIAL_GROUP_DELEGATION_AUDIENCE = 'sim:credential-groups'

export interface CredentialGroupAuthorizationContext extends WorkspaceAuthorizationContext {
  credentialGroupId: string
}

export interface CredentialGroupApplicationContext
  extends CredentialGroupAuthorizationContext,
    CredentialGroupCredentialListContext {
  credentialAccess?: CredentialGroupCredentialAccess
}

export type CredentialGroupCredentialAccess =
  | ({ scope: 'enrollment' } & CredentialGroupEnrollmentAccess)
  | { scope: 'all'; grantId: string }

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
  const subject = resolvePrincipalSubject(requireWorkflowExecutionPrincipal(principal))
  if (
    subject?.kind !== 'sim_user' ||
    principal.kind !== 'delegated' ||
    principal.subjectUserId !== subject.userId
  ) {
    throw new OrchestrationError('forbidden', 'Credential Group user access required')
  }
  return subject.userId
}

export async function requireCredentialGroupCredentialAccess(
  principal: Principal,
  context: CredentialGroupAuthorizationContext,
  action: ResourcePolicyAction
): Promise<CredentialGroupCredentialAccess> {
  const grant = await findResourcePolicyGrant({
    principal,
    context,
    resourceType: 'credential_group',
    resourceId: context.credentialGroupId,
    action,
  })
  if (grant) return { scope: 'all', grantId: grant.id }

  const executionPrincipal = requireWorkflowExecutionPrincipal(principal)
  const subject = resolvePrincipalSubject(executionPrincipal)
  if (!subject) {
    throw new OrchestrationError('forbidden', 'Credential Group actor access required')
  }
  if (
    subject.kind === 'sim_user' &&
    (principal.kind !== 'delegated' || principal.subjectUserId !== subject.userId)
  ) {
    throw new OrchestrationError('forbidden', 'Credential Group actor access required')
  }
  const access = await loadCredentialGroupEnrollmentAccessForSubject(
    context.credentialGroupId,
    subject
  )
  if (!access) {
    throw new OrchestrationError('forbidden', 'Credential Group enrollment access required')
  }
  return { scope: 'enrollment', ...access }
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
