export type Principal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | OAuthAccessTokenPrincipal
  | WorkspaceApiKeyPrincipal
  | DelegatedPrincipal
  | SystemPrincipal
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

/**
 * A person acting through an OAuth access token a registered client obtained
 * with their consent. The same authorization class as a personal API key — a
 * human subject, governed by their permission group and by the workspace's
 * personal-key policy — narrowed by `scopes` and bounded by `expiresAt`.
 */
export interface OAuthAccessTokenPrincipal {
  kind: 'oauth_access_token'
  userId: string
  clientId: string
  /** The `oauth_access_token` row id, never the token itself. */
  tokenId: string
  scopes: readonly string[]
  expiresAt: Date
}

export interface WorkspaceApiKeyPrincipal {
  kind: 'workspace_api_key'
  workspaceId: string
  keyId: string
}

export interface ExternalUserSubject {
  kind: 'external_user'
  provider: string
  tenantId: string
  subjectId: string
}

/** Email address proven by a deployment's OTP or SSO authentication gate. */
export interface AuthenticatedEmailSubject {
  kind: 'authenticated_email'
  email: string
}

interface ActorlessSystemPrincipal {
  kind: 'system'
  serviceId: 'public_api' | 'schedule' | 'internal' | 'table'
  workspaceId: string
  workflowId: string
}

export interface ChatSystemPrincipal {
  kind: 'system'
  serviceId: 'chat'
  workspaceId: string
  workflowId: string
  subject?: AuthenticatedEmailSubject
}

export interface WebhookSystemPrincipal {
  kind: 'system'
  serviceId: 'webhook'
  workspaceId: string
  workflowId: string
  webhookId: string
  provider: string
  subject?: ExternalUserSubject
}

export type SystemPrincipal =
  | ActorlessSystemPrincipal
  | ChatSystemPrincipal
  | WebhookSystemPrincipal

interface DelegatedPrincipalBase {
  kind: 'delegated'
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
    mcpServerId?: string
  }
}

export interface SubjectDelegatedPrincipal extends DelegatedPrincipalBase {
  serviceId: 'copilot' | 'realtime'
  subjectUserId: string
}

export interface WorkflowExecutionDelegationContext {
  kind: 'workflow_execution'
  workflowId: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
  currentWorkflow?: WorkflowExecutionAuthority
  /**
   * The trusted Sim user ID legacy executor routes ran as before principal wiring.
   *
   * This is compatibility policy, not the authenticated subject: workspace
   * authorization and audit identity continue to use the principal itself.
   */
  compatibilityActor?: {
    kind: 'legacy_execution_user'
    userId: string
  }
}

export type WorkflowExecutionAuthority =
  | { workflowId: string; mode: 'draft' }
  | { workflowId: string; mode: 'deployment'; deploymentVersionId: string }

export interface WorkflowExecutionDelegatedPrincipal extends DelegatedPrincipalBase {
  serviceId: 'executor'
  subjectUserId?: string
  delegationContext?: WorkflowExecutionDelegationContext
}

export type BoundWorkflowExecutionDelegatedPrincipal = WorkflowExecutionDelegatedPrincipal & {
  delegationContext: WorkflowExecutionDelegationContext
}

export type DelegatedPrincipal = SubjectDelegatedPrincipal | WorkflowExecutionDelegatedPrincipal

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

/**
 * A person reaching the API through a bearer credential of their own — a
 * personal API key or an OAuth access token. The two are one authorization
 * class, so a surface that distinguishes "a user is here" from "a workspace
 * or service is here" asks this rather than naming either kind.
 */
export function isUserCredentialPrincipal(
  principal: Principal
): principal is PersonalApiKeyPrincipal | OAuthAccessTokenPrincipal {
  return principal.kind === 'personal_api_key' || principal.kind === 'oauth_access_token'
}

export class PrincipalSubjectUserRequiredError extends Error {
  constructor(principalKind: Principal['kind']) {
    super(`Principal kind ${principalKind} does not represent a human subject`)
    this.name = 'PrincipalSubjectUserRequiredError'
  }
}

