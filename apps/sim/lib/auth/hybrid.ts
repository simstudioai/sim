import { db } from '@sim/db'
import { workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { authenticateApiKeyFromHeader, updateApiKeyLastUsed } from '@/lib/api-key/service'
import { getSession } from '@/lib/auth'
import { verifyInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('HybridAuth')

export interface AuthResult {
  success: boolean
  userId?: string
  authType?: 'session' | 'api_key' | 'internal_jwt'
  error?: string
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
        let workflowId: string | null = null
        let userId: string | null = verification.userId || null

        const { searchParams } = new URL(request.url)
        workflowId = searchParams.get('workflowId')
        if (!userId) {
          userId = searchParams.get('userId')
        }

        if (!workflowId && !userId && request.method === 'POST') {
          try {
            // Clone the request to avoid consuming the original body
            const clonedRequest = request.clone()
            const bodyText = await clonedRequest.text()
            if (bodyText) {
              const body = JSON.parse(bodyText)
              workflowId = body.workflowId || body._context?.workflowId
              userId = userId || body.userId || body._context?.userId
            }
          } catch {
            // Ignore JSON parse errors
          }
        }

        if (userId) {
          return {
            success: true,
            userId,
            authType: 'internal_jwt',
          }
        }

        if (workflowId) {
          const [workflowData] = await db
            .select({ userId: workflow.userId })
            .from(workflow)
            .where(eq(workflow.id, workflowId))
            .limit(1)

          if (!workflowData) {
            return {
              success: false,
              error: 'Workflow not found',
            }
          }

          return {
            success: true,
            userId: workflowData.userId,
            authType: 'internal_jwt',
          }
        }

        if (options.requireWorkflowId !== false) {
          return {
            success: false,
            error: 'workflowId or userId required for internal JWT calls',
          }
        }

        return {
          success: true,
          authType: 'internal_jwt',
        }
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

    // 3. Try API key auth
    const apiKeyHeader = request.headers.get('x-api-key')
    if (apiKeyHeader) {
      const result = await authenticateApiKeyFromHeader(apiKeyHeader)
      if (result.success) {
        await updateApiKeyLastUsed(result.keyId!)
        return {
          success: true,
          userId: result.userId!,
          authType: 'api_key',
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
