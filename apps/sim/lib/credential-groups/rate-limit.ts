import { NextResponse } from 'next/server'
import { RateLimitError, RateLimiter, type TokenBucketConfig } from '@/lib/core/rate-limiter'
import { getClientIp } from '@/lib/core/utils/request'

const rateLimiter = new RateLimiter()

const CREDENTIAL_GROUP_INVITATION_RATE_LIMIT = {
  maxTokens: 5,
  refillRate: 5,
  refillIntervalMs: 60_000,
} as const

function credentialGroupInvitationRateLimitKey(workspaceId: string): string {
  return `route:credential-group-invitations:workspace:${workspaceId}`
}

const PUBLIC_ENROLLMENT_METADATA_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 120,
  refillRate: 120,
  refillIntervalMs: 60_000,
}

const PUBLIC_OAUTH_START_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 15 * 60_000,
}

const PUBLIC_OAUTH_CALLBACK_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 60,
  refillRate: 60,
  refillIntervalMs: 15 * 60_000,
}

type PublicCredentialGroupRateLimitScope =
  | 'metadata'
  | 'oauth-start'
  | 'oauth-callback'
  | 'complete'

function rateLimitResponse(retryAfterMs: number | undefined, fallbackMs: number): NextResponse {
  const retryAfterSeconds = Math.ceil((retryAfterMs ?? fallbackMs) / 1000)
  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    }
  )
}

function configForPublicScope(scope: PublicCredentialGroupRateLimitScope): TokenBucketConfig {
  if (scope === 'metadata') return PUBLIC_ENROLLMENT_METADATA_RATE_LIMIT
  if (scope === 'oauth-start' || scope === 'complete') return PUBLIC_OAUTH_START_RATE_LIMIT
  return PUBLIC_OAUTH_CALLBACK_RATE_LIMIT
}

async function enforcePublicCredentialGroupIpRateLimitWithPolicy(
  request: { headers: { get(name: string): string | null } },
  scope: PublicCredentialGroupRateLimitScope,
  unresolvedClientPolicy: 'deny' | 'defer'
): Promise<NextResponse | null> {
  const config = configForPublicScope(scope)
  const ip = getClientIp(request)
  if (!ip) {
    return unresolvedClientPolicy === 'deny'
      ? rateLimitResponse(undefined, config.refillIntervalMs)
      : null
  }
  const result = await rateLimiter.checkRateLimitDirect(
    `public-credential-group:${scope}:ip:${ip}`,
    config,
    { failClosed: scope !== 'metadata' }
  )
  return result.allowed ? null : rateLimitResponse(result.retryAfterMs, config.refillIntervalMs)
}

/** Per-IP guard for unauthenticated enrollment reads and OAuth endpoints. */
export async function enforcePublicCredentialGroupIpRateLimit(
  request: { headers: { get(name: string): string | null } },
  scope: PublicCredentialGroupRateLimitScope
): Promise<NextResponse | null> {
  return enforcePublicCredentialGroupIpRateLimitWithPolicy(request, scope, 'deny')
}

/**
 * Applies the OAuth-start IP bucket when resolvable and otherwise defers to the
 * mandatory per-enrollment OAuth budget applied after invitation authentication.
 */
export async function enforcePublicCredentialGroupOAuthStartIpRateLimit(request: {
  headers: { get(name: string): string | null }
}): Promise<NextResponse | null> {
  return enforcePublicCredentialGroupIpRateLimitWithPolicy(request, 'oauth-start', 'defer')
}

/** Prevents one leaked invitation from starting unbounded provider consent flows. */
export async function enforceCredentialGroupEnrollmentOAuthRateLimit(
  enrollmentId: string
): Promise<NextResponse | null> {
  const result = await rateLimiter.checkRateLimitDirect(
    `public-credential-group:oauth-start:enrollment:${enrollmentId}`,
    PUBLIC_OAUTH_START_RATE_LIMIT,
    { failClosed: true }
  )
  return result.allowed
    ? null
    : rateLimitResponse(result.retryAfterMs, PUBLIC_OAUTH_START_RATE_LIMIT.refillIntervalMs)
}

export class CredentialGroupInvitationRateLimitError extends RateLimitError {
  constructor(
    readonly retryAfterSeconds: number,
    readonly resetAt: Date
  ) {
    super('Rate limit exceeded')
    this.name = 'CredentialGroupInvitationRateLimitError'
  }
}

/** Shared workspace admission for HTTP batch invitations and resends. */
export async function enforceCredentialGroupInvitationRouteRateLimit(
  workspaceId: string
): Promise<void> {
  const result = await rateLimiter.checkRateLimitDirect(
    credentialGroupInvitationRateLimitKey(workspaceId),
    CREDENTIAL_GROUP_INVITATION_RATE_LIMIT,
    { failClosed: true }
  )
  if (!result.allowed) {
    throw new CredentialGroupInvitationRateLimitError(
      Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)),
      result.resetAt
    )
  }
}

/** Applies the shared invitation budget to non-HTTP workflow execution. */
export async function enforceCredentialGroupInvitationExecutionRateLimit(
  workspaceId: string
): Promise<void> {
  const result = await rateLimiter.checkRateLimitDirect(
    credentialGroupInvitationRateLimitKey(workspaceId),
    CREDENTIAL_GROUP_INVITATION_RATE_LIMIT,
    { failClosed: true }
  )
  if (!result.allowed) throw new RateLimitError('Credential Group invitation rate limit exceeded')
}
