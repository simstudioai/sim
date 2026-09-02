import {
  parsePrincipal,
  resolvePrincipalSubject,
  serializePrincipal,
  type WorkflowExecutionAuthority,
  type WorkflowExecutionPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { generateId } from '@sim/utils/id'
import { type JWTPayload, jwtVerify, SignJWT } from 'jose'
import { type NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/core/config/env'
import { getClientIp } from '@/lib/core/utils/request'

const logger = createLogger('CronAuth')

export type InternalSandboxProfile = 'mothership'

export interface InternalTokenClaims {
  /** Selects a server-owned sandbox image for a trusted internal execution. */
  sandboxProfile?: InternalSandboxProfile
}

export interface GenerateInternalDelegationTokenInput {
  subjectUserId?: string
  workflowId: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
  currentWorkflow?: WorkflowExecutionAuthority
}

export interface VerifiedInternalDelegation {
  serviceId: 'executor'
  subjectUserId?: string
  workflowId: string
  executionId?: string
  principal?: WorkflowExecutionPrincipal
  currentWorkflow?: WorkflowExecutionAuthority
  delegationId: string
  issuedAt: Date
  expiresAt: Date
}

export class InvalidInternalDelegationTokenError extends Error {
  constructor(message = 'Invalid internal delegation token') {
    super(message)
    this.name = 'InvalidInternalDelegationTokenError'
  }
}

const INTERNAL_DELEGATION_ISSUER = 'sim-internal'
const INTERNAL_DELEGATION_AUDIENCE = 'sim-api'
const INTERNAL_DELEGATION_TTL_SECONDS = 5 * 60
const INTERNAL_DELEGATION_CLOCK_TOLERANCE_SECONDS = 5

const getJwtSecret = () => {
  // Prefer a dedicated JWT signing key so the internal-JWT trust domain is
  // separable from the raw INTERNAL_API_SECRET shared-bearer secret: leaking one
  // shouldn't grant the other (raw secret => call internal endpoints; JWT key =>
  // mint tokens for arbitrary userIds). Falls back to INTERNAL_API_SECRET when
  // unset so existing deployments keep working until the key is rotated in.
  const secret = new TextEncoder().encode(env.INTERNAL_JWT_SECRET || env.INTERNAL_API_SECRET)
  return secret
}

/**
 * Generate an internal JWT token for server-side API calls
 * Token expires in 5 minutes to keep it short-lived
 * @param userId Optional user ID to embed in token payload
 * @param claims Optional server-owned claims for the receiving internal route
 */
export async function generateInternalToken(
  userId?: string,
  claims: InternalTokenClaims = {}
): Promise<string> {
  const secret = getJwtSecret()

  const payload: { type: string; userId?: string; sandboxProfile?: InternalSandboxProfile } = {
    type: 'internal',
  }
  if (userId) {
    payload.userId = userId
  }
  if (claims.sandboxProfile) {
    payload.sandboxProfile = claims.sandboxProfile
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setIssuer('sim-internal')
    .setAudience('sim-api')
    .sign(secret)

  return token
}

function requireNonEmptyDelegationClaim(value: string, name: string): string {
  if (!value.trim()) throw new Error(`Internal delegation ${name} must not be empty`)
  return value
}

function parseWorkflowExecutionAuthority(value: unknown): WorkflowExecutionAuthority {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidInternalDelegationTokenError()
  }
  const authority = value as Record<string, unknown>
  const workflowId = readVerifiedDelegationClaim(authority.workflowId)
  if (!workflowId) throw new InvalidInternalDelegationTokenError()
  if (authority.mode === 'draft') {
    if (Object.keys(authority).some((key) => !['workflowId', 'mode'].includes(key))) {
      throw new InvalidInternalDelegationTokenError()
    }
    return { workflowId, mode: 'draft' }
  }
  if (authority.mode === 'deployment') {
    const deploymentVersionId = readVerifiedDelegationClaim(authority.deploymentVersionId)
    if (
      !deploymentVersionId ||
      Object.keys(authority).some(
        (key) => !['workflowId', 'mode', 'deploymentVersionId'].includes(key)
      )
    ) {
      throw new InvalidInternalDelegationTokenError()
    }
    return { workflowId, mode: 'deployment', deploymentVersionId }
  }
  throw new InvalidInternalDelegationTokenError()
}

/** Generates an executor token bound to its workflow origin and authenticated caller. */
export async function generateInternalDelegationToken(
  input: GenerateInternalDelegationTokenInput
): Promise<string> {
  const suppliedSubjectUserId = input.subjectUserId
    ? requireNonEmptyDelegationClaim(input.subjectUserId, 'subjectUserId')
    : undefined
  const principalSubject = input.principal ? resolvePrincipalSubject(input.principal) : null
  if (principalSubject && principalSubject.kind !== 'sim_user' && suppliedSubjectUserId) {
    throw new Error('Non-Sim workflow subjects cannot be represented as Sim users')
  }
  if (!principalSubject && input.principal && suppliedSubjectUserId) {
    throw new Error('Actorless workflow principals cannot be represented as Sim users')
  }
  if (
    principalSubject?.kind === 'sim_user' &&
    suppliedSubjectUserId &&
    suppliedSubjectUserId !== principalSubject.userId
  ) {
    throw new Error('Internal delegation subject does not match its workflow principal')
  }
  const subjectUserId =
    principalSubject?.kind === 'sim_user' ? principalSubject.userId : suppliedSubjectUserId
  if (!subjectUserId && !input.principal) {
    throw new Error('Internal delegation requires a workflow principal or Sim user subject')
  }
  const workflowId = requireNonEmptyDelegationClaim(input.workflowId, 'workflowId')
  const currentWorkflow = input.currentWorkflow
    ? parseWorkflowExecutionAuthority(input.currentWorkflow)
    : undefined
  const issuedAtSeconds = Math.floor(Date.now() / 1000)
  const executionId = input.executionId
    ? requireNonEmptyDelegationClaim(input.executionId, 'executionId')
    : undefined
  if (currentWorkflow && !executionId) {
    throw new Error('Internal delegation currentWorkflow requires executionId')
  }

  let token = new SignJWT({
    type: 'internal_delegation',
    serviceId: 'executor',
    workflowId,
    ...(input.principal ? { principal: serializePrincipal(input.principal) } : {}),
    ...(currentWorkflow ? { currentWorkflow } : {}),
    ...(executionId ? { executionId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(generateId())
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + INTERNAL_DELEGATION_TTL_SECONDS)
    .setIssuer(INTERNAL_DELEGATION_ISSUER)
    .setAudience(INTERNAL_DELEGATION_AUDIENCE)
  if (subjectUserId) token = token.setSubject(subjectUserId)
  return token.sign(getJwtSecret())
}

function readVerifiedDelegationClaim(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

/** Verifies a scoped executor delegation without accepting unbound legacy tokens. */
export async function verifyInternalDelegationToken(
  token: string
): Promise<VerifiedInternalDelegation> {
  const secret = getJwtSecret()
  let payload: JWTPayload
  try {
    const verification = await jwtVerify(token, secret, {
      issuer: INTERNAL_DELEGATION_ISSUER,
      audience: INTERNAL_DELEGATION_AUDIENCE,
      algorithms: ['HS256'],
      clockTolerance: INTERNAL_DELEGATION_CLOCK_TOLERANCE_SECONDS,
    })
    payload = verification.payload
  } catch {
    throw new InvalidInternalDelegationTokenError()
  }

  const subjectUserId = readVerifiedDelegationClaim(payload.sub)
  const workflowId = readVerifiedDelegationClaim(payload.workflowId)
  const executionId =
    payload.executionId === undefined ? undefined : readVerifiedDelegationClaim(payload.executionId)
  const delegationId = readVerifiedDelegationClaim(payload.jti)
  const nowSeconds = Math.floor(Date.now() / 1000)
  let principal: WorkflowExecutionPrincipal | undefined
  let currentWorkflow: WorkflowExecutionAuthority | undefined
  if (payload.principal !== undefined) {
    try {
      principal = parsePrincipal(payload.principal)
    } catch {
      throw new InvalidInternalDelegationTokenError()
    }
  }
  if (payload.currentWorkflow !== undefined) {
    currentWorkflow = parseWorkflowExecutionAuthority(payload.currentWorkflow)
  }

  if (
    payload.type !== 'internal_delegation' ||
    payload.serviceId !== 'executor' ||
    !workflowId ||
    executionId === null ||
    (currentWorkflow !== undefined && executionId === undefined) ||
    !delegationId ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.iat > nowSeconds + INTERNAL_DELEGATION_CLOCK_TOLERANCE_SECONDS ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > INTERNAL_DELEGATION_TTL_SECONDS
  ) {
    throw new InvalidInternalDelegationTokenError()
  }

  const principalSubject = principal ? resolvePrincipalSubject(principal) : null
  if (
    (!principal && !subjectUserId) ||
    (principalSubject?.kind === 'sim_user' && principalSubject.userId !== subjectUserId) ||
    (principalSubject && principalSubject.kind !== 'sim_user' && subjectUserId) ||
    (principal && !principalSubject && subjectUserId)
  ) {
    throw new InvalidInternalDelegationTokenError()
  }

  return {
    serviceId: 'executor',
    ...(subjectUserId ? { subjectUserId } : {}),
    workflowId,
    ...(principal ? { principal } : {}),
    ...(currentWorkflow ? { currentWorkflow } : {}),
    ...(executionId ? { executionId } : {}),
    delegationId,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
  }
}

/**
 * Verify an internal JWT token
 * Returns verification result with userId if present in token
 */
export async function verifyInternalToken(
  token: string
): Promise<{ valid: boolean; userId?: string; sandboxProfile?: InternalSandboxProfile }> {
  try {
    const secret = getJwtSecret()

    const { payload } = await jwtVerify(token, secret, {
      issuer: 'sim-internal',
      audience: 'sim-api',
    })

    // Check that it's an internal token
    if (payload.type === 'internal') {
      if (payload.sandboxProfile !== undefined && payload.sandboxProfile !== 'mothership') {
        return { valid: false }
      }
      return {
        valid: true,
        userId: typeof payload.userId === 'string' ? payload.userId : undefined,
        ...(payload.sandboxProfile === 'mothership'
          ? { sandboxProfile: 'mothership' as const }
          : {}),
      }
    }

    return { valid: false }
  } catch (error) {
    // Token verification failed
    return { valid: false }
  }
}

/**
 * Verify CRON authentication for scheduled API endpoints
 * Returns null if authorized, or a NextResponse with error if unauthorized
 */
export function verifyCronAuth(request: NextRequest, context?: string): NextResponse | null {
  if (!env.CRON_SECRET) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`CRON endpoint accessed but CRON_SECRET is not configured${contextInfo}`, {
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      context,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const authHeader = request.headers.get('authorization')
  const expectedAuth = `Bearer ${env.CRON_SECRET}`
  const isValid = authHeader !== null && safeCompare(authHeader, expectedAuth)
  if (!isValid) {
    const contextInfo = context ? ` for ${context}` : ''
    logger.warn(`Unauthorized CRON access attempt${contextInfo}`, {
      hasAuthorizationHeader: authHeader !== null,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      context,
    })

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
