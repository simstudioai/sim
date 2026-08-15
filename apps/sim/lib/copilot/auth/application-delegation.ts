import type { DelegatedPrincipal } from '@sim/auth/principal'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/copilot/constants'

/** Keeps delegated authority valid for the full bounded Copilot orchestration lifetime. */
export const COPILOT_APPLICATION_DELEGATION_TTL_MS = ORCHESTRATION_TIMEOUT_MS

export interface CopilotExecutionContext {
  userId?: string
  workspaceId?: string
  chatId?: string
  executionId?: string
  toolCallId?: string
  copilotToolExecution?: boolean
  copilotInteractionMode?: 'interactive' | 'headless'
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
  'fileId' | 'tableId'
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

  const issuedAt = new Date()
  const resourceScope = Object.freeze({
    ...(options.resourceScope?.fileId ? { fileId: options.resourceScope.fileId } : {}),
    ...(options.resourceScope?.tableId ? { tableId: options.resourceScope.tableId } : {}),
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
