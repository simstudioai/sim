import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'

const logger = createLogger('HybridAuth')

export interface AuthResult {
  success: boolean
  userId?: string
  authType?: 'session' | 'api_key' | 'internal_jwt'
  apiKeyType?: 'personal' | 'workspace'
  error?: string
}

/**
 * Resolves userId from a verified internal JWT token.
 * Extracts userId from the JWT payload, URL search params, or POST body.
 */
async function resolveUserFromJwt(
  request: NextRequest,
  verificationUserId: string | null,
  options: { requireWorkflowId?: boolean }
): Promise<AuthResult> {
  let userId: string | null = verificationUserId

  if (!userId) {
    const { searchParams } = new URL(request.url)
    userId = searchParams.get('userId')
  }

  if (!userId && request.method === 'POST') {
    try {
      const clonedRequest = request.clone()
      const bodyText = await clonedRequest.text()
      if (bodyText) {
        const body = JSON.parse(bodyText)
        userId = body.userId || body._context?.userId || null
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  if (userId) {
    return { success: true, userId, authType: 'internal_jwt' }
  }

  if (options.requireWorkflowId !== false) {
    return { success: false, error: 'userId required for internal JWT calls' }
  }

  return { success: true, authType: 'internal_jwt' }
}

/**
 * Check for internal JWT authentication only.
 * Use this for routes that should ONLY be accessible by the executor (server-to-server).
 * Rejects session and API key authentication.
 *
 * @param request - The incoming request
 * @param options - Optional configuration
 * @param options.requireWorkflowId - Whether workflowId/userId is required (default: true)
 */
export async function checkInternalAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    const authHeader = request.headers.get('authorization')

    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      return {
        success: false,
        error: 'API key access not allowed for this endpoint. Use workflow execution instead.',
      }
    }

    if (!authHeader?.startsWith('Bearer ')) {
      return {
        success: false,
        error: 'Internal authentication required',
      }
    }

    const token = authHeader.split(' ')[1]
    const verification = await verifyInternalToken(token)

    if (!verification.valid) {
      return { success: false, error: 'Invalid internal token' }
    }

    return resolveUserFromJwt(request, verification.userId || null, options)
  } catch (error) {
    logger.error('Error in internal authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}

/**
 * Check for session or internal JWT authentication.
 * Use this for routes that should be accessible by the UI and executor,
 * but NOT by external API keys.
 *
 * @param request - The incoming request
 * @param options - Optional configuration
 * @param options.requireWorkflowId - Whether workflowId/userId is required for JWT (default: true)
 */
export async function checkSessionOrInternalAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    // 1. Reject API keys first
    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      return {
        success: false,
        error: 'API key access not allowed for this endpoint',
      }
    }

    // 2. Check for internal JWT token
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalToken(token)

      if (verification.valid) {
        return resolveUserFromJwt(request, verification.userId || null, options)
      }
    }

    // 3. Try session auth (for web UI)
    const session = await getSession()
    if (session?.user?.id) {
      return {
        success: true,
        userId: session.user.id,
        authType: 'session',
      }
    }

    return {
      success: false,
      error: 'Authentication required - provide session or internal JWT',
    }
  } catch (error) {
    logger.error('Error in session/internal authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}

/**
 * Check for authentication using any of the 3 supported methods:
 * 1. Session authentication (cookies)
 * 2. API key authentication (X-API-Key header)
 * 3. Internal JWT authentication (Authorization: Bearer header)
 *
 * For internal JWT calls, requires workflowId to determine user context
 */
export async function checkHybridAuth(
  request: NextRequest,
  options: { requireWorkflowId?: boolean } = {}
): Promise<AuthResult> {
  try {
    // 1. Check for internal JWT token first
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1]
      const verification = await verifyInternalToken(token)

      if (verification.valid) {
        return resolveUserFromJwt(request, verification.userId || null, options)
      }
    }

    // 2. Try session auth (for web UI)
    const session = await getSession()
    if (session?.user?.id) {
      return {
        success: true,
        userId: session.user.id,
        authType: 'session',
      }
    }

    // 3. Try API key auth (X-API-Key header only)
    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      const result = await authenticateApiKeyFromHeader(apiKeyHeader)
      if (result.success) {
        await updateApiKeyLastUsed(result.keyId!)
        return {
          success: true,
          userId: result.userId!,
          authType: 'api_key',
          apiKeyType: result.keyType,
        }
      }

      return {
        success: false,
        error: 'Invalid API key',
      }
    }

    // No authentication found
    return {
      success: false,
      error: 'Authentication required - provide session, API key, or internal JWT',
    }
  } catch (error) {
    logger.error('Error in hybrid authentication:', error)
    return {
      success: false,
      error: 'Authentication error',
    }
  }
}
