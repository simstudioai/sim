import type { PersonalApiKeyPrincipal, WorkspaceApiKeyPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { type PermissionType, permissionSatisfies } from '@sim/platform-authz/workspace'
import { type NextRequest, NextResponse } from 'next/server'
import type { ZodError } from 'zod'
import { getValidationErrorMessage, isZodError, validationErrorResponse } from '@/lib/api/server'
import { buildRateLimitHeaders, recordRateLimitSnapshot } from '@/lib/api/server/rate-limit-context'
import { PERSONAL_KEY_DENIED, WORKSPACE_KEY_SCOPE_DENIED } from '@/lib/api-key/policy-messages'
import { getHighestPrioritySubscription } from '@/lib/billing/core/subscription'
import type { ForbiddenDetailCode } from '@/lib/core/application/forbidden'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter'
import { getRateLimit, RateLimiter } from '@/lib/core/rate-limiter'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  CAPABILITY_RULES,
  type StaticPermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'
import {
  capabilityRefusal,
  isWorkspaceCapabilityWithheld,
} from '@/lib/permission-groups/capability-assertions'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import {
  getWorkspaceBilledAccountUserId,
  getWorkspaceBillingSettings,
} from '@/lib/workspaces/utils'
import type { TableAccessPrincipal } from '@/app/api/table/utils'
import { authenticateV1Request } from '@/app/api/v1/auth'

const logger = createLogger('V1Middleware')
const rateLimiter = new RateLimiter()

/**
 * Endpoint labels for v1 public API auth/rate-limit telemetry. The label is only
 * a log/metric dimension, not a policy switch — every label resolves to the same
 * `authenticateV1Request` + `api-endpoint` rate bucket.
 *
 * The v2 surface does not use these labels: v2 routes are built with
 * `defineV2JsonRoute` and rate-limited through `v2RateLimits`. Add a member only
 * when a route actually passes it to `checkRateLimit` / `authenticateRequest`.
 */
export type ApiEndpoint =
  | 'logs'
  | 'logs-detail'
  | 'workflows'
  | 'workflow-detail'
  | 'workflow-deploy'
  | 'workflow-rollback'
  | 'workflow-export'
  | 'workflow-import'
  | 'audit-logs'
  | 'tables'
  | 'table-detail'
  | 'table-rows'
  | 'table-row-detail'
  | 'table-columns'
  | 'files'
  | 'file-detail'
  | 'knowledge'
  | 'knowledge-detail'
  | 'knowledge-search'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: Date
  /**
   * Bucket capacity, matching what `remaining` counts down from. Zero on the
   * paths that never reached the bucket (auth failure, checker error); those
   * carry `error` and publish no rate-limit headers.
   */
  limit: number
  retryAfterMs?: number
  userId?: string
  workspaceId?: string
  /**
   * `oauth_access_token` never arises on v1, which authenticates API keys only;
   * it is here because the v2 builders record their rate-limit snapshot in this
   * shape.
   */
  keyType?: 'personal' | 'workspace' | 'oauth_access_token'
  principal?: PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal
  error?: string
}

export interface AuthorizedRequest {
  requestId: string
  userId: string
  rateLimit: RateLimitResult
}

export function requireRateLimitUserId(rateLimit: RateLimitResult): string {
  if (!rateLimit.allowed) {
    throw new Error('Cannot authorize a denied public API request')
  }
  if (!rateLimit.userId) {
    throw new Error('Allowed public API request is missing a user ID')
  }
  return rateLimit.userId
}

/**
 * The user whose permission group governs this request, or `null` when none
 * does.
 *
 * The v1 reading of the rule `capabilityGovernedPrincipalUserId` states in
 * `@/lib/core/application`: `rateLimit.userId` is present for BOTH key kinds,
 * and for a workspace key it is the key's creator. `keyType` is the
 * authoritative signal, and this is the one place v1 reads it for that purpose,
 * so {@link resolveCapabilityRefusal}, {@link tableAccessPrincipal} and the log
 * field projection cannot drift.
 *
 * `scripts/check-capability-subject.ts` is written in terms of this name and
 * asserts every v1 capability subject came from it; rename them together.
 */
