import type {
  DelegatedPrincipal,
  OrganizationDelegatedPrincipal,
  ResourceDelegatedPrincipal,
  ResourceDelegationScope,
} from '@sim/auth/principal'
import { requireResourceDelegation } from '@/lib/core/application/resource-delegation'
import { TOOL_WATCHDOG_LONG_RUNNING_MS } from '@/lib/mothership/constants'

/**
 * Delegated authority is minted per operation and must outlive the longest single
 * tool call it authorizes, never the whole run, so it reuses the long-running tool
 * watchdog's cap rather than a lifetime of its own.
 */
export const COPILOT_APPLICATION_DELEGATION_TTL_MS = TOOL_WATCHDOG_LONG_RUNNING_MS

export interface CopilotExecutionContext {
  requestMode?: string
  userId?: string
  workspaceId?: string
  workflowId?: string
  organizationId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  mcpBlockId?: string
  executorDelegationOrigin?: unknown
  boundWorkflowExecutionId?: string
  copilotToolExecution?: boolean
  copilotInteractionMode?: 'interactive' | 'headless'
  copilotResourceAdmission?: CopilotResourceAdmission
}

type CopilotResourcePrincipal = Extract<ResourceDelegatedPrincipal, { serviceId: 'copilot' }>

const RESOURCE_ADMISSION = Symbol('copilot-resource-admission')

/** Opaque admission evidence carried only inside Sim; serialized copies grant no authority. */
export interface CopilotResourceAdmission {
  readonly [RESOURCE_ADMISSION]: true
}

const RESOURCE_ADMISSIONS = new WeakMap<
  CopilotResourceAdmission,
  Readonly<{ userId: string; invocation: CopilotResourcePrincipal['invocation'] }>
>()

export interface TrustedCopilotResourceExecutionContext extends CopilotExecutionContext {
  userId: string
  toolCallId: string
  copilotToolExecution: true
  copilotResourceAdmission: CopilotResourceAdmission
  invocation: CopilotResourcePrincipal['invocation']
}

export interface CopilotResourceDelegationConfiguration {
  audience: string
  ttlMs: number
  createDelegationId(context: TrustedCopilotResourceExecutionContext): string
}

/** Called only after authoring ingress authenticates its user and invocation, including resumed runs. */
export function createCopilotResourceAdmission(input: {
  userId: string
  invocation: CopilotResourcePrincipal['invocation']
}): CopilotResourceAdmission {
  requireNonEmpty(input.userId, 'an authenticated authoring user ID')
  if (input.invocation.kind === 'chat') {
    requireNonEmpty(input.invocation.chatId, 'an authoring chat ID')
  } else if (input.invocation.kind === 'workspace') {
    requireNonEmpty(input.invocation.workspaceId, 'an authoring workspace ID')
  } else {
    throw new Error('Copilot resource admission requires an authoring invocation')
  }
  const admission = Object.freeze({ [RESOURCE_ADMISSION]: true as const })
  RESOURCE_ADMISSIONS.set(
    admission,
    Object.freeze({ userId: input.userId, invocation: Object.freeze({ ...input.invocation }) })
  )
  return admission
}

function resourceAdmissionForContext(context: CopilotExecutionContext | undefined) {
  const admission = context?.copilotResourceAdmission
    ? RESOURCE_ADMISSIONS.get(context.copilotResourceAdmission)
    : undefined
  if (!context || !admission) return undefined
  if (
    context.copilotToolExecution !== true ||
    context.userId !== admission.userId ||
    context.executorDelegationOrigin !== undefined ||
    context.mcpBlockId !== undefined ||
    context.boundWorkflowExecutionId !== undefined ||
    (admission.invocation.kind === 'chat'
      ? context.chatId !== admission.invocation.chatId
      : context.workspaceId !== admission.invocation.workspaceId || context.chatId !== undefined)
  ) {
    return undefined
  }
  return admission
}