/**
 * The Sim user a principal represents, or `undefined` when it represents none.
 *
 * Actorless callers are ordinary, not exceptional: a scheduled or webhook run, a
 * workspace API key, and a Credential Group enrollment all act with real authority
 * and no human behind them. Use this wherever the user is attribution — a name to
 * record a read or write under — and {@link requirePrincipalSubjectUserId} only
 * where the operation's meaning genuinely collapses without one, so that choice is
 * visible at the call site instead of hidden in a ternary.
 */
export function resolvePrincipalSubjectUserId(principal: Principal): string | undefined {
  const subject = resolvePrincipalSubject(principal)
  return subject?.kind === 'sim_user' ? subject.userId : undefined
}

/** Resolves the real human subject represented by a principal or fails fast. */
export function requirePrincipalSubjectUserId(principal: Principal): string {
  const userId = resolvePrincipalSubjectUserId(principal)
  if (userId !== undefined) return userId
  throw new PrincipalSubjectUserRequiredError(principal.kind)
}

/**
 * Resolves the principal's Sim user subject or its principal-bound legacy
 * execution actor.
 *
 * Only operations that deliberately preserve pre-principal executor behavior
 * should use this helper. It never changes the principal subject, workspace
 * authorization, or audit actor.
 */
export function resolvePrincipalExecutionActorUserId(principal: Principal): string | undefined {
  const subjectUserId = resolvePrincipalSubjectUserId(principal)
  if (subjectUserId) return subjectUserId
  if (principal.kind !== 'delegated' || principal.serviceId !== 'executor') return undefined
  if (principal.delegationContext?.currentWorkflow?.mode !== 'deployment') return undefined
  return principal.delegationContext?.compatibilityActor?.userId
}

export type WorkflowExecutionPrincipal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | OAuthAccessTokenPrincipal
  | WorkspaceApiKeyPrincipal
  | SubjectDelegatedPrincipal
  | SystemPrincipal

type SerializedWorkflowExecutionPrincipal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | (Omit<OAuthAccessTokenPrincipal, 'expiresAt'> & { expiresAt: string })
  | WorkspaceApiKeyPrincipal
  | SystemPrincipal
  | (Omit<SubjectDelegatedPrincipal, 'issuedAt' | 'expiresAt'> & {
      issuedAt: string
      expiresAt: string
    })

export interface SerializedPrincipalV1 {
  version: 1
  principal: SerializedWorkflowExecutionPrincipal
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional])
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`Serialized principal is missing ${key}`)
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Serialized principal contains unsupported field ${key}`)
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Serialized principal ${field} must be a non-empty string`)
  }
  return value
}

function requireDate(value: unknown, field: string): Date {
  const serialized = requireString(value, field)
  const date = new Date(serialized)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== serialized) {
    throw new Error(`Serialized principal ${field} must be an ISO timestamp`)
  }
  return date
}

function parseResourceScope(value: unknown): DelegatedPrincipal['resourceScope'] {
  const scope = requireRecord(value, 'Serialized principal resourceScope')
  const keys = [
    'fileId',
    'tableId',
    'chatId',
    'executionId',
    'credentialId',
    'credentialGroupId',
    'mcpServerId',
  ] as const
  requireExactKeys(scope, [], keys)
  const parsed: NonNullable<DelegatedPrincipal['resourceScope']> = {}
  for (const key of keys) {
    if (scope[key] !== undefined) parsed[key] = requireString(scope[key], key)
  }
  return parsed
}

function parseExternalUserSubject(value: unknown): ExternalUserSubject {
  const subject = requireRecord(value, 'Serialized principal subject')
  requireExactKeys(subject, ['kind', 'provider', 'tenantId', 'subjectId'])
  if (subject.kind !== 'external_user') {
    throw new Error(`Unsupported serialized principal subject kind ${String(subject.kind)}`)
  }
  return {
    kind: 'external_user',
    provider: requireString(subject.provider, 'subject.provider'),
    tenantId: requireString(subject.tenantId, 'subject.tenantId'),
    subjectId: requireString(subject.subjectId, 'subject.subjectId'),
  }
}

