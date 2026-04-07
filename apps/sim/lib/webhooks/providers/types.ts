import type { NextRequest, NextResponse } from 'next/server'

/** Context for signature/token verification. */
export interface AuthContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  request: NextRequest
  rawBody: string
  requestId: string
  providerConfig: Record<string, unknown>
}

/** Context for event matching against trigger configuration. */
export interface EventMatchContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  body: unknown
  request: NextRequest
  requestId: string
  providerConfig: Record<string, unknown>
}

/** Context for event filtering and header enrichment. */
export interface EventFilterContext {
  webhook: Record<string, unknown>
  body: unknown
  requestId: string
  providerConfig: Record<string, unknown>
}

/** Context for custom input preparation during execution. */
export interface FormatInputContext {
  webhook: Record<string, unknown>
  workflow: { id: string; userId: string }
  body: unknown
  headers: Record<string, string>
  requestId: string
}

/** Result of custom input preparation. */
export interface FormatInputResult {
  input: unknown
  skip?: { message: string }
}

/** Context for provider-specific file processing before execution. */
export interface ProcessFilesContext {
  input: Record<string, unknown>
  blocks: Record<string, unknown>
  blockId: string
  workspaceId: string
  workflowId: string
  executionId: string
  requestId: string
  userId: string
}

/** Context for creating an external webhook subscription during deployment. */
export interface SubscriptionContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  userId: string
  requestId: string
  request: NextRequest
}

/** Result of creating an external webhook subscription. */
export interface SubscriptionResult {
  /** Fields to merge into providerConfig (externalId, webhookSecret, etc.) */
  providerConfigUpdates?: Record<string, unknown>
}

/** Context for deleting an external webhook subscription during undeployment. */
export interface DeleteSubscriptionContext {
  webhook: Record<string, unknown>
  workflow: Record<string, unknown>
  requestId: string
}

/** Context for configuring polling after webhook creation. */
export interface PollingConfigContext {
  webhook: Record<string, unknown>
  requestId: string
}

/**
 * Strategy interface for provider-specific webhook behavior.
 * Each provider implements only the methods it needs — all methods are optional.
 */
export interface WebhookProviderHandler {
  /** Verify signature/auth. Return NextResponse(401/403) on failure, null on success. */
  verifyAuth?(ctx: AuthContext): Promise<NextResponse | null> | NextResponse | null

  /** Handle reachability/verification probes after webhook lookup. */
  handleReachabilityTest?(body: unknown, requestId: string): NextResponse | null

  /** Format error responses (some providers need special formats). */
  formatErrorResponse?(error: string, status: number): NextResponse

  /** Return true to skip this event (filtering by event type, collection, etc.). */
  shouldSkipEvent?(ctx: EventFilterContext): boolean

  /** Return true if event matches, false or NextResponse to skip with a custom response. */
  matchEvent?(ctx: EventMatchContext): Promise<boolean | NextResponse> | boolean | NextResponse

  /** Add provider-specific headers (idempotency keys, notification IDs, etc.). */
  enrichHeaders?(ctx: EventFilterContext, headers: Record<string, string>): void

  /** Extract unique identifier for idempotency dedup. */
  extractIdempotencyId?(body: unknown): string | null

  /** Custom success response after queuing. Return null for default `{message: "Webhook processed"}`. */
  formatSuccessResponse?(providerConfig: Record<string, unknown>): NextResponse | null

  /** Custom error response when queuing fails. Return null for default 500. */
  formatQueueErrorResponse?(): NextResponse | null

  /** Custom input preparation. When defined, replaces the default pass-through of the raw body. */
  formatInput?(ctx: FormatInputContext): Promise<FormatInputResult>

  /** Called when input is null after formatting. Return skip message or null to proceed. */
  handleEmptyInput?(requestId: string): { message: string } | null

  /** Post-process input to handle file uploads before execution. */
  processInputFiles?(ctx: ProcessFilesContext): Promise<void>

  /** Create an external webhook subscription (e.g., register with Telegram, Airtable, etc.). */
  createSubscription?(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined>

  /** Delete an external webhook subscription during cleanup. Errors should not throw. */
  deleteSubscription?(ctx: DeleteSubscriptionContext): Promise<void>

  /** Configure polling after webhook creation (gmail, outlook, rss, imap). */
  configurePolling?(ctx: PollingConfigContext): Promise<boolean>

  /** Handle verification challenges before webhook lookup (Slack url_verification, WhatsApp hub.verify_token, Teams validationToken). */
  handleChallenge?(
    body: unknown,
    request: NextRequest,
    requestId: string,
    path: string,
    /** Raw request body bytes (when available); required for signature checks that must match the provider (e.g. Zoom). */
    rawBody?: string
  ): Promise<NextResponse | null> | NextResponse | null
}
