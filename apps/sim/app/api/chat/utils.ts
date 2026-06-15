import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { authorizeWorkflowByWorkspacePermission } from '@sim/workflow-authz'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { isWorkspaceApiExecutionEntitled } from '@/lib/billing/core/api-access'
import { getEnv } from '@/lib/core/config/env'
import { isBillingEnabled, isFreeApiDeploymentGateEnabled } from '@/lib/core/config/feature-flags'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import {
  isEmailAllowed,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'
import { getClientIp } from '@/lib/core/utils/request'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAuthUtils')

const rateLimiter = new RateLimiter()

/**
 * Throttles unauthenticated password guesses per client IP against a single
 * deployment, mirroring the OTP/SSO IP limits.
 */
const PASSWORD_IP_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 10,
  refillIntervalMs: 15 * 60_000,
}

export function setChatAuthCookie(
  response: NextResponse,
  chatId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  setDeploymentAuthCookie(response, 'chat', chatId, type, encryptedPassword)
}

/**
 * A first-party origin is the app itself or any `*.sim.ai` host (chat subdomains
 * + apex). Anything else is a third-party embed. Malformed origins are treated
 * as third-party.
 */
function isFirstPartyOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    if (host === 'sim.ai' || host.endsWith('.sim.ai')) return true
    const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
    if (appUrl && host === new URL(appUrl).hostname.toLowerCase()) return true
    return false
  } catch {
    return false
  }
}

/**
 * Gates cross-origin (embedded) chat requests behind a paid plan on hosted.
 * Same-origin / SSR / first-party requests — including the chat page rendered in
 * a third-party iframe, which calls the API from a `*.sim.ai` origin — are never
 * gated. Returns a 403 response to short-circuit the route, or `null` to allow.
 */
export async function assertChatEmbedAllowed(
  request: NextRequest,
  workflowId: string,
  requestId: string
): Promise<NextResponse | null> {
  if (!isBillingEnabled || !isFreeApiDeploymentGateEnabled) return null

  const origin = request.headers.get('origin')
  if (!origin || isFirstPartyOrigin(origin)) return null

  const [wf] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  if (!wf?.workspaceId) {
    logger.warn(
      `[${requestId}] Chat embed blocked: no active workspace for workflow ${workflowId}, origin=${origin}`
    )
    return createErrorResponse('This chat is currently unavailable', 403)
  }

  if (!(await isWorkspaceApiExecutionEntitled(wf.workspaceId))) {
    logger.warn(`[${requestId}] Chat embed blocked: workspace on free plan, origin=${origin}`)
    return createErrorResponse('Embedding this chat on external sites requires a paid plan', 403)
  }

  return null
}

/**
 * Check if user has permission to create a chat for a specific workflow
 */
export async function checkWorkflowAccessForChatCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'admin',
  })

  if (!authorization.workflow) {
    return { hasAccess: false }
  }

  if (authorization.allowed) {
    return { hasAccess: true, workflow: authorization.workflow }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific chat
 */
export async function checkChatAccess(
  chatId: string,
  userId: string
): Promise<{ hasAccess: boolean; chat?: any; workspaceId?: string }> {
  const chatData = await db
    .select({
      chat: chat,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(and(eq(chat.id, chatId), isNull(chat.archivedAt)))
    .limit(1)

  if (chatData.length === 0) {
    return { hasAccess: false }
  }

  const { chat: chatRecord, workflowWorkspaceId } = chatData[0]
  if (!workflowWorkspaceId) {
    return { hasAccess: false }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: chatRecord.workflowId,
    userId,
    action: 'admin',
  })

  return authorization.allowed
    ? { hasAccess: true, chat: chatRecord, workspaceId: workflowWorkspaceId }
    : { hasAccess: false }
}

export async function validateChatAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<{ authorized: boolean; error?: string; status?: number; retryAfterMs?: number }> {
  const authType = deployment.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  if (authType !== 'sso') {
    const cookieName = `chat_auth_${deployment.id}`
    const authCookie = request.cookies.get(cookieName)

    if (authCookie && validateAuthToken(authCookie.value, deployment.id, deployment.password)) {
      return { authorized: true }
    }
  }

  if (authType === 'password') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Password is required' }
      }

      const { password, input } = parsedBody

      if (input && !password) {
        return { authorized: false, error: 'auth_required_password' }
      }

      if (!password) {
        return { authorized: false, error: 'Password is required' }
      }

      if (!deployment.password) {
        logger.error(`[${requestId}] No password set for password-protected chat: ${deployment.id}`)
        return { authorized: false, error: 'Authentication configuration error' }
      }

      const ip = getClientIp(request)
      const ipRateLimit = await rateLimiter.checkRateLimitDirect(
        `chat-password:ip:${deployment.id}:${ip}`,
        PASSWORD_IP_RATE_LIMIT
      )
      if (!ipRateLimit.allowed) {
        logger.warn(
          `[${requestId}] Password attempt IP rate limit exceeded for chat ${deployment.id} from ${ip}`
        )
        return {
          authorized: false,
          error: 'Too many attempts. Please try again later.',
          status: 429,
          retryAfterMs: ipRateLimit.retryAfterMs ?? PASSWORD_IP_RATE_LIMIT.refillIntervalMs,
        }
      }

      const { decrypted } = await decryptSecret(deployment.password)
      if (!safeCompare(password, decrypted)) {
        return { authorized: false, error: 'Invalid password' }
      }

      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'email') {
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'Email is required' }
      }

      const { email, input } = parsedBody

      if (input && !email) {
        return { authorized: false, error: 'auth_required_email' }
      }

      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }

      const allowedEmails = deployment.allowedEmails || []

      if (isEmailAllowed(email, allowedEmails)) {
        return { authorized: false, error: 'otp_required' }
      }

      return { authorized: false, error: 'Email not authorized' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  if (authType === 'sso') {
    try {
      if (request.method !== 'GET' && !parsedBody) {
        return { authorized: false, error: 'SSO authentication is required' }
      }

      const { getSession } = await import('@/lib/auth')
      const session = await getSession()

      if (!session || !session.user) {
        return { authorized: false, error: 'auth_required_sso' }
      }

      const userEmail = session.user.email
      if (!userEmail) {
        return { authorized: false, error: 'SSO session does not contain email' }
      }

      const allowedEmails = deployment.allowedEmails || []

      if (isEmailAllowed(userEmail, allowedEmails)) {
        return { authorized: true }
      }

      return { authorized: false, error: 'Your email is not authorized to access this chat' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating SSO:`, error)
      return { authorized: false, error: 'SSO authentication error' }
    }
  }

  return { authorized: false, error: 'Unsupported authentication type' }
}