/** Recognizes admitted authoring turns before a tool call exists, without serializing their evidence. */
export function hasCopilotResourceAdmission(context: CopilotExecutionContext | undefined): boolean {
  return resourceAdmissionForContext(context) !== undefined
}

/** Narrows positive server admission; old tool flags and model parameters cannot establish it. */
export function requireTrustedCopilotResourceExecutionContext(
  context: CopilotExecutionContext | undefined
): TrustedCopilotResourceExecutionContext {
  const admission = resourceAdmissionForContext(context)
  if (!context || !admission || !context.copilotResourceAdmission) {
    throw new Error('Copilot resource operations require current authoring admission')
  }
  requireNonEmpty(context.toolCallId, 'a tool call ID')
  return Object.freeze({
    userId: admission.userId,
    toolCallId: context.toolCallId,
    copilotToolExecution: true,
    copilotResourceAdmission: context.copilotResourceAdmission,
    invocation: admission.invocation,
    ...(context.chatId ? { chatId: context.chatId } : {}),
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.organizationId ? { organizationId: context.organizationId } : {}),
    ...(context.workflowId ? { workflowId: context.workflowId } : {}),
    ...(context.executionId ? { executionId: context.executionId } : {}),
    ...(context.requestMode ? { requestMode: context.requestMode } : {}),
    ...(context.copilotInteractionMode
      ? { copilotInteractionMode: context.copilotInteractionMode }
      : {}),
  })
}

/** Creates per-operation resource authority while preserving the admitted human and invocation. */
export function createCopilotResourceApplicationPrincipal(
  context: TrustedCopilotResourceExecutionContext,
  options: CopilotResourceDelegationConfiguration & { scope: ResourceDelegationScope }
): CopilotResourcePrincipal {
  const trustedContext = requireTrustedCopilotResourceExecutionContext(context)
  const issuedAt = new Date()
  const scope = structuredClone(options.scope)
  if (scope.kind === 'file_copy') {
    Object.freeze(scope.source.owner)
    Object.freeze(scope.source.fileIds)
    Object.freeze(scope.source.folderIds)
    Object.freeze(scope.source)
    Object.freeze(scope.destination.owner)
    Object.freeze(scope.destination)
  }
  const principal: CopilotResourcePrincipal = Object.freeze({
    kind: 'resource_delegated',
    serviceId: 'copilot',
    subjectUserId: trustedContext.userId,
    delegationId: options.createDelegationId(trustedContext),
    audience: options.audience,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + options.ttlMs),
    invocation: Object.freeze({ ...trustedContext.invocation }),
    scope: Object.freeze(scope),
  })
  requireResourceDelegation(principal, {
    audience: options.audience,
    services: ['copilot'],
    scope: options.scope,
    maxTtlMs: options.ttlMs,
  })
  return principal
}

export interface TrustedCopilotExecutionContext extends CopilotExecutionContext {
  userId: string
  workspaceId: string
  toolCallId: string
  copilotToolExecution: true
}

export interface TrustedInteractiveCopilotExecutionContext extends TrustedCopilotExecutionContext {
  copilotInteractionMode: 'interactive'
}

export class InteractiveCopilotExecutionRequiredError extends Error {
  constructor() {
    super('Live platform context is available only in an interactive Copilot session.')
    this.name = 'InteractiveCopilotExecutionRequiredError'
  }
}

export type CopilotResourceScope = Pick<
  NonNullable<DelegatedPrincipal['resourceScope']>,
  'fileId' | 'tableId' | 'credentialId' | 'mcpServerId'
>

export interface CopilotDelegationConfiguration {
  audience: string
  ttlMs: number
  createDelegationId(context: TrustedCopilotExecutionContext): string
}

interface CreateCopilotApplicationPrincipalOptions extends CopilotDelegationConfiguration {
  resourceScope?: CopilotResourceScope
}