function parseAuthenticatedEmailSubject(value: unknown): AuthenticatedEmailSubject {
  const subject = requireRecord(value, 'Serialized principal subject')
  if (subject.kind !== 'authenticated_email') {
    throw new Error(`Unsupported serialized principal subject kind ${String(subject.kind)}`)
  }
  requireExactKeys(subject, ['kind', 'email'])
  return {
    kind: 'authenticated_email',
    email: requireString(subject.email, 'subject.email'),
  }
}

/** Encodes a workflow caller without persisting bearer credentials or invitation proofs. */
export function serializePrincipal(principal: WorkflowExecutionPrincipal): SerializedPrincipalV1 {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'workspace_api_key':
      return { version: 1, principal: { ...principal } }
    case 'oauth_access_token':
      return {
        version: 1,
        principal: {
          ...principal,
          scopes: [...principal.scopes],
          expiresAt: principal.expiresAt.toISOString(),
        },
      }
    case 'system':
      if (principal.serviceId === 'webhook') {
        if (principal.subject && principal.subject.provider !== principal.provider) {
          throw new Error('Webhook system principal subject provider must match its provider')
        }
      }
      return { version: 1, principal: { ...principal } }
    case 'delegated':
      return {
        version: 1,
        principal: {
          ...principal,
          issuedAt: principal.issuedAt.toISOString(),
          expiresAt: principal.expiresAt.toISOString(),
        },
      }
  }
}