export function capabilityGovernedUserId(rateLimit: RateLimitResult): string | null {
  return rateLimit.keyType === 'personal' ? (rateLimit.userId ?? null) : null
}

/**
 * The {@link TableAccessPrincipal} for a v1 table request.
 *
 * `/api/v1/tables/**` shares `checkAccess` with the raw internal table routes,
 * which gate `tables.use` inside it. Those routes reject `x-api-key` outright,
 * so every caller there is a person; v1's are API keys, and a workspace key must
 * reach the table ungated. Built here rather than at each of the fourteen v1
 * handlers, so the decision stays in the same module as every other `keyType`
 * policy.
 */
export function tableAccessPrincipal(rateLimit: RateLimitResult): TableAccessPrincipal {
  const userId = requireRateLimitUserId(rateLimit)
  return capabilityGovernedUserId(rateLimit)
    ? { kind: 'user', userId }
    : { kind: 'workspace_api_key', keyCreatorUserId: userId }
}

export function requireRateLimitPrincipal(
  rateLimit: RateLimitResult
): PersonalApiKeyPrincipal | WorkspaceApiKeyPrincipal {
  if (!rateLimit.allowed) {
    throw new Error('Cannot authorize a denied public API request')
  }
  if (!rateLimit.principal) {
    throw new Error('Allowed public API request is missing its Principal')
  }
  return rateLimit.principal
}

export async function checkRateLimit(
  request: NextRequest,
  endpoint: ApiEndpoint = 'logs'
): Promise<RateLimitResult> {
  try {
    const auth = await authenticateV1Request(request)
    if (!auth.authenticated) {
      return {
        allowed: false,
        remaining: 0,
        limit: 0,
        resetAt: new Date(),
        error: auth.error,
      }
    }

    const userId = auth.userId!
    const subscription = await getHighestPrioritySubscription(userId)

    const result = await rateLimiter.checkRateLimitWithSubscription(
      userId,
      subscription,
      'api-endpoint',
      false
    )

    if (!result.allowed) {
      logger.warn(`Rate limit exceeded for user ${userId}`, {
        endpoint,
        remaining: result.remaining,
        resetAt: result.resetAt,
      })
    }

    const plan = (subscription?.plan || 'free') as SubscriptionPlan
    const config = getRateLimit(plan, 'api-endpoint')

    /** Recorded here — the one place the bucket is actually consulted. */
    recordRateLimitSnapshot(request, {
      limit: config.maxTokens,
      remaining: result.remaining,
      resetAt: result.resetAt,
    })

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetAt: result.resetAt,
      /**
       * The bucket's capacity, not its refill rate. `remaining` is the token
       * count left in that bucket, and `createBucketConfig` sets
       * `maxTokens = refillRate * burstMultiplier` — so reporting `refillRate`
       * here published an `X-RateLimit-Limit` smaller than the
       * `X-RateLimit-Remaining` beside it (e.g. limit 200, remaining 399), and
       * any client computing `used = limit - remaining` got a negative number.
       * Both headers must describe the same quantity.
       */
      limit: config.maxTokens,
      retryAfterMs: result.retryAfterMs,
      userId,
      workspaceId: auth.workspaceId,
      keyType: auth.keyType,
      principal: auth.principal,
    }
  } catch (error) {
    logger.error('Rate limit check error', { error })
    return {
      allowed: false,
      remaining: 0,
      limit: 0,
      resetAt: new Date(Date.now() + 60000),
      error: 'Rate limit check failed',
    }
  }
}

/**
 * Authenticates and rate-limits a public API request.
 * Returns NextResponse on failure, AuthorizedRequest on success.
 */
