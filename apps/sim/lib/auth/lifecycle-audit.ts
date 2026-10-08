import { AuditAction, type AuditLogParams, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { foldedEmail, member, session, ssoProvider, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isAPIError } from 'better-auth/api'
import { and, count, eq, gt, ne } from 'drizzle-orm'
import { isSignInProviderAllowed } from '@/lib/auth/constants'
import { isSsoCallbackPath } from '@/lib/auth/sso/callback-provider'

const logger = createLogger('AuthenticationAudit')

type AuthenticationMethod = 'email_password' | 'email_otp' | 'social' | 'sso'
type AuthenticationFailureReason =
  | 'credential_rejected'
  | 'access_denied'
  | 'invalid_request'
  | 'authentication_error'
  | 'provider_rejected'
  | 'sso_admission_denied'

interface AuthenticationAuditInput {
  path: string
  userId?: string
  email?: unknown
  logoutUserId?: string
  providerId?: string
  returned?: unknown
  redirectLocation?: string | null
  failureReason?: AuthenticationFailureReason
  ssoAdmissionCompleted?: boolean
  request?: AuditLogParams['request']
}

function authenticationMethod(path: string): AuthenticationMethod | null {
  if (path === '/sign-in/email' || path === '/sign-up/email') return 'email_password'
  if (path === '/sign-in/email-otp') return 'email_otp'
  if (isSsoCallbackPath(path) || path === '/sign-in/sso') return 'sso'
  if (
    path === '/sign-in/social' ||
    path === '/sign-in/oauth2' ||
    path.startsWith('/callback/') ||
    path.startsWith('/oauth2/callback/')
  ) {
    return 'social'
  }
  return null
}

function failureReason(statusCode: number): AuthenticationFailureReason {
  if (statusCode === 401) return 'credential_rejected'
  if (statusCode === 403) return 'access_denied'
  if (statusCode >= 400 && statusCode < 500) return 'invalid_request'
  return 'authentication_error'
}

function isFailureRedirect(location: string | null | undefined): boolean {
  if (!location) return false
  try {
    return new URL(location, 'https://auth.invalid').searchParams.has('error')
  } catch {
    return false
  }
}

async function loadSubject(input: { userId?: string; email?: unknown }) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : undefined
  if (!input.userId && !email) return undefined
  const [subject] = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      organizationId: member.organizationId,
    })
    .from(user)
    .leftJoin(member, eq(member.userId, user.id))
    .where(input.userId ? eq(user.id, input.userId) : eq(foldedEmail(user.email), email ?? ''))
    .limit(1)
  return subject
}

