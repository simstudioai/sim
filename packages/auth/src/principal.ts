export type Principal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | WorkspaceApiKeyPrincipal
  | DelegatedPrincipal

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
    chatId?: string
    executionId?: string
  }
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

export interface PrincipalAttribution {
  actor: PrincipalActor
  attributedUserId: string
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
  }
}
