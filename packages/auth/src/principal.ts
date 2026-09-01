export type WorkflowExecutionAuthority =
  | { workflowId: string; mode: 'draft' }
  | { workflowId: string; mode: 'deployment'; deploymentVersionId: string }

export interface PrincipalExecutionMetadata {
  executionId: string
  rootWorkflowId: string
  currentWorkflow: WorkflowExecutionAuthority
}

interface PrincipalRuntimeMetadata {
  executionMetadata?: PrincipalExecutionMetadata
  /** Legacy user attribution for operations whose persisted model still requires one. */
  executionActor?: {
    kind: 'legacy_execution_user'
    userId: string
  }
}

export type Principal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | WorkspaceApiKeyPrincipal
  | DelegatedPrincipal
  | SystemPrincipal
  | CredentialGroupEnrollmentPrincipal

export interface SessionPrincipal extends PrincipalRuntimeMetadata {
  kind: 'session'
  userId: string
  sessionId: string
}

export interface PersonalApiKeyPrincipal extends PrincipalRuntimeMetadata {
  kind: 'personal_api_key'
  userId: string
  keyId: string
}

export interface WorkspaceApiKeyPrincipal extends PrincipalRuntimeMetadata {
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

interface ActorlessSystemPrincipal extends PrincipalRuntimeMetadata {
  kind: 'system'
  serviceId: 'public_api' | 'schedule' | 'internal' | 'table' | 'chat'
  workspaceId: string
  workflowId: string
}

export interface WebhookSystemPrincipal extends PrincipalRuntimeMetadata {
  kind: 'system'
  serviceId: 'webhook'
  workspaceId: string
  workflowId: string
  webhookId: string
  provider: string
  subject?: ExternalUserSubject
}

export type SystemPrincipal = ActorlessSystemPrincipal | WebhookSystemPrincipal

interface DelegatedPrincipalBase extends PrincipalRuntimeMetadata {
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
  }
}

export interface SubjectDelegatedPrincipal extends DelegatedPrincipalBase {
  serviceId: 'copilot' | 'realtime'
  subjectUserId: string
}

export type DelegatedPrincipal = SubjectDelegatedPrincipal

/** Bearer identity established by a currently valid Credential Group invitation. */
export interface CredentialGroupEnrollmentPrincipal extends PrincipalRuntimeMetadata {
  kind: 'credential_group_enrollment'
  workspaceId: string
  credentialGroupId: string
  enrollmentId: string
  email: string
  invitationTokenHash: string
}

export type DelegatedServiceId = DelegatedPrincipal['serviceId']

export type WorkflowExecutionPrincipal =
  | SessionPrincipal
  | PersonalApiKeyPrincipal
  | WorkspaceApiKeyPrincipal
  | SubjectDelegatedPrincipal
  | SystemPrincipal

export type BoundWorkflowExecutionPrincipal = WorkflowExecutionPrincipal & {
  executionMetadata: PrincipalExecutionMetadata
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
  if (principal.executionMetadata?.currentWorkflow.mode !== 'deployment') return undefined
  return principal.executionActor?.userId
}

type WithoutPrincipalRuntimeMetadata<T> = T extends unknown
  ? Omit<T, 'executionMetadata' | 'executionActor'>
  : never

type SerializedWorkflowExecutionPrincipal =
  | WithoutPrincipalRuntimeMetadata<SessionPrincipal>
  | WithoutPrincipalRuntimeMetadata<PersonalApiKeyPrincipal>
  | WithoutPrincipalRuntimeMetadata<WorkspaceApiKeyPrincipal>
  | WithoutPrincipalRuntimeMetadata<SystemPrincipal>
  | (Omit<
      SubjectDelegatedPrincipal,
      'executionMetadata' | 'executionActor' | 'issuedAt' | 'expiresAt'
    > & {
      issuedAt: string
      expiresAt: string
    })

export interface SerializedPrincipalV1 {
  version: 1
  principal: SerializedWorkflowExecutionPrincipal
}

