import {
  type Principal,
  resolvePrincipalSubject,
  type WorkflowExecutionAuthority,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import type {
  WorkspaceAuthorizationContext,
  WorkspaceDelegationPolicy,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  evaluateCredentialGroupWorkflowAccess,
} from '@/lib/credential-groups/application/workflow-access-policy'
import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { loadCredentialGroupEnrollmentAccessForSubject } from '@/lib/credential-groups/credentials'
import type { ResourcePolicyBindingFor } from '@/lib/resource-policies/registry'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

export const CREDENTIAL_GROUP_DELEGATION_AUDIENCE = 'sim:credential-groups'

export interface CredentialGroupAuthorizationContext extends WorkspaceAuthorizationContext {
  credentialGroupId: string
}

export interface CredentialGroupApplicationContext
  extends CredentialGroupAuthorizationContext,
    CredentialGroupCredentialListContext {}

function requireWorkflowExecutionPrincipal(principal: Principal): WorkflowExecutionPrincipal {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    throw new Error('Credential Group use requires an executor delegation')
  }
  const executionPrincipal = principal.delegationContext?.principal
  if (!executionPrincipal) {
    throw new Error('Executor delegation is missing its workflow principal')
  }
  return executionPrincipal
}

function requireCurrentWorkflow(principal: Principal): WorkflowExecutionAuthority {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    throw new Error('Credential Group use requires an executor delegation')
  }
  const currentWorkflow = principal.delegationContext?.currentWorkflow
  if (!currentWorkflow) {
    throw new Error('Executor delegation is missing its current workflow authority')
  }
  return currentWorkflow
}

function requireConsistentWorkflowSubject(
  principal: Principal,
  executionPrincipal: WorkflowExecutionPrincipal
) {
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') {
    throw new Error('Credential Group use requires an executor delegation')
  }
  const subject = resolvePrincipalSubject(executionPrincipal)
  if (
    (subject?.kind === 'sim_user' && principal.subjectUserId !== subject.userId) ||
    (subject?.kind !== 'sim_user' && principal.subjectUserId !== undefined)
  ) {
    throw new OrchestrationError('forbidden', 'Credential Group actor access required')
  }
  return subject
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
  context: CredentialGroupAuthorizationContext & { credentialGroupEnrollmentId: string },
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  const executionPrincipal = requireWorkflowExecutionPrincipal(principal)
  const currentWorkflow = requireCurrentWorkflow(principal)
  const subject = requireConsistentWorkflowSubject(principal, executionPrincipal)
  const policy = await requireResourcePolicy({
    workspaceId: context.workspaceId,
    resourceType: 'credential_group',
    resourceId: context.credentialGroupId,
    codec: credentialGroupWorkflowAccessPolicyCodec,
  })
  const actorAccess = subject
    ? await loadCredentialGroupEnrollmentAccessForSubject(context.credentialGroupId, subject)
    : null
  const decision = evaluateCredentialGroupWorkflowAccess({
    document: policy.document,
    credentialGroupId: context.credentialGroupId,
    selectedEnrollmentId: context.credentialGroupEnrollmentId,
    ...(actorAccess ? { actorEnrollmentId: actorAccess.enrollmentId } : {}),
    currentWorkflow,
    resourcePolicy,
  })
  if (decision.decision !== 'allow') {
    throw new OrchestrationError('forbidden', 'Credential Group credential access denied')
  }
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