/** Strictly validates a persisted workflow caller and restores delegated-principal dates. */
export function parsePrincipal(value: unknown): WorkflowExecutionPrincipal {
  const envelope = requireRecord(value, 'Serialized principal')
  requireExactKeys(envelope, ['version', 'principal'])
  if (envelope.version !== 1) throw new Error('Unsupported serialized principal version')

  const principal = requireRecord(envelope.principal, 'Serialized principal value')
  const kind = requireString(principal.kind, 'kind')
  switch (kind) {
    case 'session':
      requireExactKeys(principal, ['kind', 'userId', 'sessionId'])
      return {
        kind,
        userId: requireString(principal.userId, 'userId'),
        sessionId: requireString(principal.sessionId, 'sessionId'),
      }
    case 'personal_api_key':
      requireExactKeys(principal, ['kind', 'userId', 'keyId'])
      return {
        kind,
        userId: requireString(principal.userId, 'userId'),
        keyId: requireString(principal.keyId, 'keyId'),
      }
    case 'workspace_api_key':
      requireExactKeys(principal, ['kind', 'workspaceId', 'keyId'])
      return {
        kind,
        workspaceId: requireString(principal.workspaceId, 'workspaceId'),
        keyId: requireString(principal.keyId, 'keyId'),
      }
    case 'oauth_access_token': {
      requireExactKeys(principal, ['kind', 'userId', 'clientId', 'tokenId', 'scopes', 'expiresAt'])
      if (!Array.isArray(principal.scopes)) {
        throw new Error('Serialized principal scopes must be an array')
      }
      return {
        kind,
        userId: requireString(principal.userId, 'userId'),
        clientId: requireString(principal.clientId, 'clientId'),
        tokenId: requireString(principal.tokenId, 'tokenId'),
        scopes: principal.scopes.map((scope, index) => requireString(scope, `scopes[${index}]`)),
        expiresAt: requireDate(principal.expiresAt, 'expiresAt'),
      }
    }
    case 'system': {
      requireExactKeys(
        principal,
        ['kind', 'serviceId', 'workspaceId', 'workflowId'],
        ['webhookId', 'provider', 'subject']
      )
      const serviceId = requireString(principal.serviceId, 'serviceId')
      if (!['public_api', 'schedule', 'webhook', 'internal', 'table', 'chat'].includes(serviceId)) {
        throw new Error(`Unsupported system principal service ${serviceId}`)
      }
      const webhookId =
        principal.webhookId === undefined
          ? undefined
          : requireString(principal.webhookId, 'webhookId')
      const provider =
        principal.provider === undefined ? undefined : requireString(principal.provider, 'provider')
      if (serviceId === 'webhook') {
        if (!webhookId || !provider) {
          throw new Error('Webhook system principals require webhookId and provider')
        }
        const subject =
          principal.subject === undefined ? undefined : parseExternalUserSubject(principal.subject)
        if (subject && subject.provider !== provider) {
          throw new Error('Webhook system principal subject provider must match its provider')
        }
        return {
          kind,
          serviceId,
          workspaceId: requireString(principal.workspaceId, 'workspaceId'),
          workflowId: requireString(principal.workflowId, 'workflowId'),
          webhookId,
          provider,
          ...(subject ? { subject } : {}),
        }
      }
      if (serviceId === 'chat') {
        if (webhookId || provider) {
          throw new Error('Chat system principals cannot carry webhook identity')
        }
        const subject =
          principal.subject === undefined
            ? undefined
            : parseAuthenticatedEmailSubject(principal.subject)
        return {
          kind,
          serviceId,
          workspaceId: requireString(principal.workspaceId, 'workspaceId'),
          workflowId: requireString(principal.workflowId, 'workflowId'),
          ...(subject ? { subject } : {}),
        }
      }
      if (webhookId || provider || principal.subject !== undefined) {
        throw new Error(
          `System principal service ${serviceId} cannot carry a subject or webhook identity`
        )
      }
      return {
        kind,
        serviceId: serviceId as ActorlessSystemPrincipal['serviceId'],
        workspaceId: requireString(principal.workspaceId, 'workspaceId'),
        workflowId: requireString(principal.workflowId, 'workflowId'),
      }
    }
    case 'delegated': {
      requireExactKeys(
        principal,
        [
          'kind',
          'serviceId',
          'subjectUserId',
          'workspaceId',
          'delegationId',
          'audience',
          'issuedAt',
          'expiresAt',
        ],
        ['resourceScope']
      )
      const serviceId = requireString(principal.serviceId, 'serviceId')
      if (!['copilot', 'realtime'].includes(serviceId)) {
        throw new Error(`Unsupported delegated principal service ${serviceId}`)
      }
      return {
        kind,
        serviceId: serviceId as SubjectDelegatedPrincipal['serviceId'],
        subjectUserId: requireString(principal.subjectUserId, 'subjectUserId'),
        workspaceId: requireString(principal.workspaceId, 'workspaceId'),
        delegationId: requireString(principal.delegationId, 'delegationId'),
        audience: requireString(principal.audience, 'audience'),
        issuedAt: requireDate(principal.issuedAt, 'issuedAt'),
        expiresAt: requireDate(principal.expiresAt, 'expiresAt'),
        ...(principal.resourceScope === undefined
          ? {}
          : { resourceScope: parseResourceScope(principal.resourceScope) }),
      }
    }
    case 'credential_group_enrollment':
      throw new Error('Credential Group enrollment principals cannot be persisted for execution')
    default:
      throw new Error(`Unsupported serialized principal kind ${kind}`)
  }
}