export interface SerializedPrincipalV2 {
  version: 2
  principal: SerializedWorkflowExecutionPrincipal
  executionMetadata: PrincipalExecutionMetadata
}

export type SerializedPrincipal = SerializedPrincipalV1 | SerializedPrincipalV2

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

export function parseWorkflowExecutionAuthority(value: unknown): WorkflowExecutionAuthority {
  const authority = requireRecord(value, 'Principal execution metadata currentWorkflow')
  const workflowId = requireString(authority.workflowId, 'currentWorkflow.workflowId')
  if (authority.mode === 'draft') {
    requireExactKeys(authority, ['workflowId', 'mode'])
    return { workflowId, mode: 'draft' }
  }
  if (authority.mode === 'deployment') {
    requireExactKeys(authority, ['workflowId', 'mode', 'deploymentVersionId'])
    return {
      workflowId,
      mode: 'deployment',
      deploymentVersionId: requireString(
        authority.deploymentVersionId,
        'currentWorkflow.deploymentVersionId'
      ),
    }
  }
  throw new Error(`Unsupported workflow execution mode ${String(authority.mode)}`)
}

export function parsePrincipalExecutionMetadata(value: unknown): PrincipalExecutionMetadata {
  const metadata = requireRecord(value, 'Principal execution metadata')
  requireExactKeys(metadata, ['executionId', 'rootWorkflowId', 'currentWorkflow'])
  return {
    executionId: requireString(metadata.executionId, 'executionMetadata.executionId'),
    rootWorkflowId: requireString(metadata.rootWorkflowId, 'executionMetadata.rootWorkflowId'),
    currentWorkflow: parseWorkflowExecutionAuthority(metadata.currentWorkflow),
  }
}

/** Starts a root workflow run without changing the authenticated actor identity. */
export function bindPrincipalExecutionMetadata(
  principal: WorkflowExecutionPrincipal,
  metadata: PrincipalExecutionMetadata
): BoundWorkflowExecutionPrincipal {
  if (principal.executionMetadata !== undefined) {
    throw new Error('Workflow execution principal is already bound to an execution')
  }
  const parsed = parsePrincipalExecutionMetadata(metadata)
  if (parsed.currentWorkflow.workflowId !== parsed.rootWorkflowId) {
    throw new Error('Root workflow execution authority must name the root workflow')
  }
  return { ...principal, executionMetadata: parsed }
}

/** Enters a regular child workflow while preserving the root run and actor. */
export function enterPrincipalWorkflowExecution(
  principal: WorkflowExecutionPrincipal,
  currentWorkflow: WorkflowExecutionAuthority
): BoundWorkflowExecutionPrincipal {
  const executionMetadata = requirePrincipalExecutionMetadata(principal)
  return {
    ...principal,
    executionMetadata: {
      ...executionMetadata,
      currentWorkflow: parseWorkflowExecutionAuthority(currentWorkflow),
    },
  }
}

/** Returns strict execution metadata or fails at the application boundary. */
export function requirePrincipalExecutionMetadata(
  principal: Principal
): PrincipalExecutionMetadata {
  if (principal.executionMetadata === undefined) {
    throw new Error('Workflow execution principal is missing execution metadata')
  }
  return parsePrincipalExecutionMetadata(principal.executionMetadata)
}

/** Adds legacy user attribution without changing who the principal represents. */
export function withPrincipalExecutionActor(
  principal: BoundWorkflowExecutionPrincipal,
  userId: string
): BoundWorkflowExecutionPrincipal {
  if (!userId.trim()) throw new Error('Workflow execution actor must not be empty')
  if (resolvePrincipalSubjectUserId(principal) !== undefined) {
    throw new Error('Workflow execution actor is only valid without a Sim user subject')
  }
  return {
    ...principal,
    executionActor: { kind: 'legacy_execution_user', userId },
  }
}

