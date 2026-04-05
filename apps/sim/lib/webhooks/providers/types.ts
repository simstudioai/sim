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

  /** Custom input preparation. Replaces the standard `formatWebhookInput` call when defined. */
  formatInput?(ctx: FormatInputContext): Promise<FormatInputResult>

  /** Called when standard `formatWebhookInput` returns null. Return skip message or null to proceed. */
  handleEmptyInput?(requestId: string): { message: string } | null

  /** Post-process input to handle file uploads before execution. */
  processInputFiles?(ctx: ProcessFilesContext): Promise<void>
}
