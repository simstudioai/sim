import {
  type Principal,
  type PrincipalSubject,
  requirePrincipalExecutionMetadata,
  resolvePrincipalSubject,
  type WorkflowExecutionAuthority,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  evaluateCredentialGroupWorkflowAccess,
} from '@/lib/credential-groups/application/workflow-access-policy'
import type { CredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { loadCredentialGroupEnrollmentAccessForSubject } from '@/lib/credential-groups/credentials'
import type { ResourcePolicyBindingFor } from '@/lib/resource-policies/registry'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

export interface CredentialGroupAuthorizationContext extends WorkspaceAuthorizationContext {
  credentialGroupId: string
}

export interface CredentialGroupApplicationContext
  extends CredentialGroupAuthorizationContext,
    CredentialGroupCredentialListContext {}

function requireWorkflowExecutionPrincipal(principal: Principal): WorkflowExecutionPrincipal {
  if (principal.kind === 'credential_group_enrollment') {
    throw new Error('Credential Group use requires a workflow execution principal')
  }
  requirePrincipalExecutionMetadata(principal)
  return principal
}

function requireCurrentWorkflow(principal: Principal): WorkflowExecutionAuthority {
  return requirePrincipalExecutionMetadata(principal).currentWorkflow
}

function requireConsistentWorkflowSubject(executionPrincipal: WorkflowExecutionPrincipal) {
  const subject = resolvePrincipalSubject(executionPrincipal)
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
  return requireConsistentWorkflowSubject(requireWorkflowExecutionPrincipal(principal))
}

export async function requireCredentialGroupCredentialAccess(
  principal: Principal,
  context: CredentialGroupAuthorizationContext & { credentialGroupEnrollmentId: string },
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  const executionPrincipal = requireWorkflowExecutionPrincipal(principal)
  const currentWorkflow = requireCurrentWorkflow(principal)
  const subject = requireConsistentWorkflowSubject(executionPrincipal)
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