interface CreateTrustedCopilotPrincipalInput {
  userId: string
  workspaceId: string
  delegationId: string
  chatId?: string
  executionId?: string
}

interface CreateTrustedCopilotPrincipalOptions {
  audience: string
  ttlMs: number
  resourceScope?: CopilotResourceScope
}

export interface CopilotChatDelegationContext {
  userId: string
  workspaceId: string
  chatId?: string
}

/** Creates request-scoped authority for resource reads during an authenticated chat turn. */
export function createCopilotChatPrincipal(
  context: CopilotChatDelegationContext,
  audience: string,
  resourceScope?: CopilotResourceScope
): DelegatedPrincipal {
  return createTrustedCopilotPrincipal(
    { ...context, delegationId: `copilot-chat:${context.chatId ?? context.workspaceId}` },
    { audience, ttlMs: COPILOT_APPLICATION_DELEGATION_TTL_MS, resourceScope }
  )
}

function requireNonEmpty(value: string | undefined, field: string): asserts value is string {
  if (!value?.trim()) throw new Error(`Copilot execution context requires ${field}`)
}

/** Validates and narrows the server-authored identity attached to a Copilot tool call. */
export function requireTrustedCopilotExecutionContext(
  context: CopilotExecutionContext | undefined
): TrustedCopilotExecutionContext {
  if (!context) throw new Error('Copilot execution context is required')
  if (context.copilotToolExecution !== true) {
    throw new Error('Copilot execution context requires a trusted Copilot execution context')
  }
  requireNonEmpty(context.userId, 'an authenticated user ID')
  requireNonEmpty(context.workspaceId, 'a workspace ID')
  requireNonEmpty(context.toolCallId, 'a tool call ID')
  if (context.chatId !== undefined) requireNonEmpty(context.chatId, 'a valid chat ID')
  if (context.executionId !== undefined) {
    requireNonEmpty(context.executionId, 'a valid execution ID')
  }

  return Object.freeze({
    userId: context.userId,
    workspaceId: context.workspaceId,
    ...(context.chatId ? { chatId: context.chatId } : {}),
    ...(context.executionId ? { executionId: context.executionId } : {}),
    toolCallId: context.toolCallId,
    copilotToolExecution: true,
    ...(context.requestMode ? { requestMode: context.requestMode } : {}),
    ...(context.copilotInteractionMode
      ? { copilotInteractionMode: context.copilotInteractionMode }
      : {}),
  })
}

/** Restricts sensitive live platform reads to a server-classified interactive lifecycle. */
export function requireInteractiveCopilotExecutionContext(
  context: CopilotExecutionContext | undefined
): TrustedInteractiveCopilotExecutionContext {
  const trustedContext = requireTrustedCopilotExecutionContext(context)
  if (trustedContext.copilotInteractionMode !== 'interactive') {
    throw new InteractiveCopilotExecutionRequiredError()
  }
  return trustedContext as TrustedInteractiveCopilotExecutionContext
}