export async function authenticateRequest(
  request: NextRequest,
  endpoint: ApiEndpoint
): Promise<AuthorizedRequest | NextResponse> {
  const requestId = generateRequestId()
  const rateLimit = await checkRateLimit(request, endpoint)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit)
  }
  return { requestId, userId: requireRateLimitUserId(rateLimit), rateLimit }
}

export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  /**
   * An authentication failure never reaches the token bucket, so there is no
   * limit to report. Publishing a placeholder told unauthenticated callers they
   * had been throttled and handed monitoring a quota that does not exist.
   */
  if (result.error) {
    return NextResponse.json({ error: result.error || 'Unauthorized' }, { status: 401 })
  }

  const retryAfterSeconds = result.retryAfterMs
    ? Math.ceil(result.retryAfterMs / 1000)
    : Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)

  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      message: `API rate limit exceeded. Please retry after ${result.resetAt.toISOString()}`,
      retryAfter: result.resetAt.getTime(),
    },
    {
      status: 429,
      headers: {
        ...buildRateLimitHeaders(result),
        'Retry-After': retryAfterSeconds.toString(),
      },
    }
  )
}

/**
 * Structured workspace-access failure shared by the v1 and v2 API surfaces so
 * each version can render the failure in its own response envelope.
 */
export interface WorkspaceAccessError {
  status: number
  code: 'FORBIDDEN'
  message: string
  /**
   * The detail code a client can branch on, present only when a permission
   * group withheld a capability. Read from {@link CAPABILITY_RULES} rather than
   * spelled out, so v1 renders the same code as the funnel and the raw internal
   * routes for the same refusal.
   */
  details?: { code: ForbiddenDetailCode }
}

/**
 * The permission-group capability a v1 route requires, or `'none'` when no
 * group governs it.
 *
 * Required rather than optional wherever it is threaded, and `'none'` spelled
 * out rather than omitted, for the same reason `capability` is required on
 * `defineWorkspaceOperation`: an absent declaration cannot be told apart from an
 * unreviewed one, and unreviewed omission is how twelve config keys shipped
 * enforcing nothing. Each route's value is the one its v2 or internal
 * counterpart already declares — v1 does not get a mapping of its own.
 */
export type V1RouteCapability = StaticPermissionGroupCapability | 'none'

/**
 * The permission-group gate for a v1 route, as a structured failure.
 *
 * Only a personal key carries capabilities. A workspace key authorizes as the
 * workspace and has no user, so there is no group to resolve — and its
 * `rateLimit.userId` is the key's *creator*, a bystander whose group must not
 * govern every caller of a shared credential. That is the same reasoning the
 * `workspace_api_key` branch of `authorizeWorkspaceOperation` applies; the
 * escape is closed at the door instead, because minting a workspace key is
 * itself capability-gated.
 *
 * No `permission-group-enforced:` annotation, because this gate names no
 * capability of its own: it applies whichever one the route declares, and every
 * one of those is already reachable through the operation its v2 or internal
 * counterpart declares.
 *
 * Never call this before the workspace role check. A capability refusal handed
 * to a non-member would confirm the workspace exists and disclose which modules
 * the organization withholds; the role failure conceals both.
 *
 * Takes no caller-supplied user id on purpose: the subject is the guard's own
 * return value from {@link capabilityGovernedUserId}, so there is only one id —
 * a caller cannot assert the withhold against a different one (the key
 * creator's) than the one the guard said was personal.
 */
export async function resolveCapabilityRefusal(
  rateLimit: RateLimitResult,
  workspaceId: string,
  capability: V1RouteCapability
): Promise<WorkspaceAccessError | null> {
  if (capability === 'none') return null
  const userId = capabilityGovernedUserId(rateLimit)
  if (!userId) return null

  if (!(await isWorkspaceCapabilityWithheld(userId, workspaceId, capability))) return null

  logger.warn('v1 request blocked by permission group', { workspaceId, userId, capability })
  return {
    status: 403,
    code: 'FORBIDDEN',
    message: capabilityRefusal(capability),
    details: { code: CAPABILITY_RULES[capability].detailCode },
  }
}

