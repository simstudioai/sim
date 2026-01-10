import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import {
  isEmailAllowed,
  setDeploymentAuthCookie,
  validateAuthToken,
} from '@/lib/core/security/deployment'
import { decryptSecret } from '@/lib/core/security/encryption'
import { hasAdminPermission } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('ChatAuthUtils')

export function setChatAuthCookie(
  response: NextResponse,
  chatId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  setDeploymentAuthCookie(response, 'chat', chatId, type, encryptedPassword)
}

/**
 * Check if user has permission to create a chat for a specific workflow
 * Either the user owns the workflow directly OR has admin permission for the workflow's workspace
 */
export async function checkWorkflowAccessForChatCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  const workflowData = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1)

  if (workflowData.length === 0) {
    return { hasAccess: false }
  }

  const workflowRecord = workflowData[0]

  if (workflowRecord.userId === userId) {
    return { hasAccess: true, workflow: workflowRecord }
  }

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

  if (chatRecord.userId === userId) {
    return { hasAccess: true, chat: chatRecord }
  }

  if (workflowWorkspaceId) {
    const hasAdmin = await hasAdminPermission(userId, workflowWorkspaceId)
    if (hasAdmin) {
      return { hasAccess: true, chat: chatRecord }
    }
  }

  return { hasAccess: false }
}

export async function validateChatAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<{ authorized: boolean; error?: string }> {
  const authType = deployment.authType || 'public'

  if (authType === 'public') {
    return { authorized: true }
  }

  const cookieName = `chat_auth_${deployment.id}`
  const authCookie = request.cookies.get(cookieName)

  if (authCookie && validateAuthToken(authCookie.value, deployment.id, deployment.password)) {
    return { authorized: true }
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
    if (request.method === 'GET') {
      return { authorized: false, error: 'auth_required_sso' }
    }

    try {
      if (!parsedBody) {
        return { authorized: false, error: 'SSO authentication is required' }
      }

      const { email, input, checkSSOAccess } = parsedBody

      if (input && !checkSSOAccess) {
        return { authorized: false, error: 'auth_required_sso' }
      }

      if (checkSSOAccess) {
        if (!email) {
          return { authorized: false, error: 'Email is required' }
        }

        const allowedEmails = deployment.allowedEmails || []

        if (isEmailAllowed(email, allowedEmails)) {
          return { authorized: true }
        }

        return { authorized: false, error: 'Email not authorized for SSO access' }
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
