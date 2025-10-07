import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { hasAdminPermission } from '@/lib/permissions/utils'
import { decryptSecret } from '@/lib/utils'

const logger = createLogger('ChatAuthUtils')

/**
 * Check if user has permission to create a chat for a specific workflow
 * Either the user owns the workflow directly OR has admin permission for the workflow's workspace
 */
export async function checkWorkflowAccessForChatCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  // Get workflow data
  const workflowData = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

  if (workflowData.length === 0) {
    return { hasAccess: false }
  }

  const workflowRecord = workflowData[0]

  // Case 1: User owns the workflow directly
  if (workflowRecord.userId === userId) {
    return { hasAccess: true, workflow: workflowRecord }
  }

  // Case 2: Workflow belongs to a workspace and user has admin permission
  if (workflowRecord.workspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowRecord.workspaceId)
    if (hasAdmin) {
      return { hasAccess: true, workflow: workflowRecord }
    }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific chat
 * Either the user owns the chat directly OR has admin permission for the workflow's workspace
 */
export async function checkChatAccess(
  chatId: string,
  userId: string
): Promise<{ hasAccess: boolean; chat?: any }> {
  // Get chat with workflow information
  const chatData = await db
    .select({
      chat: chat,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(eq(chat.id, chatId))
    .limit(1)

  if (chatData.length === 0) {
    return { hasAccess: false }
  }

  const { chat: chatRecord, workflowWorkspaceId } = chatData[0]

  // Case 1: User owns the chat directly
  if (chatRecord.userId === userId) {
    return { hasAccess: true, chat: chatRecord }
  }

  // Case 2: Chat's workflow belongs to a workspace and user has admin permission
  if (workflowWorkspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowWorkspaceId)
    if (hasAdmin) {
      return { hasAccess: true, chat: chatRecord }
    }
  }

  return { hasAccess: false }
}

export const encryptAuthToken = (chatId: string, type: string): string => {
  return Buffer.from(`${chatId}:${type}:${Date.now()}`).toString('base64')
}

export const validateAuthToken = (token: string, chatId: string): boolean => {
  try {
    const decoded = Buffer.from(token, 'base64').toString()
    const [storedId, _type, timestamp] = decoded.split(':')

    // Check if token is for this chat
    if (storedId !== chatId) {
      return false
    }

    // Check if token is not expired (24 hours)
    const createdAt = Number.parseInt(timestamp)
    const now = Date.now()
    const expireTime = 24 * 60 * 60 * 1000 // 24 hours

    if (now - createdAt > expireTime) {
      return false
    }

    return true
  } catch (_e) {
    return false
  }
}

// Set cookie helper function
export const setChatAuthCookie = (response: NextResponse, chatId: string, type: string): void => {
  const token = encryptAuthToken(chatId, type)
  // Set cookie with HttpOnly and secure flags
  response.cookies.set({
    name: `chat_auth_${chatId}`,
    value: token,
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  })
}

// Helper function to add CORS headers to responses
export function addCorsHeaders(response: NextResponse, request: NextRequest) {
  // Get the origin from the request
  const origin = request.headers.get('origin') || ''

  // In development, allow any localhost subdomain
  if (isDev && origin.includes('localhost')) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Access-Control-Allow-Credentials', 'true')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  }

  return response
}

// Handle OPTIONS requests for CORS preflight
export async function OPTIONS(request: NextRequest) {
  const response = new NextResponse(null, { status: 204 })
  return addCorsHeaders(response, request)
}

// Validate authentication for chat access
export async function validateChatAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<{ authorized: boolean; error?: string }> {
  const authType = deployment.authType || 'public'

  // Public chats are accessible to everyone
  if (authType === 'public') {
    return { authorized: true }
  }

  // Check for auth cookie first
  const cookieName = `chat_auth_${deployment.id}`
  const authCookie = request.cookies.get(cookieName)

  if (authCookie && validateAuthToken(authCookie.value, deployment.id)) {
    return { authorized: true }
  }

  // For password protection, check the password in the request body
  if (authType === 'password') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_password' }
    }

    try {
      // Use the parsed body if provided, otherwise the auth check is not applicable
      if (!parsedBody) {
        return { authorized: false, error: 'Password is required' }
      }

      const { password, input } = parsedBody

      // If this is a chat message, not an auth attempt
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

      // Decrypt the stored password and compare
      const { decrypted } = await decryptSecret(deployment.password)
      if (password !== decrypted) {
        return { authorized: false, error: 'Invalid password' }
      }

      return { authorized: true }
    } catch (error) {
      logger.error(`[${requestId}] Error validating password:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  // For email access control, check the email in the request body
  if (authType === 'email') {
    // For GET requests, we just notify the client that authentication is required
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_email' }
    }

    try {
      // Use the parsed body if provided, otherwise the auth check is not applicable
      if (!parsedBody) {
        return { authorized: false, error: 'Email is required' }
      }

      const { email, input } = parsedBody

      // If this is a chat message, not an auth attempt
      if (input && !email) {
        return { authorized: false, error: 'auth_required_email' }
      }

      if (!email) {
        return { authorized: false, error: 'Email is required' }
      }

      const allowedEmails = deployment.allowedEmails || []

      // Check exact email matches
      if (allowedEmails.includes(email)) {
        // Email is allowed but still needs OTP verification
        // Return a special error code that the client will recognize
        return { authorized: false, error: 'otp_required' }
      }

      // Check domain matches (prefixed with @)
      const domain = email.split('@')[1]
      if (domain && allowedEmails.some((allowed: string) => allowed === `@${domain}`)) {
        // Domain is allowed but still needs OTP verification
        return { authorized: false, error: 'otp_required' }
      }

      return { authorized: false, error: 'Email not authorized' }
    } catch (error) {
      logger.error(`[${requestId}] Error validating email:`, error)
      return { authorized: false, error: 'Authentication error' }
    }
  }

  // Unknown auth type
  return { authorized: false, error: 'Unsupported authentication type' }
}