/** Records final authentication outcomes without persisting request bodies or bearer credentials. */
export async function recordAuthenticationAudit(input: AuthenticationAuditInput): Promise<void> {
  const statusCode = isAPIError(input.returned) ? input.returned.statusCode : undefined
  if (input.path === '/request-password-reset') {
    if ((statusCode && statusCode >= 400) || input.returned instanceof Error) return
    await recordPasswordResetAudit({
      kind: 'requested',
      email: typeof input.email === 'string' ? input.email : undefined,
      request: input.request,
    })
    return
  }
  const method = authenticationMethod(input.path)
  const reason =
    input.failureReason ??
    (statusCode && statusCode >= 400
      ? failureReason(statusCode)
      : input.returned instanceof Error && !isAPIError(input.returned)
        ? 'authentication_error'
        : method && !input.userId && isFailureRedirect(input.redirectLocation)
          ? 'provider_rejected'
          : undefined)
  const outcome = reason
    ? 'failure'
    : input.path === '/sign-out' && input.logoutUserId
      ? 'logout'
      : method && input.userId
        ? 'success'
        : undefined
  if (!outcome || (!method && outcome !== 'logout')) return
  if (outcome === 'failure' && input.path === '/sign-up/email') return
  if (outcome === 'success' && isSsoCallbackPath(input.path) && !input.ssoAdmissionCompleted) {
    return
  }

  try {
    const subject = await loadSubject({
      userId: outcome === 'logout' ? input.logoutUserId : input.userId,
      email: input.email,
    })
    if (!subject && outcome !== 'failure') return
    let organizationId = subject?.organizationId
    let providerId = isSignInProviderAllowed(input.providerId) ? input.providerId : undefined
    if (method === 'sso' && input.providerId && /^[a-zA-Z0-9_.:-]{1,128}$/.test(input.providerId)) {
      const [provider] = await db
        .select({ organizationId: ssoProvider.organizationId, providerId: ssoProvider.providerId })
        .from(ssoProvider)
        .where(eq(ssoProvider.providerId, input.providerId))
        .limit(1)
      providerId = provider?.providerId
      if (outcome === 'failure' || !organizationId) {
        organizationId = provider?.organizationId ?? organizationId
      }
    }
    const authenticatedActor = outcome !== 'failure' ? subject : undefined
    recordAudit({
      actorId: authenticatedActor?.id ?? null,
      actorName: authenticatedActor?.name ?? 'Unauthenticated requester',
      actorEmail: authenticatedActor?.email ?? null,
      action:
        outcome === 'success'
          ? AuditAction.AUTH_LOGIN_SUCCEEDED
          : outcome === 'logout'
            ? AuditAction.AUTH_LOGOUT
            : AuditAction.AUTH_LOGIN_FAILED,
      resourceType: AuditResourceType.USER,
      resourceId: subject?.id,
      resourceName: subject?.email,
      description:
        outcome === 'success'
          ? 'User signed in'
          : outcome === 'logout'
            ? 'User signed out'
            : 'Authentication attempt rejected',
      metadata: {
        outcome,
        ...(method ? { authenticationMethod: method } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(providerId ? { providerId } : {}),
        ...(reason ? { failureReason: reason } : {}),
        ...(statusCode && statusCode >= 400 ? { statusCode } : {}),
        ...(outcome === 'failure' && subject ? { targetUserId: subject.id } : {}),
      },
      request: input.request,
    })
  } catch {
    logger.warn('Failed to prepare authentication audit event', { outcome })
  }
}

/** Attributes a reset request to its anonymous requester and a completed reset to its user. */
export async function recordPasswordResetAudit(input: {
  kind: 'requested' | 'completed'
  userId?: string
  email?: string
  request?: AuditLogParams['request']
}): Promise<void> {
  try {
    const subject = await loadSubject(input)
    if (!subject) return
    const completed = input.kind === 'completed'
    recordAudit({
      actorId: completed ? subject.id : null,
      actorName: completed ? subject.name : 'Unauthenticated requester',
      actorEmail: completed ? subject.email : null,
      action: completed ? AuditAction.PASSWORD_RESET : AuditAction.PASSWORD_RESET_REQUESTED,
      resourceType: AuditResourceType.PASSWORD,
      resourceId: subject.id,
      resourceName: subject.email,
      description: completed ? 'Password reset completed' : 'Password reset requested',
      metadata: {
        outcome: 'success',
        ...(subject.organizationId ? { organizationId: subject.organizationId } : {}),
        ...(!completed ? { targetUserId: subject.id } : {}),
      },
      request: input.request,
    })
  } catch {
    logger.warn('Failed to prepare password reset audit event', { kind: input.kind })
  }
}

interface SecurityAuditActor {
  userId: string
  sessionId: string
  role?: unknown
  impersonatedBy?: unknown
}

export interface AuthenticationSecurityAuditSnapshot {
  kind: 'impersonation_started' | 'impersonation_ended' | 'sessions_revoked'
  actorUserId: string
  targetUserId: string
  administrative: boolean
  revocationMode?: 'single' | 'all' | 'other'
  sessionsMatchedBefore?: number
}

const SECURITY_MUTATION_PATHS = new Set([
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/revoke-other-sessions',
])

/** Captures canonical session references and aggregate counts before revocation removes them. */
export async function captureAuthenticationSecurityAudit(input: {
  path: string
  resolveActor: () => Promise<SecurityAuditActor | null>
  requestedUserId?: unknown
  requestedToken?: unknown
}): Promise<AuthenticationSecurityAuditSnapshot | undefined> {
  if (!SECURITY_MUTATION_PATHS.has(input.path)) return undefined
  try {
    const actor = await input.resolveActor()
    if (!actor) return undefined
    if (input.path === '/admin/stop-impersonating') {
      if (typeof actor.impersonatedBy !== 'string' || !actor.impersonatedBy) return undefined
      return {
        kind: 'impersonation_ended',
        actorUserId: actor.impersonatedBy,
        targetUserId: actor.userId,
        administrative: true,
      }
    }

    const administrative = input.path.startsWith('/admin/')
    if (
      administrative &&
      !(typeof actor.role === 'string' && actor.role.split(',').includes('admin'))
    ) {
      return undefined
    }
    if (input.path === '/admin/impersonate-user') {
      if (typeof input.requestedUserId !== 'string') return undefined
      return {
        kind: 'impersonation_started',
        actorUserId: actor.userId,
        targetUserId: input.requestedUserId,
        administrative,
      }
    }

    const single = input.path === '/revoke-session' || input.path === '/admin/revoke-user-session'
    if (single) {
      if (typeof input.requestedToken !== 'string') return undefined
      const [target] = await db
        .select({ userId: session.userId })
        .from(session)
        .where(
          and(
            eq(session.token, input.requestedToken),
            administrative ? undefined : eq(session.userId, actor.userId)
          )
        )
        .limit(1)
      if (!target) return undefined
      return {
        kind: 'sessions_revoked',
        actorUserId: actor.userId,
        targetUserId: target.userId,
        administrative,
        revocationMode: 'single',
        sessionsMatchedBefore: 1,
      }
    }

    const targetUserId = administrative ? input.requestedUserId : actor.userId
    if (typeof targetUserId !== 'string') return undefined
    const other = input.path === '/revoke-other-sessions'
    const [matched] = await db
      .select({ total: count() })
      .from(session)
      .where(
        and(
          eq(session.userId, targetUserId),
          other ? ne(session.id, actor.sessionId) : undefined,
          other ? gt(session.expiresAt, new Date()) : undefined
        )
      )
    return {
      kind: 'sessions_revoked',
      actorUserId: actor.userId,
      targetUserId,
      administrative,
      revocationMode: other ? 'other' : 'all',
      sessionsMatchedBefore: matched?.total ?? 0,
    }
  } catch {
    logger.warn('Failed to capture authentication security audit context')
    return undefined
  }
}

/** Records accepted security mutations in the target organization with the actual operator. */
export async function recordAuthenticationSecurityAudit(input: {
  snapshot?: AuthenticationSecurityAuditSnapshot
  returned?: unknown
  request?: AuditLogParams['request']
}): Promise<void> {
  if (!input.snapshot || input.returned instanceof Error) return
  if (isAPIError(input.returned) && input.returned.statusCode >= 400) return
  const snapshot = input.snapshot
  try {
    const [actor, target] = await Promise.all([
      loadSubject({ userId: snapshot.actorUserId }),
      loadSubject({ userId: snapshot.targetUserId }),
    ])
    if (!actor || !target) return
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action:
        snapshot.kind === 'impersonation_started'
          ? AuditAction.AUTH_IMPERSONATION_STARTED
          : snapshot.kind === 'impersonation_ended'
            ? AuditAction.AUTH_IMPERSONATION_ENDED
            : AuditAction.AUTH_SESSIONS_REVOKED,
      resourceType: AuditResourceType.USER,
      resourceId: target.id,
      resourceName: target.email,
      description:
        snapshot.kind === 'impersonation_started'
          ? 'Administrator started impersonating a user'
          : snapshot.kind === 'impersonation_ended'
            ? 'Administrator stopped impersonating a user'
            : 'Processed session revocation request',
      metadata: {
        outcome: 'success',
        targetUserId: target.id,
        administrative: snapshot.administrative,
        ...(target.organizationId ? { organizationId: target.organizationId } : {}),
        ...(snapshot.revocationMode ? { revocationMode: snapshot.revocationMode } : {}),
        ...(snapshot.sessionsMatchedBefore !== undefined
          ? { sessionsMatchedBefore: snapshot.sessionsMatchedBefore }
          : {}),
      },
      request: input.request,
    })
  } catch {
    logger.warn('Failed to prepare authentication security audit event', { kind: snapshot.kind })
  }
}
