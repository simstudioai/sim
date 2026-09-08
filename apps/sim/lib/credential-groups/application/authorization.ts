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
import { requireOrganizationAccountsWorkspaceAccess } from '@/lib/credential-groups/application/organization-workspace-access'
import {
  credentialGroupWorkflowAccessPolicyCodec,
  evaluateCredentialGroupActorCredentialAccess,
} from '@/lib/credential-groups/application/workflow-access-policy'
import type {
  CredentialGroupCredentialListContext,
  ManagedCredentialGroupBinding,
} from '@/lib/credential-groups/credentials'
import {
  isManagedCredentialGroupBindingLive,
  loadCredentialGroupEnrollmentAccessForSubject,
  loadManagedCredentialGroupBinding,
} from '@/lib/credential-groups/credentials'
import type { ResourcePolicyBindingFor } from '@/lib/resource-policies/registry'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

export const CREDENTIAL_GROUP_DELEGATION_AUDIENCE = 'sim:credential-groups'

export const workspaceAccountsSettingsDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (principal: Extract<Principal, { kind: 'delegated' }>) =>
    typeof principal.subjectUserId === 'string' &&
    principal.subjectUserId.trim().length > 0 &&
    Object.keys(principal.resourceScope ?? {}).every(
      (key) => key === 'chatId' || key === 'executionId'
    ),
} satisfies WorkspaceDelegationPolicy<WorkspaceAuthorizationContext>

export interface CredentialGroupAuthorizationContext extends WorkspaceAuthorizationContext {
  credentialGroupId: string
  organizationId?: string
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
  requireCurrentWorkflow(principal)
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
  binding: ManagedCredentialGroupBinding | null,
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  const subject = resolvePrincipalSubject(principal)
  if (subject?.kind !== 'sim_user' || !subject.userId) {
    throw new OrchestrationError('forbidden', 'Credential Group actor access required')
  }
  /** Chat mints OAuth credentials only; a credential with no OAuth binding is not its to use. */
  if (!binding) {
    throw new OrchestrationError('forbidden', 'Credential Group credential access denied')
  }
  if (context.organizationId) {
    const actorAccess = await loadCredentialGroupEnrollmentAccessForSubject(
      context.credentialGroupId,
      subject
    )
    if (actorAccess?.enrollmentId !== context.credentialGroupEnrollmentId) {
      throw new OrchestrationError(
        'forbidden',
        'Only your own organization connections can be used in Chat'
      )
    }
    return
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
  context: CredentialGroupAuthorizationContext & {
    credentialId: string
    credentialGroupEnrollmentId: string
  },
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
): Promise<void> {
  /**
   * A managed OAuth credential is usable only while its credential, enrollment,
   * option, and group are all live, whoever is using it: an admin disabling the
   * group or option denies the next mint from a workflow and from Chat alike. A
   * managed MCP credential has no OAuth binding row and keeps its own checks.
   */
  const binding = await loadManagedCredentialGroupBinding(context.credentialId)
  if (binding && !isManagedCredentialGroupBindingLive(binding)) {
    throw new OrchestrationError('forbidden', 'Credential Group credential access denied')
  }
  if (principal.kind === 'delegated' && principal.serviceId === 'copilot') {
    return requireCredentialGroupActorCredentialAccess(principal, context, binding, resourcePolicy)
  }
  requireCredentialGroupWorkflowActor(principal)
  requireCurrentWorkflow(principal)
  if (!context.organizationId) {
    throw new OrchestrationError(
      'forbidden',
      'Reconnect this account in organization settings and replace the legacy Connected Accounts block'
    )
  }
  await requireOrganizationAccountsWorkspaceAccess({
    ...context,
    organizationId: context.organizationId,
  })
}

export const credentialGroupDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (principal: Extract<Principal, { kind: 'delegated' }>) =>
    principal.resourceScope === undefined,
} satisfies WorkspaceDelegationPolicy<CredentialGroupApplicationContext>