/**
 * Core workspace-scope check (no response rendering). Enforces two policies:
 * - A workspace-scoped key may only target its own workspace.
 * - A personal key is rejected when the workspace has disabled personal API
 *   keys (`allowPersonalApiKeys = false`). Other surfaces enforcing the same
 *   policy share `PERSONAL_KEY_DENIED`.
 *
 * Both are properties of the workspace rather than of any group, so both run
 * ahead of the role check, exactly as `authorizeWorkspaceOperation` runs the
 * `allowPersonalApiKeys` column ahead of `requireCurrentHumanRole`: they need
 * no group to resolve, and refusing a key the workspace has switched off is the
 * answer whatever the caller's role turns out to be.
 *
 * The group half of the same policy is NOT here — see
 * {@link resolvePersonalKeyGroupRefusal}.
 */
export async function resolveWorkspaceScope(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string
): Promise<WorkspaceAccessError | null> {
  if (
    rateLimit.keyType === 'workspace' &&
    rateLimit.workspaceId &&
    rateLimit.workspaceId !== requestedWorkspaceId
  ) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message: WORKSPACE_KEY_SCOPE_DENIED,
    }
  }

  if (rateLimit.keyType === 'personal') {
    const settings = await getWorkspaceBillingSettings(requestedWorkspaceId)
    if (!settings?.allowPersonalApiKeys) {
      return {
        status: 403,
        code: 'FORBIDDEN',
        message: PERSONAL_KEY_DENIED,
      }
    }
  }

  return null
}

/**
 * The group half of the personal-key policy: `personal_api_key.use`, repeated
 * here because v1 authorizes in this middleware rather than through the
 * application funnel, and without it the same key that v2 refuses would still
 * work against v1.
 *
 * It answers only AFTER the caller's workspace role has been verified, which is
 * the ordering `authorizeWorkspaceOperation` uses and the reason
 * {@link resolveCapabilityRefusal}'s contract says never to run a group key
 * ahead of the role: the refusal names how an organization configured one
 * cohort, and handing that to a caller with no reach into the workspace tells a
 * stranger about the organization's configuration. The column check above may
 * stay early precisely because it names no group.
 *
 * `roleVerifiedFor` is the user id a caller has already checked, not a boolean,
 * so a caller that verified some OTHER subject's role cannot vouch for this
 * one. When it does not match, the role is resolved here instead, and a caller
 * who does not reach `requiredLevel` is handed back `null` so the surface's own
 * role failure — the concealed one — is what it answers with. That second
 * lookup is free: `getUserEntityPermissions` for a workspace goes through the
 * request-scoped memo the role check itself uses.
 *
 * `requiredLevel` is the level the SURFACE will demand, not a floor of `read`.
 * The funnel runs this key after `requireCurrentHumanRole(operation.minimumRole)`,
 * so a read-only member calling a write route is refused on role there. Checked
 * at `read` here, the same person on the same route was told instead how their
 * organization configured personal keys — the disclosure the ordering exists to
 * prevent, one level in.
 */
async function resolvePersonalKeyGroupRefusal(
  rateLimit: RateLimitResult,
  workspaceId: string,
  roleVerifiedFor: string | null,
  requiredLevel: PermissionType = 'read'
): Promise<WorkspaceAccessError | null> {
  const governedUserId = capabilityGovernedUserId(rateLimit)
  if (!governedUserId) return null

  if (roleVerifiedFor !== governedUserId) {
    const permission = await getUserEntityPermissions(governedUserId, 'workspace', workspaceId)
    if (!permissionSatisfies(permission, requiredLevel)) return null
  }

  // permission-group-enforced: personal_api_key.use — v1 authorizes in this middleware, not through the funnel
  if (!(await isWorkspaceCapabilityWithheld(governedUserId, workspaceId, 'personal_api_key.use'))) {
    return null
  }

  /**
   * The detail code separates this from the workspace-column refusal above,
   * which shares the sentence but is a different setting with a different
   * remedy. Read off the rule rather than spelled out, exactly as
   * {@link resolveCapabilityRefusal} does.
   */
  return {
    status: 403,
    code: 'FORBIDDEN',
    message: PERSONAL_KEY_DENIED,
    details: { code: CAPABILITY_RULES['personal_api_key.use'].detailCode },
  }
}

