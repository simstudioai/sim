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
  /** Request URL query parameters. Repeated keys collapse to the last value. */
  query: Record<string, string>
  /** HTTP method of the delivering request. Empty on legacy queued jobs. */
  method: string
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
  strict?: boolean
}

/** Context for configuring polling after webhook creation. */
export interface PollingConfigContext {
  webhook: Record<string, unknown>
  requestId: string
  /** Deployment actor used to validate reference-backed polling configuration. */
  userId: string
  workspaceId: string | null
  deploymentVersionId?: string | null
  /**
   * Stable registration preparation supplies a generation-fenced persistence callback.
   * Legacy callers omit it and retain the existing provider-owned write behavior.
   */
  persistProviderConfig?(providerConfig: Record<string, unknown>): Promise<boolean>
}

/**
 * Strategy interface for provider-specific webhook behavior.
 * Each provider implements only the methods it needs — all methods are optional.
 */
export interface WebhookProviderHandler {
  /**
   * Restrict deliveries to a provider-owned ingress route instead of the generic per-webhook
   * path route. Use when the provider sends all app events to one callback before target lookup.
   */
  ingressMode?: 'path' | 'provider'

  /**
   * Methods this provider is *able* to accept in addition to `POST`, and the `providerConfig`
   * flag each webhook must set to actually accept them. Declaring the capability is not enough:
   * `acceptsWebhookDeliveryMethod` still requires the per-webhook flag, so a webhook deployed
   * before the capability existed keeps answering `405` exactly as it did.
   *
   * Use for providers whose events can originate from a plain HTTP call (an email link, a
   * REST-style client) rather than a signed callback. Such a delivery may carry no body at all,
   * so the provider must be able to trigger on the query parameters alone, and with `GET` the
   * caller must tolerate the request being replayed by link prefetchers and scanners — which is
   * why it is the webhook owner's decision rather than a platform default.
   */
  extraDeliveryMethods?: {
    methods: readonly string[]
    /** `providerConfig` key whose truthy value opts this webhook into {@link methods}. */
    enabledBy: string
  }

  /**
   * Methods on which {@link handleChallenge} may answer. Defaults to `POST` only, because a
   * challenge is a provider handshake and every provider that sends one sends it as a `POST`.
   *
   * The default matters for correctness, not just tidiness: challenge handlers run before the
   * webhook lookup and match on shape alone, so an unrestricted handler will answer a delivery
   * addressed to a different provider on the same path. Widen this only for a provider that
   * genuinely handshakes on another method (Meta sends the WhatsApp verification as a `GET`).
   */
  challengeMethods?: readonly string[]

  /**
   * Queue workflow execution through the configured durable backend instead of the low-latency
   * in-process path. Use for providers whose ingress is acknowledged before target processing.
   */
  executionMode?: 'inline' | 'queue'

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

  /** Delete an external webhook subscription during cleanup. Strict outbox cleanup should throw. */
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
