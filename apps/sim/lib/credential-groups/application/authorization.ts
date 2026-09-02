import {
  type Principal,
  type PrincipalSubject,
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
  evaluateCredentialGroupActorCredentialAccess,
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

/**
 * Asserts the delegation still names the subject its run was minted for, without
 * requiring that subject to be a Sim user.
 *
 * A Slack-triggered run's subject is the external Slack user, and a scheduled,
 * public-API, or subject-less webhook run has no subject at all. Neither is
 * representable as a Sim user, and neither is what authorizes the call — for an
 * actorless caller that is the deployment the workspace layer already checked.
 * Whoever the run acts as is attribution only; an invitation issued with no Sim
 * user simply records none.
 */
export function requireCredentialGroupWorkflowActor(principal: Principal): PrincipalSubject | null {
  return requireConsistentWorkflowSubject(principal, requireWorkflowExecutionPrincipal(principal))
}

/**
 * Authorizes a person using their own Credential Group credential from Chat.
 * The copilot delegation names the signed-in user and no workflow, so only the
 * actor statement is evaluated: the credential must be the one collected under
 * that user's own live enrollment. Nothing the model passes can widen this;
 * the acting user is the delegation's subject, not a tool argument.
 */
async function requireCredentialGroupActorCredentialAccess(
  principal: Extract<Principal, { kind: 'delegated' }>,
  context: CredentialGroupAuthorizationContext & { credentialGroupEnrollmentId: string },
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind !== 'sim_user' || !subject.userId) {
    throw new OrchestrationError('forbidden', 'Credential Group actor access required')
  }
  const [policy, actorAccess] = await Promise.all([
    requireResourcePolicy({
      workspaceId: context.workspaceId,
      resourceType: 'credential_group',
      resourceId: context.credentialGroupId,
      codec: credentialGroupWorkflowAccessPolicyCodec,
    }),
    loadCredentialGroupEnrollmentAccessForSubject(context.credentialGroupId, subject),
  ])
  if (!actorAccess) {
    throw new OrchestrationError('forbidden', 'Credential Group credential access denied')
  }
  const decision = evaluateCredentialGroupActorCredentialAccess({
    document: policy.document,
    credentialGroupId: context.credentialGroupId,
    selectedEnrollmentId: context.credentialGroupEnrollmentId,
    actorEnrollmentId: actorAccess.enrollmentId,
    resourcePolicy,
  })
  if (decision.decision !== 'allow') {
    throw new OrchestrationError('forbidden', 'Credential Group credential access denied')
  }
}

export async function requireCredentialGroupCredentialAccess(
  principal: Principal,
  context: CredentialGroupAuthorizationContext & { credentialGroupEnrollmentId: string },
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  if (principal.kind === 'delegated' && principal.serviceId === 'copilot') {
    return requireCredentialGroupActorCredentialAccess(principal, context, resourcePolicy)
  }
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