function serializeWorkflowExecutionPrincipal(
  principal: WorkflowExecutionPrincipal
): SerializedWorkflowExecutionPrincipal {
  switch (principal.kind) {
    case 'session':
      return { kind: principal.kind, userId: principal.userId, sessionId: principal.sessionId }
    case 'personal_api_key':
      return { kind: principal.kind, userId: principal.userId, keyId: principal.keyId }
    case 'workspace_api_key':
      return { kind: principal.kind, workspaceId: principal.workspaceId, keyId: principal.keyId }
    case 'system':
      if (principal.serviceId === 'webhook') {
        if (principal.subject && principal.subject.provider !== principal.provider) {
          throw new Error('Webhook system principal subject provider must match its provider')
        }
        return {
          kind: principal.kind,
          serviceId: principal.serviceId,
          workspaceId: principal.workspaceId,
          workflowId: principal.workflowId,
          webhookId: principal.webhookId,
          provider: principal.provider,
          ...(principal.subject ? { subject: principal.subject } : {}),
        }
      }
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        workspaceId: principal.workspaceId,
        workflowId: principal.workflowId,
      }
    case 'delegated':
      return {
        kind: principal.kind,
        serviceId: principal.serviceId,
        subjectUserId: principal.subjectUserId,
        workspaceId: principal.workspaceId,
        delegationId: principal.delegationId,
        audience: principal.audience,
        issuedAt: principal.issuedAt.toISOString(),
        expiresAt: principal.expiresAt.toISOString(),
        ...(principal.resourceScope ? { resourceScope: { ...principal.resourceScope } } : {}),
      }
  }
}

/** Encodes a workflow caller without persisting bearer credentials or invitation proofs. */
export function serializePrincipal(
  principal: WorkflowExecutionPrincipal,
  expectedVersion: 1
): SerializedPrincipalV1
export function serializePrincipal(
  principal: WorkflowExecutionPrincipal,
  expectedVersion: 2
): SerializedPrincipalV2
export function serializePrincipal(principal: WorkflowExecutionPrincipal): SerializedPrincipal
export function serializePrincipal(
  principal: WorkflowExecutionPrincipal,
  expectedVersion?: 1 | 2
): SerializedPrincipal {
  if (principal.executionActor !== undefined) {
    throw new Error('Workflow execution compatibility attribution cannot be serialized')
  }
  const serialized = serializeWorkflowExecutionPrincipal(principal)
  if (principal.executionMetadata === undefined) {
    if (expectedVersion === 2) {
      throw new Error('Serialized principal version 2 requires execution metadata')
    }
    return { version: 1, principal: serialized }
  }
  if (expectedVersion === 1) {
    throw new Error('Serialized principal version 1 cannot carry execution metadata')
  }
  return {
    version: 2,
    principal: serialized,
    executionMetadata: parsePrincipalExecutionMetadata(principal.executionMetadata),
  }
}