/** Creates a bounded Copilot principal from an explicitly trusted server lifecycle. */
export function createTrustedCopilotPrincipal(
  input: CreateTrustedCopilotPrincipalInput,
  options: CreateTrustedCopilotPrincipalOptions
): DelegatedPrincipal {
  requireNonEmpty(input.userId, 'an authenticated user ID')
  requireNonEmpty(input.workspaceId, 'a workspace ID')
  requireNonEmpty(input.delegationId, 'a delegation ID')
  if (input.chatId !== undefined) requireNonEmpty(input.chatId, 'a valid chat ID')
  if (input.executionId !== undefined) requireNonEmpty(input.executionId, 'a valid execution ID')
  requireNonEmpty(options.audience, 'a delegation audience')
  if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('Copilot application delegation requires a positive integer TTL')
  }
  if (options.resourceScope?.fileId !== undefined) {
    requireNonEmpty(options.resourceScope.fileId, 'a valid file scope')
  }
  if (options.resourceScope?.tableId !== undefined) {
    requireNonEmpty(options.resourceScope.tableId, 'a valid table scope')
  }
  if (options.resourceScope?.credentialId !== undefined) {
    requireNonEmpty(options.resourceScope.credentialId, 'a valid credential scope')
  }

  if (options.resourceScope?.mcpServerId !== undefined) {
    requireNonEmpty(options.resourceScope.mcpServerId, 'a valid MCP server scope')
  }

  const issuedAt = new Date()
  const resourceScope = Object.freeze({
    ...(options.resourceScope?.fileId ? { fileId: options.resourceScope.fileId } : {}),
    ...(options.resourceScope?.tableId ? { tableId: options.resourceScope.tableId } : {}),
    ...(options.resourceScope?.credentialId
      ? { credentialId: options.resourceScope.credentialId }
      : {}),
    ...(options.resourceScope?.mcpServerId
      ? { mcpServerId: options.resourceScope.mcpServerId }
      : {}),
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
  })

  return Object.freeze({
    kind: 'delegated',
    serviceId: 'copilot',
    subjectUserId: input.userId,
    workspaceId: input.workspaceId,
    delegationId: input.delegationId,
    audience: options.audience,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + options.ttlMs),
    resourceScope,
  })
}

/** Creates a bounded principal from a validated Copilot tool execution context. */
export function createCopilotApplicationPrincipal(
  trustedContext: TrustedCopilotExecutionContext,
  options: CreateCopilotApplicationPrincipalOptions
): DelegatedPrincipal {
  const delegationId = options.createDelegationId(trustedContext)
  return createTrustedCopilotPrincipal(
    {
      userId: trustedContext.userId,
      workspaceId: trustedContext.workspaceId,
      delegationId,
      chatId: trustedContext.chatId,
      executionId: trustedContext.executionId,
    },
    options
  )
}

/** Creates a chat-bound organization delegation from authenticated service context. */
export function createTrustedOrganizationCopilotPrincipal(
  input: { userId: string; organizationId: string; chatId: string; delegationId: string },
  options: { audience: string; ttlMs: number }
): OrganizationDelegatedPrincipal {
  requireNonEmpty(input.userId, 'an authenticated user ID')
  requireNonEmpty(input.organizationId, 'an organization ID')
  requireNonEmpty(input.chatId, 'a chat ID')
  requireNonEmpty(input.delegationId, 'a delegation ID')
  requireNonEmpty(options.audience, 'a delegation audience')
  if (!Number.isInteger(options.ttlMs) || options.ttlMs <= 0) {
    throw new Error('Copilot application delegation requires a positive integer TTL')
  }
  const issuedAt = new Date()
  return Object.freeze({
    kind: 'organization_delegated',
    serviceId: 'copilot',
    subjectUserId: input.userId,
    organizationId: input.organizationId,
    delegationId: input.delegationId,
    audience: options.audience,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + options.ttlMs),
    resourceScope: Object.freeze({ chatId: input.chatId }),
  })
}

/** Organization tools require the server's explicit Assistant and private-chat context. */
export function requireTrustedOrganizationCopilotContext(
  context: CopilotExecutionContext | undefined
) {
  if (
    !context ||
    !context.copilotToolExecution ||
    (context.requestMode !== 'assistant' &&
      context.requestMode !== 'agent' &&
      context.requestMode !== 'plan') ||
    context.workspaceId ||
    context.workflowId
  ) {
    throw new Error('Organization tools require trusted organization execution context')
  }
  requireNonEmpty(context.userId, 'an authenticated user ID')
  requireNonEmpty(context.organizationId, 'an organization ID')
  requireNonEmpty(context.chatId, 'a chat ID')
  requireNonEmpty(context.toolCallId, 'a tool call ID')
  return Object.freeze({
    userId: context.userId,
    organizationId: context.organizationId,
    chatId: context.chatId,
    toolCallId: context.toolCallId,
  })
}