/**
 * Core workspace-access check: key scope and the workspace's own columns, then
 * the user's workspace permission level, then the two permission-group
 * decisions — the personal-key refusal, then the capability the route declares.
 * Returns a structured failure or null on success.
 *
 * Both group keys come after the role, matching `authorizeWorkspaceOperation` —
 * see {@link resolveCapabilityRefusal} for why the ordering is load-bearing.
 * The personal-key refusal sits first of the two for the reason the funnel
 * gives: the remedies differ, and the narrower one is worth naming first.
 */
export async function resolveWorkspaceAccess(
  rateLimit: RateLimitResult,
  userId: string,
  workspaceId: string,
  capability: V1RouteCapability,
  level: PermissionType = 'read'
): Promise<WorkspaceAccessError | null> {
  const scopeError = await resolveWorkspaceScope(rateLimit, workspaceId)
  if (scopeError) return scopeError

  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permissionSatisfies(permission, level)) {
    return { status: 403, code: 'FORBIDDEN', message: 'Access denied' }
  }

  const personalKeyRefusal = await resolvePersonalKeyGroupRefusal(rateLimit, workspaceId, userId)
  if (personalKeyRefusal) return personalKeyRefusal

  return resolveCapabilityRefusal(rateLimit, workspaceId, capability)
}

/**
 * v1 wrapper: renders {@link resolveWorkspaceScope} as the v1 `{ error }` body,
 * plus the personal-key group refusal that belongs with it.
 *
 * It deliberately gates no MODULE capability: it runs before the route's role
 * check, and a route using it authorizes its resource through a domain helper
 * afterwards (the table routes call `checkAccess`, which applies `tables.use`
 * itself), so the capability is declared there.
 *
 * `personal_api_key.use` cannot wait for that helper — `checkAccess` gates the
 * module, not the key kind — so it is asked here, and
 * {@link resolvePersonalKeyGroupRefusal} resolves the caller's role itself
 * before answering rather than relying on a role check this wrapper never runs.
 *
 * `requiredLevel` must be the level the caller will hand `checkAccess` a moment
 * later. Left at `read` on a write route, the group refusal answers a read-only
 * member before the role failure that actually applies to them does.
 */
export async function checkWorkspaceScope(
  rateLimit: RateLimitResult,
  requestedWorkspaceId: string,
  requiredLevel: PermissionType = 'read'
): Promise<NextResponse | null> {
  const failure =
    (await resolveWorkspaceScope(rateLimit, requestedWorkspaceId)) ??
    (await resolvePersonalKeyGroupRefusal(rateLimit, requestedWorkspaceId, null, requiredLevel))
  return failure ? workspaceAccessErrorResponse(failure) : null
}

/**
 * The response a surface that conceals an inaccessible workspace should answer
 * a {@link resolveWorkspaceAccess} failure with.
 *
 * The log surfaces answer "not found" rather than "forbidden" so a stranger
 * cannot use them to probe which workspaces and executions exist. A
 * permission-group refusal is the one failure that has nothing left to conceal:
 * both group keys run only AFTER the caller's workspace role verified, so the
 * caller is already known to be a member of the workspace being asked about,
 * and the refusal names how their own organization configured their cohort.
 * Flattening it into the concealing 404 costs the client the remedy — the key
 * looks broken rather than switched off — and buys no secrecy.
 *
 * `details` is the discriminator because it is set on exactly the two post-role
 * group refusals; the pre-role scope failures carry none and keep concealing.
 */