export type PrincipalActor =
  | { kind: 'session'; userId: string }
  | { kind: 'personal_api_key'; keyId: string; userId: string }
  | { kind: 'oauth_access_token'; tokenId: string; clientId: string; userId: string }
  | { kind: 'workspace_api_key'; keyId: string; workspaceId: string }
  | {
      kind: 'system'
      serviceId: SystemPrincipal['serviceId']
      workspaceId: string
      workflowId: string
      webhookId?: string
      provider?: string
      subject?: ExternalUserSubject | AuthenticatedEmailSubject
    }
  | {
      kind: 'delegated'
      serviceId: DelegatedPrincipal['serviceId']
      subjectUserId?: string
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

export type PrincipalSubject =
  | { kind: 'sim_user'; userId: string }
  | ExternalUserSubject
  | AuthenticatedEmailSubject

/** Resolves a stable human or provider subject without inventing one for actorless callers. */
export function resolvePrincipalSubject(principal: Principal): PrincipalSubject | null {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
      return { kind: 'sim_user', userId: principal.userId }
    case 'delegated':
      if (principal.serviceId !== 'executor') {
        return { kind: 'sim_user', userId: principal.subjectUserId }
      }
      if (principal.delegationContext?.principal) {
        return resolvePrincipalSubject(principal.delegationContext.principal)
      }
      return principal.subjectUserId ? { kind: 'sim_user', userId: principal.subjectUserId } : null
    case 'system':
      return principal.serviceId === 'webhook' || principal.serviceId === 'chat'
        ? (principal.subject ?? null)
        : null
    case 'workspace_api_key':
    case 'credential_group_enrollment':
      return null
  }
}

export function toPrincipalActor(principal: Principal): PrincipalActor {
  switch (principal.kind) {
    case 'session':
      return { kind: principal.kind, userId: principal.userId }
    case 'personal_api_key':
      return { kind: principal.kind, keyId: principal.keyId, userId: principal.userId }
    case 'oauth_access_token':
      return {
        kind: principal.kind,
        tokenId: principal.tokenId,
        clientId: principal.clientId,
        userId: principal.userId,
      }
    case 'workspace_api_key':
      return {
        kind: principal.kind,
        keyId: principal.keyId,
        workspaceId: principal.workspaceId,
      }
    case 'system':
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        workspaceId: principal.workspaceId,
        workflowId: principal.workflowId,
        ...(principal.serviceId === 'webhook'
          ? {
              webhookId: principal.webhookId,
              provider: principal.provider,
              ...(principal.subject ? { subject: principal.subject } : {}),
            }
          : principal.serviceId === 'chat' && principal.subject
            ? { subject: principal.subject }
            : {}),
      }
    case 'delegated':
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        ...(principal.subjectUserId ? { subjectUserId: principal.subjectUserId } : {}),
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
    case 'personal_api_key':
    case 'oauth_access_token':
      return { actor, actorId: actor.userId }
    case 'delegated':
      return actor.subjectUserId
        ? { actor, actorId: actor.subjectUserId }
        : { actor, actorId: null, actorName: 'Workflow execution' }
    case 'workspace_api_key':
      return { actor, actorId: null, actorName: 'Workspace API key' }
    case 'system':
      return { actor, actorId: null, actorName: `System: ${actor.serviceId}` }
    case 'credential_group_enrollment':
      return { actor, actorId: null, actorName: actor.email }
  }
}

/**
 * Projects an already-authorized principal into a legacy user attribution field.
 * A workspace billing owner may fill that field for actorless delegated execution,
 * but never changes the principal, audit actor, or authorization decision.
 */
export function resolvePrincipalAttribution(
  principal: Principal,
  context: PrincipalAttributionContext = {}
): PrincipalAttribution {
  const actor = toPrincipalActor(principal)

  switch (actor.kind) {
    case 'session':
    case 'personal_api_key':
    case 'oauth_access_token':
      return { actor, attributedUserId: actor.userId }
    case 'workspace_api_key': {
      const attributedUserId = context.workspaceBillingOwnerUserId
      if (!attributedUserId) {
        throw new Error('Workspace API key attribution requires a workspace billing owner')
      }
      return { actor, attributedUserId }
    }
    case 'system':
      throw new Error('System principals do not support user attribution')
    case 'delegated': {
      if (actor.subjectUserId) return { actor, attributedUserId: actor.subjectUserId }
      if (actor.serviceId !== 'executor') throw new PrincipalSubjectUserRequiredError(actor.kind)
      const attributedUserId = context.workspaceBillingOwnerUserId
      if (!attributedUserId) throw new PrincipalSubjectUserRequiredError(actor.kind)
      return { actor, attributedUserId }
    }
    case 'credential_group_enrollment':
      throw new PrincipalSubjectUserRequiredError(actor.kind)
  }
}
