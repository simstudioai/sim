export type Principal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | WorkspaceApiKeyPrincipal
  | DelegatedPrincipal
  | CredentialGroupEnrollmentPrincipal

export interface SessionPrincipal {
  kind: 'session'
  userId: string
  sessionId: string
}

export interface PersonalApiKeyPrincipal {
  kind: 'personal_api_key'
  userId: string
  keyId: string
}

export interface WorkspaceApiKeyPrincipal {
  kind: 'workspace_api_key'
  workspaceId: string
  keyId: string
}

export interface DelegatedPrincipal {
  kind: 'delegated'
  serviceId: 'copilot' | 'executor' | 'realtime'
  subjectUserId: string
  workspaceId: string
  delegationId: string
  audience: string
  issuedAt: Date
  expiresAt: Date
  resourceScope?: {
    fileId?: string
    tableId?: string
    chatId?: string
    executionId?: string
    credentialId?: string
    credentialGroupId?: string
  }
}

/** Bearer identity established by a currently valid Credential Group invitation. */
export interface CredentialGroupEnrollmentPrincipal {
  kind: 'credential_group_enrollment'
  workspaceId: string
  credentialGroupId: string
  enrollmentId: string
  email: string
  invitationTokenHash: string
}

export type DelegatedServiceId = DelegatedPrincipal['serviceId']

export class PrincipalSubjectUserRequiredError extends Error {
  constructor(principalKind: Principal['kind']) {
    super(`Principal kind ${principalKind} does not represent a human subject`)
    this.name = 'PrincipalSubjectUserRequiredError'
  }
}

/** Resolves the real human subject represented by a principal or fails fast. */
export function requirePrincipalSubjectUserId(principal: Principal): string {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
      return principal.userId
    case 'delegated':
      return principal.subjectUserId
    case 'workspace_api_key':
    case 'credential_group_enrollment':
      throw new PrincipalSubjectUserRequiredError(principal.kind)
  }
}

export interface WorkflowExecutionDelegationContext {
  kind: 'workflow_execution'
  workflowId: string
  executionId?: string
}

export type WorkflowExecutionDelegatedPrincipal = DelegatedPrincipal & {
  serviceId: 'executor'
  delegationContext: WorkflowExecutionDelegationContext
}

export type PrincipalActor =
  | { kind: 'session'; userId: string }
  | { kind: 'personal_api_key'; keyId: string; userId: string }
  | { kind: 'workspace_api_key'; keyId: string; workspaceId: string }
  | {
      kind: 'delegated'
      serviceId: DelegatedPrincipal['serviceId']
      subjectUserId: string
      delegationId: string
    }
  | {
      kind: 'credential_group_enrollment'
      workspaceId: string
      credentialGroupId: string
      enrollmentId: string
      email: string
    }

export interface PrincipalAttribution {
  actor: PrincipalActor
  attributedUserId: string
}

/**
 * The audit actor for an authenticated operation.
 *
 * `actorId` is only populated when the principal represents a real user. A
 * workspace API key is deliberately actor-less in the audit table: its key and
 * workspace identity remain available in `actor`, while `actorName` keeps the
 * row readable without pretending the billing owner performed the action.
 */
export interface PrincipalAuditAttribution {
  actor: PrincipalActor
  actorId: string | null
  actorName?: string
}

export interface PrincipalAttributionContext {
  workspaceBillingOwnerUserId?: string
}

export function toPrincipalActor(principal: Principal): PrincipalActor {
  switch (principal.kind) {
    case 'session':
      return { kind: principal.kind, userId: principal.userId }
    case 'personal_api_key':
      return { kind: principal.kind, keyId: principal.keyId, userId: principal.userId }
    case 'workspace_api_key':
      return {
        kind: principal.kind,
        keyId: principal.keyId,
        workspaceId: principal.workspaceId,
      }
    case 'delegated':
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        subjectUserId: principal.subjectUserId,
        delegationId: principal.delegationId,
      }
    case 'credential_group_enrollment':
      return {
        kind: principal.kind,
        workspaceId: principal.workspaceId,
        credentialGroupId: principal.credentialGroupId,
        enrollmentId: principal.enrollmentId,
        email: principal.email,
      }
  }
}

export function resolvePrincipalAuditAttribution(principal: Principal): PrincipalAuditAttribution {
  const actor = toPrincipalActor(principal)

  switch (actor.kind) {
    case 'session':
      return { actor, actorId: actor.userId }
    case 'personal_api_key':
      return { actor, actorId: actor.userId }
    case 'delegated':
      return { actor, actorId: actor.subjectUserId }
    case 'workspace_api_key':
      return { actor, actorId: null, actorName: 'Workspace API key' }
    case 'credential_group_enrollment':
      return { actor, actorId: null, actorName: actor.email }
  }
}

export function resolvePrincipalAttribution(
  principal: Principal,
  context: PrincipalAttributionContext = {}
): PrincipalAttribution {
  const actor = toPrincipalActor(principal)

  switch (actor.kind) {
    case 'session':
    case 'personal_api_key':
      return { actor, attributedUserId: actor.userId }
    case 'workspace_api_key': {
      const attributedUserId = context.workspaceBillingOwnerUserId
      if (!attributedUserId) {
        throw new Error('Workspace API key attribution requires a workspace billing owner')
      }
      return { actor, attributedUserId }
    }
    case 'delegated':
      return { actor, attributedUserId: actor.subjectUserId }
    case 'credential_group_enrollment':
      throw new PrincipalSubjectUserRequiredError(actor.kind)
  }
}