export function concealedWorkspaceAccessResponse(
  failure: WorkspaceAccessError,
  notFoundMessage: string
): NextResponse {
  return failure.details
    ? workspaceAccessErrorResponse(failure)
    : NextResponse.json({ error: notFoundMessage }, { status: 404 })
}

/** Renders a {@link WorkspaceAccessError} as the v1 `{ error, details? }` body. */
function workspaceAccessErrorResponse(failure: WorkspaceAccessError): NextResponse {
  return NextResponse.json(
    failure.details
      ? { error: failure.message, details: failure.details }
      : { error: failure.message },
    { status: failure.status }
  )
}

/**
 * Resolves the usage actor for a workspace-scoped v1 request. Personal keys
 * identify their human owner; shared workspace keys use the billed account as
 * the explicit system actor because the credential does not identify a human.
 */
export async function resolveWorkspaceRequestActor(
  rateLimit: RateLimitResult,
  workspaceId: string
): Promise<string | null> {
  if (rateLimit.keyType === 'workspace') {
    return getWorkspaceBilledAccountUserId(workspaceId)
  }
  return rateLimit.userId ?? null
}

/**
 * {@link resolveWorkspaceRequestActor} as a route-ready result.
 *
 * The resolver answers `null` for a real, reachable request: an authenticated
 * workspace key whose workspace has since been archived or deleted has no
 * billed account to stand in as its system actor. That is the same condition
 * the routes already report as a 400 `Invalid workspace ID` for a workspace
 * mismatch, so it is reported the same way, from one place.
 */
export async function requireWorkspaceRequestActor(
  rateLimit: RateLimitResult,
  workspaceId: string
): Promise<{ ok: true; actorUserId: string } | { ok: false; response: NextResponse }> {
  const actorUserId = await resolveWorkspaceRequestActor(rateLimit, workspaceId)
  if (actorUserId) return { ok: true, actorUserId }
  return {
    ok: false,
    response: NextResponse.json({ error: 'Invalid workspace ID' }, { status: 400 }),
  }
}

/**
 * v1 wrapper: renders {@link resolveWorkspaceAccess} as the v1 `{ error }` body.
 * Returns null on success, NextResponse on failure.
 */
export async function validateWorkspaceAccess(
  rateLimit: RateLimitResult,
  userId: string,
  workspaceId: string,
  capability: V1RouteCapability,
  level: PermissionType = 'read'
): Promise<NextResponse | null> {
  const failure = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, capability, level)
  return failure ? workspaceAccessErrorResponse(failure) : null
}

/**
 * Shared 400 handler for v1 contract validation failures.
 *
 * `parseRequest`'s default reports the literal `"Validation error"`, which tells
 * a caller nothing about which field was wrong — the schema already produced a
 * specific message, and the default discards it. Surfacing the first issue keeps
 * `details` intact while making the common case self-explanatory.
 *
 * Pass as `parseRequest(contract, request, context, { validationErrorResponse:
 * v1ValidationErrorResponse })`. Routes with a more specific message of their
 * own (for example `'Invalid workflow ID'`) should keep it.
 */
export function v1ValidationErrorResponse(error: ZodError, fallback = 'Invalid request') {
  return validationErrorResponse(error, getValidationErrorMessage(error, fallback))
}

/**
 * v1 counterpart to `validationErrorResponseFromError` for unknown caught
 * values: returns a 400 naming the failing field when the error is a
 * `ZodError`, otherwise `null` so the caller can keep handling it.
 */
export function v1ValidationErrorResponseFromError(
  error: unknown,
  fallback = 'Invalid request'
): NextResponse | null {
  return isZodError(error) ? v1ValidationErrorResponse(error, fallback) : null
}