/** Strictly validates a persisted workflow caller and restores delegated-principal dates. */
export function parsePrincipal(value: unknown): WorkflowExecutionPrincipal {
  const envelope = requireRecord(value, 'Serialized principal')
  if (envelope.version === 1) {
    requireExactKeys(envelope, ['version', 'principal'])
  } else if (envelope.version === 2) {
    requireExactKeys(envelope, ['version', 'principal', 'executionMetadata'])
  } else {
    throw new Error('Unsupported serialized principal version')
  }

  const executionMetadata =
    envelope.version === 2 ? parsePrincipalExecutionMetadata(envelope.executionMetadata) : undefined
  const withExecutionMetadata = (
    principal: WorkflowExecutionPrincipal
  ): WorkflowExecutionPrincipal =>
    executionMetadata === undefined ? principal : { ...principal, executionMetadata }

  const principal = requireRecord(envelope.principal, 'Serialized principal value')
  const kind = requireString(principal.kind, 'kind')
  switch (kind) {
    case 'session':
      requireExactKeys(principal, ['kind', 'userId', 'sessionId'])
      return withExecutionMetadata({
        kind,
        userId: requireString(principal.userId, 'userId'),
        sessionId: requireString(principal.sessionId, 'sessionId'),
      })
    case 'personal_api_key':
      requireExactKeys(principal, ['kind', 'userId', 'keyId'])
      return withExecutionMetadata({
        kind,
        userId: requireString(principal.userId, 'userId'),
        keyId: requireString(principal.keyId, 'keyId'),
      })
    case 'workspace_api_key':
      requireExactKeys(principal, ['kind', 'workspaceId', 'keyId'])
      return withExecutionMetadata({
        kind,
        workspaceId: requireString(principal.workspaceId, 'workspaceId'),
        keyId: requireString(principal.keyId, 'keyId'),
      })
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
      const subject =
        principal.subject === undefined ? undefined : parseExternalUserSubject(principal.subject)
      if (serviceId === 'webhook') {
        if (!webhookId || !provider) {
          throw new Error('Webhook system principals require webhookId and provider')
        }
        if (subject && subject.provider !== provider) {
          throw new Error('Webhook system principal subject provider must match its provider')
        }
        return withExecutionMetadata({
          kind,
          serviceId,
          workspaceId: requireString(principal.workspaceId, 'workspaceId'),
          workflowId: requireString(principal.workflowId, 'workflowId'),
          webhookId,
          provider,
          ...(subject ? { subject } : {}),
        })
      }
      if (webhookId || provider || subject) {
        throw new Error(`System principal service ${serviceId} cannot carry webhook identity`)
      }
      return withExecutionMetadata({
        kind,
        serviceId: serviceId as ActorlessSystemPrincipal['serviceId'],
        workspaceId: requireString(principal.workspaceId, 'workspaceId'),
        workflowId: requireString(principal.workflowId, 'workflowId'),
      })
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
      return withExecutionMetadata({
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
      })
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
  | { kind: 'workspace_api_key'; keyId: string; workspaceId: string }
  | {
      kind: 'system'
      serviceId: SystemPrincipal['serviceId']
      workspaceId: string
      workflowId: string
      webhookId?: string
      provider?: string
      subject?: ExternalUserSubject
    }
  | {
      kind: 'delegated'
      serviceId: DelegatedPrincipal['serviceId'] | 'executor'
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

export type PrincipalSubject = { kind: 'sim_user'; userId: string } | ExternalUserSubject

/** Resolves a stable human or provider subject without inventing one for actorless callers. */
export function resolvePrincipalSubject(principal: Principal): PrincipalSubject | null {
  switch (principal.kind) {
    case 'session':
    case 'personal_api_key':
      return { kind: 'sim_user', userId: principal.userId }
    case 'delegated':
      return { kind: 'sim_user', userId: principal.subjectUserId }
    case 'system':
      return principal.serviceId === 'webhook' ? (principal.subject ?? null) : null
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
      return { actor, actorId: actor.userId }
    case 'personal_api_key':
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
 * A workspace billing owner may fill that field for actorless workflow execution,
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
      return { actor, attributedUserId: actor.userId }
    case 'workspace_api_key': {
      const attributedUserId = context.workspaceBillingOwnerUserId
      if (!attributedUserId) {
        throw new Error('Workspace API key attribution requires a workspace billing owner')
      }
      return { actor, attributedUserId }
    }
    case 'system': {
      if (principal.executionMetadata === undefined) {
        throw new Error('System principals do not support user attribution')
      }
      const attributedUserId = context.workspaceBillingOwnerUserId
      if (!attributedUserId) {
        throw new Error(
          'Actorless workflow execution attribution requires a workspace billing owner'
        )
      }
      return { actor, attributedUserId }
    }
    case 'delegated': {
      const attributedUserId = resolvePrincipalSubjectUserId(principal)
      if (!attributedUserId) throw new PrincipalSubjectUserRequiredError(principal.kind)
      return { actor, attributedUserId }
    }
    case 'credential_group_enrollment':
      throw new PrincipalSubjectUserRequiredError(actor.kind)
  }
}
